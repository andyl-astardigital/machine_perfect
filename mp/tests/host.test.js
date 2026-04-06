/**
 * server.js — API tests.
 *
 * Run: node mp/tests/host.test.js
 * Starts the server on a random port, exercises every endpoint,
 * verifies responses. Cleans up after itself.
 */

var http = require('http');
var server = require('../host');

var passed = 0;
var failed = 0;
var group = '';
var serverInstance;
var port = 14000 + Math.floor(Math.random() * 1000);
var base = 'http://localhost:' + port;

function describe(name) { group = name; console.log('\n' + name); }
function assert(condition, message) {
  if (condition) { passed++; console.log('  \u2713 ' + message); }
  else { failed++; console.log('  \u2717 ' + message); }
}
function eq(actual, expected, message) {
  assert(actual === expected, message + ' (got ' + JSON.stringify(actual) + ')');
}
function deepEq(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message + ' (got ' + JSON.stringify(actual) + ')');
}

// ── HTTP helpers ──

function request(method, path, body) {
  return new Promise(function (resolve, reject) {
    var url = new URL(base + path);
    var data = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);

    var req = http.request(opts, function (res) {
      var chunks = '';
      res.on('data', function (chunk) { chunks += chunk; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(chunks); } catch (e) {}
        resolve({ status: res.statusCode, body: json, raw: chunks });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function GET(path) { return request('GET', path); }
function POST(path, body) { return request('POST', path, body); }


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Tests                                                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

async function runTests() {
  // Suppress server console output during tests
  var origLog = console.log;
  console.log = function () {};
  serverInstance = server.createServer({
    port: port,
    machinesDir: require('path').join(__dirname, 'fixtures')
  });
  console.log = origLog;

  // Wait for server to be ready
  await new Promise(function (resolve) { setTimeout(resolve, 500); });


  // ── Definitions ──────────────────────────────────────────────────

  describe('GET /definitions');
  var defsRes = await GET('/definitions');
  eq(defsRes.status, 200, 'status 200');
  eq(defsRes.body.definitions.length, 2, 'exactly 2 definitions loaded');
  deepEq(defsRes.body.definitions.map(function (d) { return d.id; }).sort(), ['asset', 'purchase-order'], 'purchase-order and asset loaded');

  describe('GET /definitions/:id');
  var defRes = await GET('/definitions/purchase-order');
  eq(defRes.status, 200, 'status 200');
  eq(defRes.body.id, 'purchase-order', 'correct id');
  eq(defRes.body.initial, 'draft', 'initial state');
  deepEq(defRes.body.states.sort(), ['approved', 'draft', 'rejected', 'submitted'], 'all PO states listed');

  describe('GET /definitions/:id — not found');
  var notFoundRes = await GET('/definitions/nonexistent');
  eq(notFoundRes.status, 404, 'status 404');

  describe('POST /definitions/:id/validate');
  var valRes = await POST('/definitions/purchase-order/validate');
  eq(valRes.status, 200, 'status 200');
  eq(valRes.body.valid, true, 'purchase-order is valid');
  deepEq(valRes.body.issues, [], 'no issues');


  // ── Instance creation ────────────────────────────────────────────

  describe('POST /instances — create');
  var createRes = await POST('/instances', {
    definition: 'purchase-order',
    id: 'test-po-1',
    context: { title: 'Test Order', items: ['Widget'], amount: 500 }
  });
  eq(createRes.status, 201, 'status 201');
  eq(createRes.body.id, 'test-po-1', 'instance id');
  eq(createRes.body.definitionId, 'purchase-order', 'definition id');
  eq(createRes.body.state, 'draft', 'starts in draft');
  deepEq(createRes.body.enabled, ['submit'], 'submit is the only enabled event');
  eq(createRes.body.isFinal, false, 'not final');

  describe('POST /instances — missing definition');
  var missingRes = await POST('/instances', { definition: 'nope' });
  eq(missingRes.status, 404, 'status 404');

  describe('POST /instances — missing definition field');
  var noDefRes = await POST('/instances', {});
  eq(noDefRes.status, 400, 'status 400');

  describe('POST /instances — duplicate id');
  var dupRes = await POST('/instances', { definition: 'purchase-order', id: 'test-po-1' });
  eq(dupRes.status, 409, 'status 409');


  // ── Instance inspection ──────────────────────────────────────────

  describe('GET /instances');
  var listRes = await GET('/instances');
  eq(listRes.status, 200, 'status 200');
  eq(listRes.body.instances[0].id, 'test-po-1', 'test-po-1 listed');

  describe('GET /instances/:id');
  var inspRes = await GET('/instances/test-po-1');
  eq(inspRes.status, 200, 'status 200');
  eq(inspRes.body.state, 'draft', 'state is draft');
  eq(inspRes.body.context.title, 'Test Order', 'context preserved');

  describe('GET /instances/:id — not found');
  var instNotFound = await GET('/instances/nope');
  eq(instNotFound.status, 404, 'status 404');


  // ── Events ───────────────────────────────────────────────────────

  describe('POST /instances/:id/events/:event — submit');
  var submitRes = await POST('/instances/test-po-1/events/submit');
  eq(submitRes.status, 200, 'status 200');
  eq(submitRes.body.transitioned, true, 'transitioned');
  eq(submitRes.body.from, 'draft', 'from draft');
  eq(submitRes.body.to, 'submitted', 'to submitted');
  deepEq(submitRes.body.changed, ['submitted_at'], 'submitted_at is the only changed key');
  deepEq(submitRes.body.enabled.sort(), ['approve', 'reject', 'withdraw'], 'approve, reject, withdraw enabled');

  describe('POST /instances/:id/events/:event — guard blocks');
  // Create instance with no items — submit should fail
  await POST('/instances', { definition: 'purchase-order', id: 'test-po-empty' });
  var guardRes = await POST('/instances/test-po-empty/events/submit');
  eq(guardRes.body.transitioned, false, 'guard blocked');
  eq(guardRes.body.reason, 'no matching transition', 'reason reported');

  describe('POST /instances/:id/events/:event — approve');
  var approveRes = await POST('/instances/test-po-1/events/approve');
  eq(approveRes.body.transitioned, true, 'transitioned');
  eq(approveRes.body.to, 'approved', 'to approved');
  eq(approveRes.body.isFinal, true, 'is final');
  deepEq(approveRes.body.emits, ['order-approved', 'done.state.approved'], 'emitted event + done.state');

  describe('POST /instances/:id/events/:event — final state rejects');
  var finalRes = await POST('/instances/test-po-1/events/approve');
  eq(finalRes.body.transitioned, false, 'cannot transition from final');

  describe('POST /instances/:id/events/:event — unknown instance');
  var unknownRes = await POST('/instances/nope/events/go');
  eq(unknownRes.status, 404, 'status 404');


  // ── History ──────────────────────────────────────────────────────

  describe('GET /instances/:id/history');
  var histRes = await GET('/instances/test-po-1/history');
  eq(histRes.status, 200, 'status 200');
  eq(histRes.body.history.length, 2, 'two transitions');
  eq(histRes.body.history[0].event, 'submit', 'first event');
  eq(histRes.body.history[0].from, 'draft', 'from draft');
  eq(histRes.body.history[0].to, 'submitted', 'to submitted');
  eq(histRes.body.history[1].event, 'approve', 'second event');


  // ── Snapshot ─────────────────────────────────────────────────────

  describe('GET /instances/:id/snapshot');
  var snapRes = await GET('/instances/test-po-1/snapshot');
  eq(snapRes.status, 200, 'status 200');
  eq(snapRes.body.state, 'approved', 'snapshot state');
  eq(snapRes.body.definitionId, 'purchase-order', 'snapshot definition');
  eq(typeof snapRes.body.context.submitted_at, 'number', 'submitted_at is number in snapshot');
  eq(typeof snapRes.body.context.approved_at, 'number', 'approved_at is number in snapshot');


  // ── Asset workflow ───────────────────────────────────────────────

  describe('e2e — asset lifecycle via API');
  var assetCreate = await POST('/instances', {
    definition: 'asset',
    id: 'asset-001',
    context: { location: 'Warehouse A' }
  });
  eq(assetCreate.body.state, 'procurement', 'asset starts in procurement');

  var receive = await POST('/instances/asset-001/events/receive');
  eq(receive.body.to, 'received', 'received');

  var commission = await POST('/instances/asset-001/events/commission');
  eq(commission.body.to, 'in-service', 'commissioned');

  var repair = await POST('/instances/asset-001/events/repair');
  eq(repair.body.to, 'maintenance', 'in maintenance');

  var returnToService = await POST('/instances/asset-001/events/return-to-service');
  eq(returnToService.body.to, 'in-service', 'back in service');

  var decommission = await POST('/instances/asset-001/events/decommission');
  eq(decommission.body.to, 'decommissioned', 'decommissioned');
  eq(decommission.body.isFinal, true, 'is final');

  var assetHist = await GET('/instances/asset-001/history');
  eq(assetHist.body.history.length, 5, 'five transitions');


  // ── 404 on unknown routes ────────────────────────────────────────

  describe('unknown routes');
  var unknownRoute = await GET('/not/a/real/route');
  eq(unknownRoute.status, 404, '404 on unknown route');


  // ── Cleanup ──────────────────────────────────────────────────────

  serverInstance.close();

  console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(function (err) {
  console.error(err);
  if (serverInstance) serverInstance.close();
  process.exit(1);
});
