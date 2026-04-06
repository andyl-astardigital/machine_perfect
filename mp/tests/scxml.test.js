/**
 * scxml.js — deep unit tests.
 *
 * Run: node mp/tests/scxml.test.js
 * Tests XML parsing, SCXML compilation, and end-to-end machine execution
 * from SCXML source to running instance.
 */

var scxml = require('../scxml.js');
var machine = require('../machine.js');
var engine = require('../engine.js');

var passed = 0;
var failed = 0;
var group = '';

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
function throws(fn, substring, message) {
  try { fn(); assert(false, message + ' — did not throw'); }
  catch (err) { assert(err.message.indexOf(substring) !== -1, message); }
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  XML parser                                                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('parseXML — basic elements');
var tree = scxml.parseXML('<root><child a="1"/></root>');
eq(tree.tag, 'root', 'root tag');
eq(tree.children.length, 1, 'one child');
eq(tree.children[0].tag, 'child', 'child tag');
eq(tree.children[0].attrs.a, '1', 'attribute value');

describe('parseXML — nested elements');
var nested = scxml.parseXML('<a><b><c x="y"/></b></a>');
eq(nested.children[0].tag, 'b', 'nested b');
eq(nested.children[0].children[0].tag, 'c', 'nested c');
eq(nested.children[0].children[0].attrs.x, 'y', 'nested attr');

describe('parseXML — self-closing');
var selfClose = scxml.parseXML('<root><empty/></root>');
eq(selfClose.children[0].tag, 'empty', 'self-closing element');
eq(selfClose.children[0].children.length, 0, 'no children');

describe('parseXML — multiple attributes');
var multi = scxml.parseXML('<el a="1" b="two" c="true"/>');
eq(multi.attrs.a, '1', 'attr a');
eq(multi.attrs.b, 'two', 'attr b');
eq(multi.attrs.c, 'true', 'attr c');

describe('parseXML — XML declaration skipped');
var withDecl = scxml.parseXML('<?xml version="1.0"?><root/>');
eq(withDecl.tag, 'root', 'declaration skipped');

describe('parseXML — comments skipped');
var withComment = scxml.parseXML('<!-- comment --><root><!-- inner --><child/></root>');
eq(withComment.tag, 'root', 'root found after comment');
eq(withComment.children.length, 1, 'child found after inner comment');

describe('parseXML — text content');
var withText = scxml.parseXML('<root>hello world</root>');
eq(withText.children.length, 1, 'text is a child node');
eq(withText.children[0].text, 'hello world', 'text content captured');

describe('parseXML — attributes with single quotes');
var singleQuote = scxml.parseXML("<el a='value'/>");
eq(singleQuote.attrs.a, 'value', 'single-quoted attribute');

describe('parseXML — mp- prefix attributes preserved by parser');
var mpAttrs = scxml.parseXML('<state id="x" mp-to="(when (> count 0) (to b))" mp-init="(inc! n)"/>');
eq(mpAttrs.attrs['mp-to'], '(when (> count 0) (to b))', 'mp-to attribute preserved');
eq(mpAttrs.attrs['mp-init'], '(inc! n)', 'mp-init attribute preserved');

describe('parseXML — error on empty input');
throws(function () { scxml.parseXML(''); }, 'no root', 'throws on empty');
throws(function () { scxml.parseXML('   '); }, 'no root', 'throws on whitespace');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SCXML compiler — basic                                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('compile — minimal machine');
var minDef = scxml.compile('<scxml initial="idle"><state id="idle"/></scxml>', { id: 'min' });
eq(minDef.id, 'min', 'uses provided id');
eq(minDef.initial, 'idle', 'initial state');
eq(typeof minDef.states.idle, 'object', 'idle state exists as object');

describe('compile — default initial to first state');
var defInit = scxml.compile('<scxml><state id="first"/><state id="second"/></scxml>', { id: 'x' });
eq(defInit.initial, 'first', 'defaults to first state');

describe('compile — rejects non-scxml root');
throws(function () { scxml.compile('<div/>'); }, 'root element must be <scxml>', 'rejects non-scxml');

describe('compile — datamodel');
var dataDef = scxml.compile([
  '<scxml initial="a">',
  '  <datamodel>',
  '    <data id="name" expr="\'Andrew\'"/>',
  '    <data id="count" expr="42"/>',
  '    <data id="items" expr="[]"/>',
  '    <data id="active" expr="true"/>',
  '    <data id="empty" expr="nil"/>',
  '  </datamodel>',
  '  <state id="a"/>',
  '</scxml>'
].join('\n'), { id: 'data' });

eq(dataDef.context.name, 'Andrew', 'string datamodel value');
eq(dataDef.context.count, 42, 'number datamodel value');
deepEq(dataDef.context.items, [], 'array datamodel value');
eq(dataDef.context.active, true, 'boolean datamodel value');
eq(dataDef.context.empty, null, 'nil datamodel value');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SCXML compiler — transitions                                           ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('compile — simple transition');
var transDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a"><transition event="go" target="b"/></state>',
  '  <state id="b"/>',
  '</scxml>'
].join('\n'), { id: 'trans' });

eq(Array.isArray(transDef.states.a.on.go), true, 'a.on.go is an array');
eq(transDef.states.a.on.go.length, 1, 'a has exactly one go transition');
eq(transDef.states.a.on.go[0].target, 'b', 'go targets b');

describe('compile — transition with mp-to s-expression');
var guardDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a">',
  '    <transition event="go" mp-to="(when (> total 0) (to b))"/>',
  '  </state>',
  '  <state id="b"/>',
  '</scxml>'
].join('\n'), { id: 'guard' });

eq(guardDef.states.a.on.go[0].guard, '(> total 0)', 'guard decomposed from mp-to');
eq(guardDef.states.a.on.go[0].target, 'b', 'target decomposed from mp-to');

describe('compile — transition with mp-to action + target');
var actionDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a">',
  '    <transition event="go" mp-to="(do (set! done true) (to b))"/>',
  '  </state>',
  '  <state id="b"/>',
  '</scxml>'
].join('\n'), { id: 'action' });

eq(actionDef.states.a.on.go[0].action, '(set! done true)', 'action decomposed from mp-to');
eq(actionDef.states.a.on.go[0].target, 'b', 'target decomposed from mp-to');

describe('compile — transition with mp-to emit');
var emitDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a">',
  '    <transition event="go" mp-to="(do (emit moved) (to b))"/>',
  '  </state>',
  '  <state id="b"/>',
  '</scxml>'
].join('\n'), { id: 'emit' });

eq(emitDef.states.a.on.go[0].emit, 'moved', 'emit decomposed from mp-to');
eq(emitDef.states.a.on.go[0].target, 'b', 'target decomposed from mp-to');

describe('compile — multiple transitions on same event');
var multiDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a">',
  '    <transition event="go" mp-to="(when (> x 10) (to b))"/>',
  '    <transition event="go" target="c"/>',
  '  </state>',
  '  <state id="b"/><state id="c"/>',
  '</scxml>'
].join('\n'), { id: 'multi' });

eq(multiDef.states.a.on.go.length, 2, 'two transitions on go');
eq(multiDef.states.a.on.go[0].guard, '(> x 10)', 'first has guard decomposed from mp-to');
eq(multiDef.states.a.on.go[1].target, 'c', 'second is fallback');

describe('compile — final state');
var finalDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a"><transition event="finish" target="done"/></state>',
  '  <final id="done"/>',
  '</scxml>'
].join('\n'), { id: 'final' });

eq(finalDef.states.done.final, true, 'final state flagged');

describe('compile — state with mp-init and mp-exit');
var hookDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a" mp-init="(set! entered true)" mp-exit="(set! exited true)">',
  '    <transition event="go" target="b"/>',
  '  </state>',
  '  <state id="b"/>',
  '</scxml>'
].join('\n'), { id: 'hooks' });

eq(hookDef.states.a.init, '(set! entered true)', 'init hook preserved');
eq(hookDef.states.a.exit, '(set! exited true)', 'exit hook preserved');

describe('compile — SCXML cond auto-generates guard');
var condDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a">',
  '    <transition event="go" target="b" cond="(> x 0)"/>',
  '  </state>',
  '  <state id="b"/>',
  '</scxml>'
].join('\n'), { id: 'cond' });

eq(condDef.states.a.on.go[0].guard, '(> x 0)', 'cond used as guard');
eq(condDef.states.a.on.go[0].target, 'b', 'cond preserves target');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  End-to-end: SCXML → definition → instance → events                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('e2e — purchase order workflow');

var poDef = scxml.compile([
  '<scxml xmlns="http://www.w3.org/2005/07/scxml"',
  '       ',
  '       initial="draft">',
  '  <datamodel>',
  '    <data id="title" expr="\'Untitled\'"/>',
  '    <data id="items" expr="[]"/>',
  '    <data id="submitted_at" expr="nil"/>',
  '    <data id="approved_at" expr="nil"/>',
  '  </datamodel>',
  '  <state id="draft">',
  '    <transition event="submit"',
  '                mp-to="(when (and (> (count items) 0) (not (empty? title))) (do (set! submitted_at (now)) (to submitted)))"/>',
  '  </state>',
  '  <state id="submitted">',
  '    <transition event="approve"',
  '                mp-to="(do (set! approved_at (now)) (emit order-approved) (to approved))"/>',
  '    <transition event="reject" target="rejected"/>',
  '  </state>',
  '  <final id="approved"/>',
  '  <final id="rejected"/>',
  '</scxml>'
].join('\n'), { id: 'purchase-order' });

// Create instance
var poInst = machine.createInstance(poDef, {
  id: 'po-001',
  context: { title: 'Server hardware', items: ['Dell R740', 'Rails'] }
});
eq(poInst.state, 'draft', 'starts in draft');
eq(poInst.context.title, 'Server hardware', 'context override applied');

// Guard blocks empty submission
var emptyPo = machine.createInstance(poDef, { id: 'po-002' });
var r1 = machine.sendEvent(emptyPo, 'submit');
eq(r1.transitioned, false, 'guard blocks empty items');

// Submit with items
var r2 = machine.sendEvent(poInst, 'submit');
eq(r2.transitioned, true, 'submit succeeded');
eq(poInst.state, 'submitted', 'now in submitted');
eq(typeof poInst.context.submitted_at, 'number', 'submitted_at is a number');
assert(poInst.context.submitted_at >= Date.now() - 1000, 'submitted_at is recent');
deepEq(r2.enabled, ['approve', 'reject'], 'approve and reject enabled');

// Approve
var r3 = machine.sendEvent(poInst, 'approve');
eq(r3.transitioned, true, 'approve succeeded');
eq(poInst.state, 'approved', 'now in approved');
eq(typeof poInst.context.approved_at, 'number', 'approved_at is a number');
eq(r3.isFinal, true, 'approved is final');
deepEq(r3.emits, ['order-approved', 'done.state.approved'], 'emitted order-approved + done.state');

// Cannot transition from final
var r4 = machine.sendEvent(poInst, 'approve');
eq(r4.transitioned, false, 'cannot transition from final state');

// History
eq(poInst.history.length, 2, 'two transitions recorded');
eq(poInst.history[0].event, 'submit', 'first event');
eq(poInst.history[1].event, 'approve', 'second event');

// Inspect
var info = machine.inspect(poInst);
eq(info.isFinal, true, 'inspect reports final');
eq(info.enabled.length, 0, 'no enabled transitions');

// Snapshot + restore
var snap = machine.snapshot(poInst);
var restored = machine.restore(poDef, snap);
eq(restored.state, 'approved', 'restored state');
eq(restored.context.title, 'Server hardware', 'restored context');

// Validate
var issues = machine.validate(poDef);
eq(issues.length, 0, 'purchase order definition is valid');

describe('e2e — reject path');

var rejectInst = machine.createInstance(poDef, {
  id: 'po-003',
  context: { title: 'Test', items: ['item'] }
});
machine.sendEvent(rejectInst, 'submit');
machine.sendEvent(rejectInst, 'reject');
eq(rejectInst.state, 'rejected', 'reject path works');
eq(machine.inspect(rejectInst).isFinal, true, 'rejected is final');

describe('e2e — asset management workflow');

var assetDef = scxml.compile([
  '<scxml initial="procurement">',
  '  <datamodel>',
  '    <data id="asset_id" expr="nil"/>',
  '    <data id="commissioned_at" expr="nil"/>',
  '    <data id="decommissioned_at" expr="nil"/>',
  '  </datamodel>',
  '  <state id="procurement">',
  '    <transition event="receive" mp-to="(do (set! asset_id (now)) (to received))"/>',
  '  </state>',
  '  <state id="received">',
  '    <transition event="commission" mp-to="(do (set! commissioned_at (now)) (to in-service))"/>',
  '  </state>',
  '  <state id="in-service">',
  '    <transition event="decommission" mp-to="(do (set! decommissioned_at (now)) (to decommissioned))"/>',
  '    <transition event="repair" target="maintenance"/>',
  '  </state>',
  '  <state id="maintenance">',
  '    <transition event="return" target="in-service"/>',
  '  </state>',
  '  <final id="decommissioned"/>',
  '</scxml>'
].join('\n'), { id: 'asset' });

var asset = machine.createInstance(assetDef, { id: 'asset-001' });
eq(asset.state, 'procurement', 'asset starts in procurement');

machine.sendEvent(asset, 'receive');
eq(asset.state, 'received', 'asset received');
eq(typeof asset.context.asset_id, 'number', 'asset_id assigned as timestamp');

machine.sendEvent(asset, 'commission');
eq(asset.state, 'in-service', 'asset commissioned');

machine.sendEvent(asset, 'repair');
eq(asset.state, 'maintenance', 'asset in maintenance');

machine.sendEvent(asset, 'return');
eq(asset.state, 'in-service', 'asset returned to service');

machine.sendEvent(asset, 'decommission');
eq(asset.state, 'decommissioned', 'asset decommissioned');
eq(machine.inspect(asset).isFinal, true, 'decommissioned is final');
eq(asset.history.length, 5, 'five transitions recorded');

var assetIssues = machine.validate(assetDef);
eq(assetIssues.length, 0, 'asset definition is valid');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Hierarchical SCXML                                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('SCXML — compound states compile correctly');

var batchScxml = [
  '<scxml id="batch" initial="idle">',
  '  <state id="idle"><transition event="START" target="running"/></state>',
  '  <state id="running" initial="filling">',
  '    <transition event="ABORT" mp-to="(do (set! err \'abort\') (to aborted))"/>',
  '    <state id="filling"><transition event="FULL" target="heating"/></state>',
  '    <state id="heating"><transition event="HOT" target="done"/></state>',
  '    <final id="done"/>',
  '  </state>',
  '  <final id="aborted"/>',
  '</scxml>'
].join('\n');

var batchCompiled = scxml.compile(batchScxml, {});
deepEq(Object.keys(batchCompiled.states.running.states).sort(), ['done', 'filling', 'heating'], 'running has children: done, filling, heating');
eq(batchCompiled.states.running.states.done.final, true, 'done is final');
eq(batchCompiled.states.running.initial, 'filling', 'running initial is filling');

describe('SCXML — compound state execution');

var batchInst = machine.createInstance(batchCompiled);
eq(batchInst.state, 'idle', 'starts in idle');
machine.sendEvent(batchInst, 'START');
eq(batchInst.state, 'running.filling', 'enters compound initial child');
machine.sendEvent(batchInst, 'FULL');
eq(batchInst.state, 'running.heating', 'transitions between siblings');
var abortResult = machine.sendEvent(batchInst, 'ABORT');
eq(batchInst.state, 'aborted', 'ABORT inherited from compound parent');
eq(batchInst.context.err, 'abort', 'abort action ran');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Summary                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
process.exit(failed > 0 ? 1 : 0);
