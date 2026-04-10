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

describe('parseXML — attributes with > inside values preserved by parser');
var mpAttrs = scxml.parseXML('<state id="x" test-expr="(when (> count 0) (to b))" mp-init="(inc! n)"/>');
eq(mpAttrs.attrs['test-expr'], '(when (> count 0) (to b))', 'attribute with > inside value preserved');
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

describe('compile — transition with child guard element');
var guardDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a">',
  '    <transition event="go" target="b"><mp-guard>(> total 0)</mp-guard></transition>',
  '  </state>',
  '  <state id="b"/>',
  '</scxml>'
].join('\n'), { id: 'guard' });

eq(guardDef.states.a.on.go[0].guard, '(> total 0)', 'guard from child mp-guard element');
eq(guardDef.states.a.on.go[0].target, 'b', 'target from attribute');

describe('compile — transition with child action element');
var actionDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a">',
  '    <transition event="go" target="b"><mp-action>(set! done true)</mp-action></transition>',
  '  </state>',
  '  <state id="b"/>',
  '</scxml>'
].join('\n'), { id: 'action' });

eq(actionDef.states.a.on.go[0].action, '(set! done true)', 'action from child mp-action element');
eq(actionDef.states.a.on.go[0].target, 'b', 'target from attribute');

describe('compile — transition with child emit element');
var emitDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a">',
  '    <transition event="go" target="b"><mp-emit>moved</mp-emit></transition>',
  '  </state>',
  '  <state id="b"/>',
  '</scxml>'
].join('\n'), { id: 'emit' });

eq(emitDef.states.a.on.go[0].emit, 'moved', 'emit from child mp-emit element');
eq(emitDef.states.a.on.go[0].target, 'b', 'target from attribute');

describe('compile — multiple transitions on same event (guarded + fallback)');
var multiDef = scxml.compile([
  '<scxml initial="a">',
  '  <state id="a">',
  '    <transition event="go" target="b"><mp-guard>(> x 10)</mp-guard></transition>',
  '    <transition event="go" target="c"/>',
  '  </state>',
  '  <state id="b"/><state id="c"/>',
  '</scxml>'
].join('\n'), { id: 'multi' });

eq(multiDef.states.a.on.go.length, 2, 'two transitions on go');
eq(multiDef.states.a.on.go[0].guard, '(> x 10)', 'first has guard from child element');
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
  '    <transition event="submit" target="submitted">',
  '      <mp-guard>(and (> (count items) 0) (not (empty? title)))</mp-guard>',
  '      <mp-action>(set! submitted_at (now))</mp-action>',
  '    </transition>',
  '  </state>',
  '  <state id="submitted">',
  '    <transition event="approve" target="approved">',
  '      <mp-action>(set! approved_at (now))</mp-action>',
  '      <mp-emit>order-approved</mp-emit>',
  '    </transition>',
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
  '    <transition event="receive" target="received">',
  '      <mp-action>(set! asset_id (now))</mp-action>',
  '    </transition>',
  '  </state>',
  '  <state id="received">',
  '    <transition event="commission" target="in-service">',
  '      <mp-action>(set! commissioned_at (now))</mp-action>',
  '    </transition>',
  '  </state>',
  '  <state id="in-service">',
  '    <transition event="decommission" target="decommissioned">',
  '      <mp-action>(set! decommissioned_at (now))</mp-action>',
  '    </transition>',
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
  '    <transition event="ABORT" target="aborted">',
  '      <mp-action>(set! err \'abort\')</mp-action>',
  '    </transition>',
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
// ║  Structural child elements in transitions                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('transition with <mp-guard> child compiles guard');

var guardScxml = '<?xml version="1.0"?><scxml id="sg" initial="a" mp-ctx=\'{"x":5}\'>' +
  '<state id="a"><transition event="go" target="b"><mp-guard>(> x 0)</mp-guard><mp-action>(set! x 0)</mp-action></transition></state>' +
  '<state id="b"/></scxml>';
var guardDef = scxml.compile(guardScxml, {});
var guardInst = machine.createInstance(guardDef);
var guardResult = machine.sendEvent(guardInst, 'go');
eq(guardResult.transitioned, true, 'guard (> x 0) passed with x=5');
eq(guardInst.state, 'b', 'transitioned to b');
eq(guardInst.context.x, 0, 'action (set! x 0) ran');

describe('transition with <mp-guard> blocks when false');

var guardScxml2 = '<?xml version="1.0"?><scxml id="sg2" initial="a" mp-ctx=\'{"x":0}\'>' +
  '<state id="a"><transition event="go" target="b"><mp-guard>(> x 0)</mp-guard></transition></state>' +
  '<state id="b"/></scxml>';
var guardDef2 = scxml.compile(guardScxml2, {});
var guardInst2 = machine.createInstance(guardDef2);
var guardResult2 = machine.sendEvent(guardInst2, 'go');
eq(guardResult2.transitioned, false, 'guard blocks when x=0');
eq(guardInst2.state, 'a', 'stays in a');

describe('transition with <mp-emit> child');

var emitScxml = '<?xml version="1.0"?><scxml id="se" initial="a" mp-ctx=\'{}\'>' +
  '<state id="a"><transition event="go" target="b"><mp-emit>went</mp-emit></transition></state>' +
  '<state id="b"/></scxml>';
var emitDef = scxml.compile(emitScxml, {});
var emitInst = machine.createInstance(emitDef);
var emitResult = machine.sendEvent(emitInst, 'go');
eq(emitResult.transitioned, true, 'transition succeeded');
deepEq(emitResult.emits, ['went'], 'emits exactly ["went"]');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Bug fixes                                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('Bug 14 — unterminated CDATA throws instead of falling through');

throws(function () {
  scxml.parseXML('<root><![CDATA[unterminated</root>');
}, 'unterminated CDATA', 'parseXML throws on unterminated CDATA section');


describe('Bug 15a — mp-exit attribute + <onexit> child logs a warning (symmetric with onentry)');

(function () {
  var warnings = [];
  var origWarn = console.warn;
  console.warn = function (msg) { warnings.push(msg); };

  var collidingExitScxml = '<?xml version="1.0"?><scxml id="colx" initial="a" mp-ctx=\'{}\'>' +
    '<state id="a" mp-exit="(set! x 1)">' +
    '<onexit><mp-action>(set! x 2)</mp-action></onexit>' +
    '<transition event="go" target="b"/>' +
    '</state>' +
    '<state id="b" mp-final/></scxml>';
  scxml.compile(collidingExitScxml, {});

  console.warn = origWarn;
  eq(warnings.filter(function (w) { return w.indexOf('mp-exit') !== -1 && w.indexOf('onexit') !== -1; }).length, 1,
    'warning logged when mp-exit and onexit both present');
})();


describe('Bug 15 — mp-init attribute + <onentry> child logs a warning');

(function () {
  var warnings = [];
  var origWarn = console.warn;
  console.warn = function (msg) { warnings.push(msg); };

  var collidingScxml = '<?xml version="1.0"?><scxml id="col" initial="a" mp-ctx=\'{}\'>' +
    '<state id="a" mp-init="(set! x 1)">' +
    '<onentry><mp-action>(set! x 2)</mp-action></onentry>' +
    '<transition event="go" target="b"/>' +
    '</state>' +
    '<state id="b" mp-final/></scxml>';
  scxml.compile(collidingScxml, {});

  console.warn = origWarn;
  eq(warnings.filter(function (w) { return w.indexOf('mp-init') !== -1 && w.indexOf('onentry') !== -1; }).length, 1,
    'warning logged when mp-init and onentry both present');
})();


describe('Bug 16 — <mp-where> child element compiled into state spec');

var whereScxmlStr = '<?xml version="1.0"?><scxml id="where-test" initial="a" mp-ctx=\'{}\'>' +
  '<state id="a"><mp-where>(requires \'ui-render\')</mp-where>' +
  '<transition event="go" target="b"/>' +
  '</state>' +
  '<state id="b" mp-final/></scxml>';
var whereDef = scxml.compile(whereScxmlStr, {});
eq(whereDef._stateTree['a'].spec.where, "(requires 'ui-render')", '<mp-where> child compiled into state spec.where');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Quality check — new bugs                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('H4 — unterminated comment inside element throws, not infinite loop');

throws(function () {
  scxml.parseXML('<root><!-- unterminated</root>');
}, 'unterminated', 'unterminated comment inside element throws');

throws(function () {
  scxml.parseXML('<scxml initial="a"><state id="a"><!-- no close</state></scxml>');
}, 'unterminated', 'unterminated comment inside state element throws');


describe('L3 — <onentry><mp-action> child is read by extractActions');

var mpActionScxml = [
  '<?xml version="1.0"?>',
  '<scxml id="mpa" initial="a" mp-ctx="{}">',
  '  <state id="a">',
  '    <onentry><mp-action>(set! x 1)</mp-action></onentry>',
  '    <transition event="go" target="b"/>',
  '  </state>',
  '  <state id="b" mp-final/>',
  '</scxml>'
].join('\n');
var mpActionDef = scxml.compile(mpActionScxml, {});
eq(mpActionDef._stateTree['a'].spec.init, '(set! x 1)', '<onentry><mp-action> produces non-null init');

var mpActionInst = machine.createInstance(mpActionDef, { context: { x: 0 } });
eq(mpActionInst.context.x, 1, 'init action from <mp-action> ran on entry');


describe('mp-temporal preserved through compile — attribute form (backwards compat)');
var temporalDef = scxml.compile('<scxml initial="a"><state id="a" mp-temporal="(after 5000 (to b))"/><state id="b"/></scxml>');
eq(temporalDef.states.a.temporal, '(after 5000 (to b))', 'mp-temporal attribute stored on state definition');

describe('mp-temporal preserved through compile — element form (canonical)');
var temporalDefEl = scxml.compile('<scxml initial="a"><state id="a"><mp-temporal>(animate)</mp-temporal></state><state id="b"/></scxml>');
eq(temporalDefEl.states.a.temporal, '(animate)', 'mp-temporal element stored on state definition');


describe('parseXML — text content entities are unescaped');
var entityXml = scxml.parseXML('<root><guard>&lt; x 10</guard></root>');
var guardText = entityXml.children[0].children[0].text;
eq(guardText, '< x 10', 'text content &lt; unescaped to <');

var entityXml2 = scxml.parseXML('<root><data>&amp;amp; &lt;tag&gt;</data></root>');
var dataText = entityXml2.children[0].children[0].text;
eq(dataText, '&amp; <tag>', 'multiple entities unescaped in text content');


describe('compile — guard in text content (no CDATA) with entities');
var entityGuardDef = scxml.compile('<scxml initial="a"><state id="a"><transition event="go" target="b"><mp-guard>&lt; x 10</mp-guard></transition></state><state id="b"/></scxml>');
eq(entityGuardDef.states.a.on.go[0].guard, '< x 10', 'guard text entities unescaped by parser');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Summary                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
process.exit(failed > 0 ? 1 : 0);
