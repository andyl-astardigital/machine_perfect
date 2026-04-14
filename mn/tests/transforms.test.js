/**
 * transforms.js — hand-computed tests.
 *
 * Tests the SCXML-native transform utilities.
 * No HTML bridge functions — SCXML is the only wire format.
 *
 * Run: node mn/tests/transforms.test.js
 */

var transforms = require('../transforms.js');

var passed = 0;
var failed = 0;

function describe(name) { console.log('\n' + name); }
function assert(condition, message) {
  if (condition) { passed++; console.log('  \u2713 ' + message); }
  else { failed++; console.log('  \u2717 ' + message); }
}
function eq(actual, expected, message) {
  assert(actual === expected, message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}
function deepEq(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message + ' (got ' + JSON.stringify(actual) + ')');
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  extractContext — reads context from SCXML mn-ctx attribute             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('extractContext — single-quoted mn-ctx on SCXML');

var scxml1 = '<scxml id="order" initial="draft" mn-ctx=\'{"title":"Laptop","amount":750,"items":[{"name":"Stand","qty":2}]}\'><state id="draft"/></scxml>';
var ctx1 = transforms.extractContext(scxml1);
eq(ctx1.title, 'Laptop', 'title');
eq(ctx1.amount, 750, 'amount');
eq(ctx1.items.length, 1, 'items count');
eq(ctx1.items[0].name, 'Stand', 'item name');
eq(ctx1.items[0].qty, 2, 'item qty');


describe('extractContext — nested objects and arrays');

var scxml2 = '<scxml id="po" initial="draft" mn-ctx=\'{"title":"Big Order","amount":999,"items":[{"name":"A","qty":1},{"name":"B","qty":3}],"notes":"urgent","urgent":true}\'><state id="draft"/></scxml>';
var ctx2 = transforms.extractContext(scxml2);
eq(ctx2.title, 'Big Order', 'title');
eq(ctx2.items.length, 2, '2 items');
eq(ctx2.items[1].name, 'B', 'second item name');
eq(ctx2.items[1].qty, 3, 'second item qty');
eq(ctx2.notes, 'urgent', 'notes');
eq(ctx2.urgent, true, 'boolean true');


describe('extractContext — no mn-ctx returns empty object');

var scxml3 = '<scxml id="simple" initial="a"><state id="a"/></scxml>';
var ctx3 = transforms.extractContext(scxml3);
deepEq(ctx3, {}, 'empty object when no mn-ctx');


describe('extractContext — malformed JSON returns empty object');

var scxml4 = '<scxml id="bad" mn-ctx=\'not json\'><state id="a"/></scxml>';
var ctx4 = transforms.extractContext(scxml4);
deepEq(ctx4, {}, 'empty object on bad JSON');


describe('extractContext — with &apos; entities');

var scxml5 = "<scxml id=\"order\" mn-ctx='{\"title\":\"It&apos;s a test\",\"amount\":100}'><state id=\"draft\"/></scxml>";
var ctx5 = transforms.extractContext(scxml5);
eq(ctx5.title, "It's a test", 'title with apostrophe entity');
eq(ctx5.amount, 100, 'amount');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  extractMachine — reads id, initial, and context from SCXML             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('extractMachine — reads id and initial from SCXML root');

var scxml6 = '<scxml id="purchase-order" initial="submitted" mn-ctx=\'{"title":"Test","amount":50}\'><state id="draft"/><state id="submitted"/></scxml>';
var result6 = transforms.extractMachine(scxml6);
eq(result6.name, 'purchase-order', 'machine name from id attribute');
eq(result6.state, 'submitted', 'current state from initial attribute');
eq(result6.context.title, 'Test', 'context title');
eq(result6.context.amount, 50, 'context amount');


describe('extractMachine — no initial defaults to null');

var scxml7 = '<scxml id="app" mn-ctx=\'{"x":1}\'><state id="idle"/></scxml>';
var result7 = transforms.extractMachine(scxml7);
eq(result7.name, 'app', 'name');
eq(result7.state, null, 'state is null when no initial');
eq(result7.context.x, 1, 'context value');


describe('extractMachine — no id defaults to null');

var scxml8 = '<scxml initial="ready"><state id="ready"/></scxml>';
var result8 = transforms.extractMachine(scxml8);
eq(result8.name, null, 'name is null when no id');
eq(result8.state, 'ready', 'state from initial');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  updateScxmlState — mutates SCXML initial and context in place          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('updateScxmlState — updates initial attribute');

var scxml9 = '<scxml id="po" initial="draft" mn-ctx=\'{"title":"Test"}\'><state id="draft"/><state id="submitted"/></scxml>';
var updated9 = transforms.updateScxmlState(scxml9, 'submitted');
assert(updated9.indexOf('initial="submitted"') !== -1, 'initial changed to submitted');
assert(updated9.indexOf('initial="draft"') === -1, 'old initial removed');


describe('updateScxmlState — updates context');

var updated10 = transforms.updateScxmlState(scxml9, 'submitted', { title: 'Updated', amount: 100 });
assert(updated10.indexOf('initial="submitted"') !== -1, 'initial is submitted');
var ctx10 = transforms.extractContext(updated10);
eq(ctx10.title, 'Updated', 'context title updated');
eq(ctx10.amount, 100, 'context amount added');


describe('updateScxmlState — context with & character round-trips correctly');

var ampScxml = '<scxml id="amp" initial="a" mn-ctx=\'{"name":"plain"}\'><state id="a"/></scxml>';
var ampUpdated = transforms.updateScxmlState(ampScxml, 'a', { name: 'AT&T', value: 'a&b<c' });
var ampCtx = transforms.extractContext(ampUpdated);
eq(ampCtx.name, 'AT&T', 'ampersand in context value survives round-trip');
eq(ampCtx.value, 'a&b<c', 'ampersand and < in context value survive round-trip');


describe('updateScxmlState — adds initial if missing');

var scxml11 = '<scxml id="po"><state id="draft"/></scxml>';
var updated11 = transforms.updateScxmlState(scxml11, 'draft');
assert(updated11.indexOf('initial="draft"') !== -1, 'initial added');


describe('updateScxmlState — adds mn-ctx if missing');

var scxml12 = '<scxml id="po" initial="draft"><state id="draft"/></scxml>';
var updated12 = transforms.updateScxmlState(scxml12, 'draft', { x: 42 });
var ctx12 = transforms.extractContext(updated12);
eq(ctx12.x, 42, 'context injected');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  HTML bridge functions are REMOVED                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('htmlToScxml — not exported');
eq(transforms.htmlToScxml, undefined, 'htmlToScxml is undefined');

describe('scxmlToHtml — not exported');
eq(transforms.scxmlToHtml, undefined, 'scxmlToHtml is undefined');

describe('extractStructuralTransitions — not exported');
eq(transforms.extractStructuralTransitions, undefined, 'extractStructuralTransitions is undefined');

describe('extractAttr — not exported');
eq(transforms.extractAttr, undefined, 'extractAttr is undefined');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Public API shape                                                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Transport metadata                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('extractMetadata — reads attributes from scxml root');

var metaScxml = '<scxml id="test" mn-id="po_browser-1" mn-source="browser-1" mn-sequence="3" initial="draft"><state id="draft"/></scxml>';
eq(transforms.extractMetadata(metaScxml, 'mn-id'), 'po_browser-1', 'extracts mn-id');
eq(transforms.extractMetadata(metaScxml, 'mn-source'), 'browser-1', 'extracts mn-source');
eq(transforms.extractMetadata(metaScxml, 'mn-sequence'), '3', 'extracts mn-sequence');
eq(transforms.extractMetadata(metaScxml, 'mn-missing'), null, 'returns null for missing attr');

describe('stampMetadata — adds attributes to scxml root');

var stampInput = '<scxml id="test" initial="draft"><state id="draft"/></scxml>';
var stamped = transforms.stampMetadata(stampInput, { 'mn-id': 'po_b1', 'mn-source': 'b1', 'mn-sequence': 1 });
eq(stamped.indexOf('mn-id="po_b1"') !== -1, true, 'stamped mn-id');
eq(stamped.indexOf('mn-source="b1"') !== -1, true, 'stamped mn-source');
eq(stamped.indexOf('mn-sequence="1"') !== -1, true, 'stamped mn-sequence');
eq(stamped.indexOf('<scxml ') === 0 || stamped.indexOf('<scxml ') > 0, true, 'scxml tag preserved');

describe('metadata round-trip — stamp then extract');

var rtInput = '<scxml id="rt" initial="a"><state id="a"/></scxml>';
var rtStamped = transforms.stampMetadata(rtInput, { 'mn-id': 'order_xyz', 'mn-source': 'server-1', 'mn-sequence': 7 });
eq(transforms.extractMetadata(rtStamped, 'mn-id'), 'order_xyz', 'round-trip mn-id');
eq(transforms.extractMetadata(rtStamped, 'mn-source'), 'server-1', 'round-trip mn-source');
eq(transforms.extractMetadata(rtStamped, 'mn-sequence'), '7', 'round-trip mn-sequence');

describe('stampMetadata — empty attrs is no-op');

var noopInput = '<scxml id="x"><state id="a"/></scxml>';
eq(transforms.stampMetadata(noopInput, {}), noopInput, 'empty attrs returns original');

describe('stampMetadata — escapes special characters');

var escStamped = transforms.stampMetadata('<scxml id="x"/>', { 'mn-id': 'a&b<c' });
eq(escStamped.indexOf('a&amp;b&lt;c') !== -1, true, 'special chars escaped');


describe('Public API — SCXML-native + metadata functions exported');
eq(typeof transforms.extractContext, 'function', 'extractContext exported');
eq(typeof transforms.extractMachine, 'function', 'extractMachine exported');
eq(typeof transforms.updateScxmlState, 'function', 'updateScxmlState exported');
eq(typeof transforms.extractMetadata, 'function', 'extractMetadata exported');
eq(typeof transforms.stampMetadata, 'function', 'stampMetadata exported');
eq(typeof transforms.esc, 'function', 'esc exported');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  extractMachine — defensive against invalid input                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('extractContext — null input returns empty object');

var ctxNull = transforms.extractContext(null);
deepEq(ctxNull, {}, 'null input returns empty object');

var ctxUndef = transforms.extractContext(undefined);
deepEq(ctxUndef, {}, 'undefined input returns empty object');


describe('extractMachine — null input returns safe object');

var nullResult = transforms.extractMachine(null);
eq(nullResult.name, null, 'null input: name is null');
eq(nullResult.state, null, 'null input: state is null');

describe('extractMachine — undefined input returns safe object');

var undefResult = transforms.extractMachine(undefined);
eq(undefResult.name, null, 'undefined input: name is null');
eq(undefResult.state, null, 'undefined input: state is null');

describe('extractMachine — empty string returns safe object');

var emptyResult = transforms.extractMachine('');
eq(emptyResult.name, null, 'empty string: name is null');
eq(emptyResult.state, null, 'empty string: state is null');

describe('extractMachine — number input returns safe object');

var numResult = transforms.extractMachine(42);
eq(numResult.name, null, 'number input: name is null');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Summary                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
process.exit(failed > 0 ? 1 : 0);
