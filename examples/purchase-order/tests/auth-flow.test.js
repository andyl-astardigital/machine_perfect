/**
 * Auth flow e2e test — full PO lifecycle with two users and projections.
 *
 * 1. Alice submits £75k PO → escalates to director-approval, stored
 * 2. Alice loads order-list → gets purchase-order-status at 'pending' (projected, no sensitive data)
 * 3. Bob loads director-queue → gets full purchase-order (sees notes, cost centre, margin)
 * 4. Bob rejects → PO stored at 'rejected'
 * 5. Alice loads order-list → gets status at 'rejected' with edit/resubmit form
 * 6. Alice changes amount to £25k, resubmits (reverse path) → auto-approves → fulfilled
 * 7. Alice submits new £60k PO → escalates → Bob approves → fulfilled
 *
 * Tests forward projection, reverse path with context merge, and re-projection.
 *
 * Run: node examples/purchase-order/tests/auth-flow.test.js
 */

var fs = require('fs');
var path = require('path');
var scxml = require('../../../mn/scxml');
var machine = require('../../../mn/machine');
var transforms = require('../../../mn/transforms');
var services = require('../services');
var db = require('../db');

db.reset();

var passed = 0;
var failed = 0;

function eq(a, b, m) {
  if (a === b) { passed++; console.log('  \u2713 ' + m); }
  else { failed++; console.log('  \u2717 ' + m + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); }
}
function assert(c, m) {
  if (c) { passed++; console.log('  \u2713 ' + m); }
  else { failed++; console.log('  \u2717 ' + m); }
}

var MACHINES = path.join(__dirname, '..', 'machines');
function readScxml(name) { return fs.readFileSync(path.join(MACHINES, name), 'utf8'); }

function stampCtx(raw, ctx) {
  return raw.replace(/mn-ctx='[^']*'/, "mn-ctx='" + JSON.stringify(ctx).replace(/'/g, '&apos;') + "'");
}
function stampInitial(raw, state) {
  return raw.replace(/initial="[^"]*"/, 'initial="' + state + '"');
}
function readCtx(s, name) {
  var re = new RegExp('name="' + name + '"[^>]*mn-ctx=\'([^\']*)\'');
  var m = s.match(re);
  return m ? JSON.parse(m[1].replace(/&apos;/g, "'")) : null;
}
function readInit(s, name) {
  var re = new RegExp('name="' + name + '"[^>]*initial="([^"]*)"');
  var m = s.match(re);
  return m ? m[1] : null;
}

var alice = { username: 'alice', name: 'Alice Chen', role: 'requester' };
var bob = { username: 'bob', name: 'Bob Martinez', role: 'director' };

var poCtx = {
  title: 'Server Upgrade', amount: 75000,
  items: [{ name: 'Dell R750', qty: 5 }, { name: 'RAM 64GB', qty: 10 }],
  notes: 'Urgent Q4', cost_centre: 'OPS-017', internal_ref: 'Q4-INFRA', margin_pct: 8,
  $user: alice, $token: 'tok', submitted_at: 1000,
  newItem: '', urgent: true, approved_at: null, approved_by: null, cancelled_by: null
};


(async function () {

  // ═══ 1. Alice submits £75k PO → escalates ═════════════════════════
  console.log('\n1. Alice submits £75k PO');

  var r1 = await services.executeAsync(stampCtx(stampInitial(readScxml('purchase-order.scxml'), 'submitted'), poCtx));
  assert(r1.route !== null, 'escalated to director-review');
  var meta1 = transforms.extractMachine(r1.scxml);
  eq(meta1.state, 'director-approval', 'at director-approval');
  // Server stores the blocked machine (server.js does this)
  var storedId1 = db.insert(meta1.name, meta1.state, r1.scxml);


  // ═══ 2. Alice loads order-list → projected status at 'pending' ════
  console.log('\n2. Alice loads order-list (projected)');

  var listAlice = stampCtx(readScxml('order-list.scxml'), { _orderId: null, $user: alice });
  var r2 = await services.executeAsync(listAlice);
  var aliceCtx2 = readCtx(r2.scxml, 'purchase-order-status');
  assert(aliceCtx2 !== null, 'Alice gets purchase-order-status (not full PO)');
  eq(readInit(r2.scxml, 'purchase-order-status'), 'pending', 'at pending');
  eq(aliceCtx2.title, 'Server Upgrade', 'title visible');
  eq(aliceCtx2.item_count, 2, 'item count visible');
  eq(aliceCtx2.notes, undefined, 'notes hidden');
  eq(aliceCtx2.cost_centre, undefined, 'cost centre hidden');
  eq(aliceCtx2.margin_pct, undefined, 'margin hidden');


  // ═══ 3. Bob loads director-queue → full PO ════════════════════════
  console.log('\n3. Bob loads director-queue (full PO)');

  var queueBob = stampCtx(readScxml('director-queue.scxml'), { $user: bob });
  var r3 = await services.executeAsync(queueBob);
  var bobCtx = readCtx(r3.scxml, 'purchase-order');
  assert(bobCtx !== null, 'Bob gets full purchase-order');
  eq(bobCtx.notes, 'Urgent Q4', 'Bob sees notes');
  eq(bobCtx.cost_centre, 'OPS-017', 'Bob sees cost centre');
  eq(bobCtx.margin_pct, 8, 'Bob sees margin');
  eq(bobCtx.items.length, 2, 'Bob sees full items');


  // ═══ 4. Bob rejects ═══════════════════════════════════════════════
  // The browser fires director-reject (guard passes against $store).
  // The machine arrives at the server already at 'rejected' (browser transitioned).
  // The persist effect fires in the transition action. We simulate this by storing
  // the machine at 'rejected' state with Bob stamped as approved_by.
  console.log('\n4. Bob rejects the PO');

  var rejectedCtx = JSON.parse(JSON.stringify(poCtx));
  rejectedCtx.approved_by = bob;
  var rejectedScxml = stampCtx(stampInitial(readScxml('purchase-order.scxml'), 'rejected'), rejectedCtx);
  db.remove(storedId1);
  var rejectedId = db.insert('purchase-order', 'rejected', rejectedScxml);
  eq(db.byNameState('purchase-order', 'rejected').length, 1, 'PO stored at rejected');


  // ═══ 5. Alice loads order-list → projected status at 'rejected' ═══
  console.log('\n5. Alice loads order-list (sees rejection)');

  var r5 = await services.executeAsync(listAlice);
  var aliceCtx5 = readCtx(r5.scxml, 'purchase-order-status');
  eq(readInit(r5.scxml, 'purchase-order-status'), 'rejected', 'status at rejected');
  eq(aliceCtx5.title, 'Server Upgrade', 'title visible');
  eq(aliceCtx5.amount, 75000, 'original amount visible');
  eq(aliceCtx5.notes, undefined, 'notes still hidden');


  // ═══ 6. Alice updates amount to £25k and resubmits (reverse path) ═
  // Alice edits the title and amount on the status machine, clicks resubmit.
  // The status machine at 'resubmitting' routes to server with $canonical_id.
  // Server loads the canonical, merges Alice's edits, fires resubmit on canonical,
  // canonical goes submitted → auto-approves (£25k) → fulfilled, re-projects.
  console.log('\n6. Alice updates to £25k and resubmits (reverse path)');

  var statusResubmit = stampCtx(stampInitial(readScxml('purchase-order-status.scxml'), 'resubmitting'), {
    title: 'Server Upgrade (revised)', amount: 25000, item_count: 2,
    submitted_by: 'Alice Chen', $canonical_id: rejectedId,
    $user: alice, submitted_at: null, approved_at: null
  });
  var r6 = await services.executeAsync(statusResubmit);
  eq(readInit(r6.scxml, 'purchase-order-status'), 'fulfilled', 'reverse: auto-approved → fulfilled');
  var r6Ctx = readCtx(r6.scxml, 'purchase-order-status');
  eq(r6Ctx.title, 'Server Upgrade (revised)', 'updated title in projection');
  eq(r6Ctx.amount, 25000, 'updated amount in projection');
  eq(r6Ctx.notes, undefined, 'notes still hidden after resubmit');
  eq(r6Ctx.cost_centre, undefined, 'cost centre still hidden');


  // ═══ 7. New PO: Alice submits £60k, Bob approves ══════════════════
  console.log('\n7. Alice submits £60k PO');

  var r7 = await services.executeAsync(stampCtx(stampInitial(readScxml('purchase-order.scxml'), 'submitted'), {
    title: 'Network Refresh', amount: 60000,
    items: [{ name: 'Switch', qty: 3 }],
    notes: 'Replace EOL', cost_centre: 'NET-005', internal_ref: '', margin_pct: 0,
    $user: alice, $token: 'tok2', submitted_at: Date.now(),
    newItem: '', urgent: false, approved_at: null, approved_by: null, cancelled_by: null
  }));
  assert(r7.route !== null, '£60k escalated to director-review');
  var meta7 = transforms.extractMachine(r7.scxml);
  var storedId7 = db.insert(meta7.name, meta7.state, r7.scxml);


  // ═══ 8. Bob approves £60k PO ══════════════════════════════════════
  // Browser fires director-approve (guard passes). Machine arrives at server
  // at 'approved' state. Pipeline runs fulfil + persist from there.
  console.log('\n8. Bob approves £60k PO');

  var stored7 = db.one(storedId7);
  var approveCtx = JSON.parse(stored7.scxml.match(/mn-ctx='([^']*)'/)[1].replace(/&apos;/g, "'"));
  approveCtx.approved_by = bob;
  approveCtx.approved_at = Date.now();
  var approveScxml = stampCtx(stampInitial(stored7.scxml, 'approved'), approveCtx);
  var r8 = await services.executeAsync(approveScxml);
  var r8State = transforms.extractMachine(r8.scxml).state;
  eq(r8State, 'fulfilled', 'director-approved → fulfilled');


  // ═══ 9. Final DB state ═════════════════════════════════════════════
  console.log('\n9. Final DB state');

  var allPOs = db.byName('purchase-order');
  var fulfilled = allPOs.filter(function(r) { return r.state === 'fulfilled'; });
  eq(fulfilled.length, 2, 'two POs fulfilled in DB');


  // ═══ Summary ══════════════════════════════════════════════════════
  console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
  process.exit(failed > 0 ? 1 : 0);

})().catch(function (err) {
  console.error(err.message, err.stack);
  process.exit(1);
});
