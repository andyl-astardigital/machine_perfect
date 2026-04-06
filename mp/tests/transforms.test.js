/**
 * transforms.js — hand-computed tests for extractContext.
 *
 * Run: node mp/tests/transforms.test.js
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
// ║  extractContext — reads context from machine HTML                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('extractContext — single-quoted mp-ctx');

var html1 = '<div mp="order" mp-ctx=\'{"title":"Laptop","amount":750,"items":[{"name":"Stand","qty":2}]}\'><div mp-state="draft"></div></div>';
var ctx1 = transforms.extractContext(html1);
eq(ctx1.title, 'Laptop', 'title');
eq(ctx1.amount, 750, 'amount');
eq(ctx1.items.length, 1, 'items count');
eq(ctx1.items[0].name, 'Stand', 'item name');
eq(ctx1.items[0].qty, 2, 'item qty');


describe('extractContext — double-quoted mp-ctx with &quot; entities (browser outerHTML)');

var html2 = '<div mp="order" mp-ctx="{&quot;title&quot;:&quot;Browser Test&quot;,&quot;amount&quot;:500,&quot;items&quot;:[]}"><div mp-state="draft"></div></div>';
var ctx2 = transforms.extractContext(html2);
eq(ctx2.title, 'Browser Test', 'title from double-quoted');
eq(ctx2.amount, 500, 'amount from double-quoted');
deepEq(ctx2.items, [], 'empty items from double-quoted');


describe('extractContext — with &#39; entities in single-quoted');

var html3 = "<div mp=\"order\" mp-ctx='{\"title\":\"It&#39;s a test\",\"amount\":100}'><div mp-state=\"draft\"></div></div>";
var ctx3 = transforms.extractContext(html3);
eq(ctx3.title, "It's a test", 'title with apostrophe entity');
eq(ctx3.amount, 100, 'amount');


describe('extractContext — nested objects and arrays');

var html4 = '<div mp="po" mp-ctx=\'{"title":"Big Order","amount":999,"items":[{"name":"A","qty":1},{"name":"B","qty":3}],"notes":"urgent","urgent":true}\'></div>';
var ctx4 = transforms.extractContext(html4);
eq(ctx4.title, 'Big Order', 'title');
eq(ctx4.items.length, 2, '2 items');
eq(ctx4.items[1].name, 'B', 'second item name');
eq(ctx4.items[1].qty, 3, 'second item qty');
eq(ctx4.notes, 'urgent', 'notes');
eq(ctx4.urgent, true, 'boolean true');


describe('extractContext — no mp-ctx returns empty object');

var html5 = '<div mp="simple"><div mp-state="a"></div></div>';
var ctx5 = transforms.extractContext(html5);
deepEq(ctx5, {}, 'empty object when no mp-ctx');


describe('extractContext — malformed JSON returns empty object');

var html6 = '<div mp="bad" mp-ctx=\'not json\'></div>';
var ctx6 = transforms.extractContext(html6);
deepEq(ctx6, {}, 'empty object on bad JSON');


describe('extractContext — also extracts machine name and current state');

var html7 = '<div mp="purchase-order" mp-current-state="submitted" mp-ctx=\'{"title":"Test","amount":50}\'><div mp-state="draft"></div></div>';
var result7 = transforms.extractMachine(html7);
eq(result7.name, 'purchase-order', 'machine name');
eq(result7.state, 'submitted', 'current state');
eq(result7.context.title, 'Test', 'context title');
eq(result7.context.amount, 50, 'context amount');


describe('extractMachine — no current state defaults to null');

var html8 = '<div mp="app" mp-ctx=\'{"x":1}\'><div mp-state="idle"></div></div>';
var result8 = transforms.extractMachine(html8);
eq(result8.name, 'app', 'name');
eq(result8.state, null, 'state is null when not set');
eq(result8.context.x, 1, 'context value');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Namespace unification — mp- everywhere, no mp:                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('htmlToScxml — unified mp-to');

var nsHtml = '<div mp="test" mp-ctx=\'{"x":1}\'><div mp-state="a"><button mp-to="(when (> x 0) (do (inc! x) (emit done) (to b)))">Go</button></div><div mp-state="b"></div></div>';
var nsScxml = transforms.htmlToScxml(nsHtml);

assert(nsScxml.indexOf('mp-to=') !== -1, 'SCXML has mp-to attribute');
assert(nsScxml.indexOf('mp-guard') === -1, 'SCXML has no mp-guard (dead attribute)');
assert(nsScxml.indexOf('mp-action') === -1, 'SCXML has no mp-action (dead attribute)');
assert(nsScxml.indexOf('mp-emit') === -1, 'SCXML has no mp-emit (dead attribute)');
assert(nsScxml.indexOf('mp-ctx=') !== -1, 'SCXML has mp-ctx attribute');
assert(nsScxml.indexOf('xmlns:') === -1, 'no xmlns namespace declaration');
assert(nsScxml.indexOf('mp:') === -1, 'no mp: prefix anywhere in output');

describe('htmlToScxml — bare mp-to passes through');

var nsHtmlBare = '<div mp="t3" mp-ctx=\'{}\'><div mp-state="a"><button mp-to="b">Go</button></div><div mp-state="b"></div></div>';
var nsScxmlBare = transforms.htmlToScxml(nsHtmlBare);
assert(nsScxmlBare.indexOf('target="b"') !== -1, 'bare mp-to becomes target attribute in SCXML');


describe('htmlToScxml — mp-init and mp-exit use mp- prefix');

var nsHtml2 = '<div mp="t2" mp-ctx=\'{}\'><div mp-state="a" mp-init="(log \'enter\')" mp-exit="(log \'exit\')"></div></div>';
var nsScxml2 = transforms.htmlToScxml(nsHtml2);

assert(nsScxml2.indexOf("mp-init=") !== -1, 'SCXML has mp-init');
assert(nsScxml2.indexOf("mp-exit=") !== -1, 'SCXML has mp-exit');


describe('scxmlToHtml — unified mp-to preserved');

var nsScxmlInput = '<?xml version="1.0"?><scxml xmlns="http://www.w3.org/2005/07/scxml" id="rt" initial="a" mp-ctx=\'{"v":42}\'><state id="a" mp-init="(log \'hi\')" mp-exit="(log \'bye\')"><transition event="go" mp-to="(when (> v 0) (do (inc! v) (emit moved) (to b)))"/></state><state id="b"/></scxml>';
var nsHtmlOut = transforms.scxmlToHtml(nsScxmlInput);

assert(nsHtmlOut.indexOf('mp-to=') !== -1, 'HTML has mp-to attribute');
assert(nsHtmlOut.indexOf('mp-guard') === -1, 'HTML has no mp-guard');
assert(nsHtmlOut.indexOf('mp-action') === -1, 'HTML has no mp-action');
assert(nsHtmlOut.indexOf("mp-init") !== -1, 'HTML has mp-init');
assert(nsHtmlOut.indexOf("mp-exit") !== -1, 'HTML has mp-exit');
assert(nsHtmlOut.indexOf('mp-ctx') !== -1, 'HTML has mp-ctx');
assert(nsHtmlOut.indexOf('mp:') === -1, 'HTML has no mp: prefix');

describe('scxmlToHtml — bare target preserved');

var nsScxmlBare2 = '<?xml version="1.0"?><scxml id="t" initial="a"><state id="a"><transition event="go" target="b"/></state><state id="b"/></scxml>';
var nsHtmlBare2 = transforms.scxmlToHtml(nsScxmlBare2);
assert(nsHtmlBare2.indexOf('mp-to="b"') !== -1, 'bare target becomes mp-to in HTML');


describe('updateScxmlState — uses mp-ctx not mp-ctx');

var nsScxmlUpdate = '<?xml version="1.0"?><scxml id="u" initial="a" mp-ctx=\'{"n":0}\'><state id="a"><transition event="b" target="b"/></state><state id="b"/></scxml>';
var nsUpdated = transforms.updateScxmlState(nsScxmlUpdate, 'b', { n: 99 });

assert(nsUpdated.indexOf('initial="b"') !== -1, 'initial updated to b');
assert(nsUpdated.indexOf('mp-ctx=') !== -1, 'output has mp-ctx attribute');
assert(nsUpdated.indexOf('"n":99') !== -1 || nsUpdated.indexOf('"n": 99') !== -1, 'context n updated to 99');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  htmlToScxml — template-in-DOM transport (browser outerHTML)            ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// When the browser serialises outerHTML, template elements sit alongside
// state divs. The active state has BOTH live content and a template sibling.
// Inactive states are empty divs with a template sibling. htmlToScxml must
// extract transitions from templates for all states without duplicates.

describe('htmlToScxml — browser outerHTML with template-in-DOM');

var tmplHtml = '<div mp="transport-test" mp-current-state="draft" mp-ctx=\'{"x":1}\'>' +
  '<div mp-state="draft"><button mp-to="(when (> x 0) (to submitted))">Go</button></div>' +
  '<template mp-state-template="draft"><button mp-to="(when (> x 0) (to submitted))">Go</button></template>' +
  '<div mp-state="submitted" hidden></div>' +
  '<template mp-state-template="submitted"><button mp-to="(to approved)">Approve</button><button mp-to="(to rejected)">Reject</button></template>' +
  '<div mp-state="approved" hidden></div>' +
  '<template mp-state-template="approved"><button mp-to="(do (invoke! :type \'fulfil\') (to fulfilled))">Fulfil</button></template>' +
  '<div mp-state="fulfilled" mp-final hidden></div>' +
  '<div mp-state="rejected" mp-final hidden></div>' +
  '</div>';

var tmplScxml = transforms.htmlToScxml(tmplHtml);

eq((tmplScxml.match(/id="draft"/g) || []).length, 1, 'draft state appears once');
eq((tmplScxml.match(/<transition[^>]*submitted/g) || []).length, 1, 'draft has exactly 1 transition to submitted (no duplicates)');

assert(tmplScxml.indexOf('mp-to="(to approved)"') !== -1, 'submitted state has approve transition from template');
assert(tmplScxml.indexOf('mp-to="(to rejected)"') !== -1, 'submitted state has reject transition from template');
eq((tmplScxml.match(/<transition[^>]*approved/g) || []).length, 1, 'submitted has exactly 1 approve transition');

assert(tmplScxml.indexOf('mp-to="(do (invoke!') !== -1, 'approved state has fulfil transition from template');
eq((tmplScxml.match(/<final id="fulfilled"/g) || []).length, 1, 'fulfilled is a final state');
eq((tmplScxml.match(/<final id="rejected"/g) || []).length, 1, 'rejected is a final state');


describe('htmlToScxml — targetless transitions excluded from SCXML');

// Simulates real browser outerHTML: the draft state has UI action buttons
// (emit, push!, remove-where!) alongside real state transitions (to submitted).
// Only transitions with (to ...) targets belong in SCXML.
var uiHtml = '<div mp="po-real" mp-current-state="draft" mp-ctx=\'{"title":"Test","amount":500,"items":[{"name":"Widget","qty":1}],"newItem":"","submitted_at":null}\'>' +
  '<div mp-state="draft">' +
  '<button mp-to="(emit navigate-orders)">Cancel</button>' +
  '<button mp-to="(when (not (empty? newItem)) (do (push! items (obj :name newItem :qty 1)) (set! newItem \'\')))">Add</button>' +
  '<button mp-to="(remove-where! items :name name)">Remove</button>' +
  '<button mp-to="(when (and (> (count items) 0) (> amount 0)) (do (set! submitted_at (now)) (to submitted)))">Submit</button>' +
  '</div>' +
  '<template mp-state-template="draft">' +
  '<button mp-to="(emit navigate-orders)">Cancel</button>' +
  '<button mp-to="(when (not (empty? newItem)) (do (push! items (obj :name newItem :qty 1)) (set! newItem \'\')))">Add</button>' +
  '<button mp-to="(remove-where! items :name name)">Remove</button>' +
  '<button mp-to="(when (and (> (count items) 0) (> amount 0)) (do (set! submitted_at (now)) (to submitted)))">Submit</button>' +
  '</template>' +
  '<div mp-state="submitted" hidden></div>' +
  '<template mp-state-template="submitted">' +
  '<button mp-to="(when (some? title) (do (set! approved_at (now)) (to approved)))">Approve</button>' +
  '<button mp-to="(do (to rejected))">Reject</button>' +
  '</template>' +
  '<div mp-state="approved" hidden></div>' +
  '<template mp-state-template="approved">' +
  '<button mp-to="(do (invoke! :type \'fulfil\') (to fulfilled))">Fulfil</button>' +
  '</template>' +
  '<div mp-state="fulfilled" mp-final hidden></div>' +
  '<div mp-state="rejected" mp-final hidden></div>' +
  '</div>';

var uiScxml = transforms.htmlToScxml(uiHtml);

// Draft: only the (to submitted) transition should survive — emit, push!, remove-where! are UI actions
eq((uiScxml.match(/<transition/g) || []).length, 4, 'exactly 4 transitions total (submit, approve, reject, fulfil)');
assert(uiScxml.indexOf('navigate-orders') === -1, 'emit navigate-orders excluded from SCXML');
assert(uiScxml.indexOf('push!') === -1, 'push! excluded from SCXML');
assert(uiScxml.indexOf('remove-where!') === -1, 'remove-where! excluded from SCXML');
assert(uiScxml.indexOf('(to submitted)') !== -1, 'submit transition preserved');
assert(uiScxml.indexOf('(to approved)') !== -1, 'approve transition preserved');
assert(uiScxml.indexOf('(to rejected)') !== -1, 'reject transition preserved');
assert(uiScxml.indexOf('(to fulfilled)') !== -1, 'fulfil transition preserved');


describe('htmlToScxml — no templates (server-built HTML) still works');

var noTmplHtml = '<div mp="classic" mp-ctx=\'{}\'>' +
  '<div mp-state="a"><button mp-to="b">Go</button></div>' +
  '<div mp-state="b"><button mp-to="a">Back</button></div>' +
  '</div>';
var noTmplScxml = transforms.htmlToScxml(noTmplHtml);

assert(noTmplScxml.indexOf('target="b"') !== -1, 'a→b transition present');
assert(noTmplScxml.indexOf('target="a"') !== -1, 'b→a transition present');
eq((noTmplScxml.match(/<transition/g) || []).length, 2, 'exactly 2 transitions total');


describe('htmlToScxml — HTML comments containing mp-to do not crash');

var commentHtml = '<div mp="comment-test" mp-ctx=\'{}\'>' +
  '<!-- mp-to uses the full expression -->' +
  '<div mp-state="a"><button mp-to="b">Go</button></div>' +
  '<div mp-state="b"></div></div>';
var commentScxml = transforms.htmlToScxml(commentHtml);
eq((commentScxml.match(/target="b"/g) || []).length, 1, 'transition target="b" present exactly once');
eq((commentScxml.match(/<transition/g) || []).length, 1, 'exactly 1 transition (comment not parsed as attribute)');


// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
process.exit(failed > 0 ? 1 : 0);
