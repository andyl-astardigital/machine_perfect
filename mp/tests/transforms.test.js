/**
 * transforms.js — hand-computed tests.
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
// ║  htmlToScxml — <mp-transition> elements (the canonical form)            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('htmlToScxml — <mp-transition> with guard, action, emit');

// State machine transitions are defined by <mp-transition> structural elements.
// Bare mp-to on buttons is a UI trigger only — not transported to SCXML.
var nsHtml = '<div mp="test" mp-ctx=\'{"x":1}\'>' +
  '<div mp-state="a">' +
  '<mp-transition event="go" to="b">' +
  '<mp-guard>(> x 0)</mp-guard>' +
  '<mp-action>(inc! x)</mp-action>' +
  '<mp-emit>done</mp-emit>' +
  '</mp-transition>' +
  '</div>' +
  '<div mp-state="b"></div></div>';
var nsScxml = transforms.htmlToScxml(nsHtml);

assert(nsScxml.indexOf('target="b"') !== -1, 'SCXML has target="b"');
assert(nsScxml.indexOf('<mp-guard>') !== -1, 'SCXML has mp-guard child element');
assert(nsScxml.indexOf('<mp-action>') !== -1, 'SCXML has mp-action child element');
assert(nsScxml.indexOf('mp-ctx=') !== -1, 'SCXML has mp-ctx attribute');
assert(nsScxml.indexOf('xmlns:') === -1, 'no xmlns namespace declaration');
assert(nsScxml.indexOf('mp:') === -1, 'no mp: prefix anywhere in output');


describe('htmlToScxml — bare mp-to on button is a UI trigger, not a SCXML transition');

// Bare mp-to fires an event in the browser. It is not a state machine transition
// definition and is not extracted into SCXML.
var nsHtmlBare = '<div mp="t3" mp-ctx=\'{}\'><div mp-state="a"><button mp-to="b">Go</button></div><div mp-state="b"></div></div>';
var nsScxmlBare = transforms.htmlToScxml(nsHtmlBare);
assert(nsScxmlBare.indexOf('target="b"') === -1, 'bare mp-to on button does not create SCXML transition');
eq((nsScxmlBare.match(/<transition/g) || []).length, 0, 'exactly 0 transitions (use <mp-transition> to define state machine transitions)');


describe('htmlToScxml — <mp-init> and <mp-exit> child elements transport lifecycle hooks');

// Browser HTML uses <mp-init> and <mp-exit> child elements inside the state div.
// htmlToScxml extracts them and outputs mp-init/mp-exit attributes in SCXML.
var nsHtml2 = '<div mp="t2" mp-ctx=\'{}\'>' +
  '<div mp-state="a">' +
  '<mp-init>(log \'enter\')</mp-init>' +
  '<mp-exit>(log \'exit\')</mp-exit>' +
  '</div></div>';
var nsScxml2 = transforms.htmlToScxml(nsHtml2);

assert(nsScxml2.indexOf('mp-init=') !== -1, 'SCXML has mp-init attribute');
assert(nsScxml2.indexOf('mp-exit=') !== -1, 'SCXML has mp-exit attribute');


describe('scxmlToHtml — SCXML transitions become <mp-transition> elements');

// SCXML <transition> elements with child guards/actions become structural
// <mp-transition> elements in the HTML output. CDATA is unwrapped.
// State mp-init/mp-exit attributes become <mp-init>/<mp-exit> child elements.
var nsScxmlInput = '<?xml version="1.0"?><scxml xmlns="http://www.w3.org/2005/07/scxml" id="rt" initial="a" mp-ctx=\'{"v":42}\'>' +
  '<state id="a" mp-init="(log \'hi\')" mp-exit="(log \'bye\')">' +
  '<transition event="go" target="b"><mp-guard><![CDATA[(> v 0)]]></mp-guard><mp-action><![CDATA[(inc! v)]]></mp-action><mp-emit>moved</mp-emit></transition>' +
  '</state>' +
  '<state id="b"/>' +
  '</scxml>';
var nsHtmlOut = transforms.scxmlToHtml(nsScxmlInput);

assert(nsHtmlOut.indexOf('<mp-transition') !== -1, 'HTML has mp-transition element');
assert(nsHtmlOut.indexOf('<mp-guard>') !== -1, 'HTML has mp-guard child element');
assert(nsHtmlOut.indexOf('<mp-action>') !== -1, 'HTML has mp-action child element');
assert(nsHtmlOut.indexOf('<mp-init>') !== -1, 'HTML has mp-init child element');
assert(nsHtmlOut.indexOf('<mp-exit>') !== -1, 'HTML has mp-exit child element');
assert(nsHtmlOut.indexOf('mp-ctx') !== -1, 'HTML has mp-ctx');
assert(nsHtmlOut.indexOf('mp:') === -1, 'HTML has no mp: prefix');


describe('scxmlToHtml — bare target becomes mp-transition in HTML');

var nsScxmlBare2 = '<?xml version="1.0"?><scxml id="t" initial="a"><state id="a"><transition event="go" target="b"/></state><state id="b"/></scxml>';
var nsHtmlBare2 = transforms.scxmlToHtml(nsScxmlBare2);
assert(nsHtmlBare2.indexOf('<mp-transition') !== -1, 'bare target becomes mp-transition element');
assert(nsHtmlBare2.indexOf('to="b"') !== -1, 'target attribute maps to to= in mp-transition');


describe('updateScxmlState — updates initial and mp-ctx');

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

// Both the live state div and the template sibling contain the same
// <mp-transition> definition. Deduplication by event+target ensures
// each transition appears exactly once in SCXML.
var tmplHtml = '<div mp="transport-test" mp-current-state="draft" mp-ctx=\'{"x":1}\'>' +
  '<div mp-state="draft">' +
  '<mp-transition event="submit" to="submitted"><mp-guard>(> x 0)</mp-guard></mp-transition>' +
  '</div>' +
  '<template mp-state-template="draft">' +
  '<mp-transition event="submit" to="submitted"><mp-guard>(> x 0)</mp-guard></mp-transition>' +
  '</template>' +
  '<div mp-state="submitted" hidden></div>' +
  '<template mp-state-template="submitted">' +
  '<mp-transition event="approve" to="approved"></mp-transition>' +
  '<mp-transition event="reject" to="rejected"></mp-transition>' +
  '</template>' +
  '<div mp-state="approved" hidden></div>' +
  '<template mp-state-template="approved">' +
  '<mp-transition event="fulfil" to="fulfilled"><mp-action>(invoke! :type \'fulfil\')</mp-action></mp-transition>' +
  '</template>' +
  '<div mp-state="fulfilled" mp-final hidden></div>' +
  '<div mp-state="rejected" mp-final hidden></div>' +
  '</div>';

var tmplScxml = transforms.htmlToScxml(tmplHtml);

eq((tmplScxml.match(/id="draft"/g) || []).length, 1, 'draft state appears once');
eq((tmplScxml.match(/<transition[^>]*submitted/g) || []).length, 1, 'draft has exactly 1 transition to submitted (no duplicates)');

assert(tmplScxml.indexOf('target="approved"') !== -1, 'submitted state has approve transition from template');
assert(tmplScxml.indexOf('target="rejected"') !== -1, 'submitted state has reject transition from template');
eq((tmplScxml.match(/target="approved"/g) || []).length, 1, 'submitted has exactly 1 approve transition');

assert(tmplScxml.indexOf('target="fulfilled"') !== -1, 'approved state has fulfil transition from template');
eq((tmplScxml.match(/<final id="fulfilled"/g) || []).length, 1, 'fulfilled is a final state');
eq((tmplScxml.match(/<final id="rejected"/g) || []).length, 1, 'rejected is a final state');


describe('htmlToScxml — <mp-transition> elements only: UI button mp-to excluded');

// Real browser outerHTML of a purchase order form:
// UI-action buttons (emit, push!, set!) carry bare mp-to event names.
// State machine transitions are defined by <mp-transition> structural elements.
// Only <mp-transition> elements appear in SCXML; mp-to buttons are silent.
var uiHtml = '<div mp="po-real" mp-current-state="draft" mp-ctx=\'{"title":"Test","amount":500,"items":[{"name":"Widget","qty":1}],"newItem":"","submitted_at":null}\'>' +
  '<div mp-state="draft">' +
  '<button mp-to="navigate-orders">Cancel</button>' +
  '<button mp-to="add-item">Add</button>' +
  '<button mp-to="remove-item">Remove</button>' +
  '<mp-transition event="submit" to="submitted">' +
  '<mp-guard>(and (> (count items) 0) (> amount 0))</mp-guard>' +
  '<mp-action>(set! submitted_at (now))</mp-action>' +
  '</mp-transition>' +
  '</div>' +
  '<template mp-state-template="draft">' +
  '<button mp-to="navigate-orders">Cancel</button>' +
  '<button mp-to="add-item">Add</button>' +
  '<button mp-to="remove-item">Remove</button>' +
  '<mp-transition event="submit" to="submitted">' +
  '<mp-guard>(and (> (count items) 0) (> amount 0))</mp-guard>' +
  '<mp-action>(set! submitted_at (now))</mp-action>' +
  '</mp-transition>' +
  '</template>' +
  '<div mp-state="submitted" hidden></div>' +
  '<template mp-state-template="submitted">' +
  '<mp-transition event="approve" to="approved">' +
  '<mp-guard>(some? title)</mp-guard>' +
  '<mp-action>(set! approved_at (now))</mp-action>' +
  '</mp-transition>' +
  '<mp-transition event="reject" to="rejected"></mp-transition>' +
  '</template>' +
  '<div mp-state="approved" hidden></div>' +
  '<template mp-state-template="approved">' +
  '<mp-transition event="fulfil" to="fulfilled">' +
  '<mp-action>(invoke! :type \'fulfil\')</mp-action>' +
  '</mp-transition>' +
  '</template>' +
  '<div mp-state="fulfilled" mp-final hidden></div>' +
  '<div mp-state="rejected" mp-final hidden></div>' +
  '</div>';

var uiScxml = transforms.htmlToScxml(uiHtml);

// Draft: only the submit <mp-transition> survives — bare mp-to buttons do not
eq((uiScxml.match(/<transition/g) || []).length, 4, 'exactly 4 transitions total (submit, approve, reject, fulfil)');
assert(uiScxml.indexOf('navigate-orders') === -1, 'navigate-orders button excluded from SCXML');
assert(uiScxml.indexOf('add-item') === -1, 'add-item button excluded from SCXML');
assert(uiScxml.indexOf('remove-item') === -1, 'remove-item button excluded from SCXML');
assert(uiScxml.indexOf('target="submitted"') !== -1, 'submit transition preserved');
assert(uiScxml.indexOf('target="approved"') !== -1, 'approve transition preserved');
assert(uiScxml.indexOf('target="rejected"') !== -1, 'reject transition preserved');
assert(uiScxml.indexOf('target="fulfilled"') !== -1, 'fulfil transition preserved');


describe('htmlToScxml — no templates: server-built HTML with <mp-transition> elements');

// Server-built HTML uses <mp-transition> structural elements.
// No templates — transitions are in the state divs directly.
var noTmplHtml = '<div mp="classic" mp-ctx=\'{}\'>' +
  '<div mp-state="a"><mp-transition event="go" to="b"></mp-transition></div>' +
  '<div mp-state="b"><mp-transition event="back" to="a"></mp-transition></div>' +
  '</div>';
var noTmplScxml = transforms.htmlToScxml(noTmplHtml);

assert(noTmplScxml.indexOf('target="b"') !== -1, 'a→b transition present');
assert(noTmplScxml.indexOf('target="a"') !== -1, 'b→a transition present');
eq((noTmplScxml.match(/<transition/g) || []).length, 2, 'exactly 2 transitions total');


describe('htmlToScxml — HTML comments containing mp-to text do not crash');

// Comments may contain mp-to text for documentation. They must not be
// parsed as transition definitions.
var commentHtml = '<div mp="comment-test" mp-ctx=\'{}\'>' +
  '<!-- mp-to fires events in the browser -->' +
  '<div mp-state="a"><mp-transition event="go" to="b"></mp-transition></div>' +
  '<div mp-state="b"></div></div>';
var commentScxml = transforms.htmlToScxml(commentHtml);
eq((commentScxml.match(/target="b"/g) || []).length, 1, 'transition target="b" present exactly once');
eq((commentScxml.match(/<transition/g) || []).length, 1, 'exactly 1 transition (comment not parsed as definition)');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  htmlToScxml — structural <mp-transition> elements                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('htmlToScxml — <mp-transition> with <mp-guard> and <mp-action>');

var structHtml = '<div mp="struct-test" mp-ctx=\'{"x":1}\'>' +
  '<div mp-state="a">' +
  '<mp-transition event="go" to="b"><mp-guard>(> x 0)</mp-guard><mp-action>(set! x 0)</mp-action></mp-transition>' +
  '</div>' +
  '<div mp-state="b" mp-final></div></div>';
var structScxml = transforms.htmlToScxml(structHtml);

assert(structScxml.indexOf('<transition') !== -1, 'SCXML has transition element');
assert(structScxml.indexOf('event="go"') !== -1, 'transition has event="go"');
assert(structScxml.indexOf('target="b"') !== -1, 'transition has target="b"');
assert(structScxml.indexOf('(> x 0)') !== -1, 'guard expression preserved');
assert(structScxml.indexOf('(set! x 0)') !== -1, 'action expression preserved');
eq((structScxml.match(/<transition/g) || []).length, 1, 'exactly 1 transition');


describe('htmlToScxml — <mp-transition> without guard (unconditional)');

var noGuardHtml = '<div mp="ng-test" mp-ctx=\'{}\'>' +
  '<div mp-state="a"><mp-transition event="go" to="b"></mp-transition></div>' +
  '<div mp-state="b" mp-final></div></div>';
var noGuardScxml = transforms.htmlToScxml(noGuardHtml);
assert(noGuardScxml.indexOf('event="go"') !== -1, 'event preserved');
assert(noGuardScxml.indexOf('target="b"') !== -1, 'target preserved');


describe('htmlToScxml — only <mp-transition> elements create SCXML transitions');

// Bare mp-to on a button fires a browser event but does NOT define a state
// machine transition. Only <mp-transition> elements produce SCXML <transition>.
var onlyMpTransHtml = '<div mp="mix-test" mp-ctx=\'{}\'>' +
  '<div mp-state="a">' +
  '<mp-transition event="guarded" to="b"><mp-guard>(> x 0)</mp-guard></mp-transition>' +
  '<button mp-to="c">Direct</button>' +
  '</div>' +
  '<div mp-state="b" mp-final></div>' +
  '<div mp-state="c" mp-final></div></div>';
var onlyMpTransScxml = transforms.htmlToScxml(onlyMpTransHtml);
eq((onlyMpTransScxml.match(/<transition/g) || []).length, 1, '1 transition from <mp-transition> element; mp-to button excluded');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Bug fixes                                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('Bug 10 — eventless <mp-transition> event field is null, not the target name');

var eventlessHtml = '<div mp="evl" mp-ctx=\'{}\'>' +
  '<div mp-state="a"><mp-transition to="b"></mp-transition></div>' +
  '<div mp-state="b" mp-final></div></div>';
var eventlessScxml = transforms.htmlToScxml(eventlessHtml);
// Eventless transition: no event attr in SCXML (must NOT produce event="b")
assert(eventlessScxml.indexOf('event="b"') === -1, 'eventless transition has no event attribute in SCXML');
assert(eventlessScxml.indexOf('target="b"') !== -1, 'eventless transition still has target="b"');


describe('Bug 11 — updateScxmlState inserts mp-ctx when not present');

var noCtxScxml = '<scxml id="m" initial="a"/>';
var updated = transforms.updateScxmlState(noCtxScxml, 'b', { x: 1 });
assert(updated.indexOf('initial="b"') !== -1, 'state updated to b');
assert(updated.indexOf("mp-ctx='") !== -1, 'mp-ctx inserted when absent');
assert(updated.indexOf('"x":1') !== -1, 'context data in mp-ctx');


describe('Bug 12 — <mp-where> survives HTML→SCXML→HTML round-trip');

var whereHtml = '<div mp="where-rt" mp-ctx=\'{}\'>' +
  '<div mp-state="orders"><mp-where>(requires \'ui-render\')</mp-where>' +
  '<mp-transition event="create" to="form"></mp-transition></div>' +
  '<div mp-state="form" mp-final></div></div>';

// HTML → SCXML: mp-where must appear in SCXML state
var whereScxml = transforms.htmlToScxml(whereHtml);
assert(whereScxml.indexOf('<mp-where>') !== -1, 'mp-where element in SCXML output');
assert(whereScxml.indexOf("(requires 'ui-render')") !== -1, 'mp-where content preserved in SCXML');

// SCXML → HTML: mp-where must survive back to HTML
var whereHtmlBack = transforms.scxmlToHtml(whereScxml);
assert(whereHtmlBack.indexOf('<mp-where>') !== -1, 'mp-where element in round-tripped HTML');
assert(whereHtmlBack.indexOf("(requires 'ui-render')") !== -1, 'mp-where content preserved in round-trip');


describe('Bug 13 — where: null dead field removed from transition objects; no mp-where attr in SCXML');

// No mp-where attribute should appear on SCXML <transition> elements
var cleanHtml = '<div mp="clean" mp-ctx=\'{}\'>' +
  '<div mp-state="a"><mp-transition event="go" to="b"></mp-transition></div>' +
  '<div mp-state="b" mp-final></div></div>';
var cleanScxml = transforms.htmlToScxml(cleanHtml);
assert(cleanScxml.indexOf('mp-where=') === -1, 'no mp-where attribute on SCXML transitions (dead field removed)');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Quality check — new bugs                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('C1 — updateScxmlState: $-patterns in context do not corrupt output');
var dollarCtx = transforms.updateScxmlState('<scxml id="m" initial="a"/>', 'b', { tag: '$& price', ref: '$1' });
assert(dollarCtx.indexOf('$& price') !== -1, 'literal $& in context preserved');
assert(dollarCtx.indexOf('$1') !== -1, 'literal $1 in context preserved');
assert(dollarCtx.indexOf('mp-ctx=') !== -1, 'mp-ctx attribute present');

describe('C3 — extractStructuralTransitions: self-closing <mp-transition/> supported');
var selfClosingHtml = '<div mp-state="a"><mp-transition event="go" to="b"/></div>';
var selfClosingTransitions = transforms.extractStructuralTransitions(selfClosingHtml);
eq(selfClosingTransitions.length, 1, 'self-closing mp-transition extracted');
eq(selfClosingTransitions[0].event, 'go', 'event attribute read');
eq(selfClosingTransitions[0].target, 'b', 'target attribute read');

describe('H1 — stateRegex handles > inside attribute values');
var gtInAttr = '<?xml version="1.0"?><scxml id="m" initial="checking"><state id="checking" mp-init="(> x 0)"><transition event="go" target="done"/></state><final id="done"/></scxml>';
var gtHtml = transforms.scxmlToHtml(gtInAttr);
assert(gtHtml.indexOf('mp-state="checking"') !== -1, 'state with > in attr parsed correctly');
assert(gtHtml.indexOf('mp-init') !== -1, 'mp-init content preserved');

describe('H2 — scxmlToHtml converts cond= attribute to <mp-guard>');
var condScxml = '<?xml version="1.0"?><scxml id="m" initial="a"><state id="a"><transition cond="(&lt;= amount 100000)" event="approve" target="done"/></state><final id="done"/></scxml>';
var condHtml = transforms.scxmlToHtml(condScxml);
assert(condHtml.indexOf('<mp-guard>') !== -1, 'cond= converted to <mp-guard> element');

describe('H5 — scxmlToHtml id/initial read from <scxml> tag only, not first occurrence');
var multiIdScxml = '<?xml version="1.0"?><scxml id="machine" initial="first"><state id="first"><transition event="go" target="second"/></state><final id="second"/></scxml>';
var multiIdHtml = transforms.scxmlToHtml(multiIdScxml);
assert(multiIdHtml.indexOf('mp="machine"') !== -1, 'machine id from <scxml>, not first <state>');
assert(multiIdHtml.indexOf('mp-current-state="first"') !== -1, 'initial from <scxml> initial attr');

describe('M5 — scxmlToHtml escapes < in guard/action content');
var ltScxml = '<?xml version="1.0"?><scxml id="m" initial="a"><state id="a"><transition event="go" target="b"><mp-guard><![CDATA[(< x 10)]]></mp-guard></transition></state><final id="b"/></scxml>';
var ltHtml = transforms.scxmlToHtml(ltScxml);
assert(ltHtml.indexOf('<mp-guard>(&lt; x 10)</mp-guard>') !== -1, 'raw < in guard is HTML-escaped to &lt; in scxmlToHtml output');

describe('M6 — transition deduplication uses event+target+guard key');
var multiGuardHtml = '<div mp="m" mp-ctx=\'{}\'>' +
  '<div mp-state="a">' +
  '<mp-transition event="go" to="b"><mp-guard>(= role \'admin\')</mp-guard></mp-transition>' +
  '<mp-transition event="go" to="c"><mp-guard>(= role \'user\')</mp-guard></mp-transition>' +
  '</div>' +
  '<div mp-state="b" mp-final></div>' +
  '<div mp-state="c" mp-final></div>' +
  '</div>';
var multiGuardScxml = transforms.htmlToScxml(multiGuardHtml);
var adminCount = (multiGuardScxml.match(/admin/g) || []).length;
var userCount = (multiGuardScxml.match(/user/g) || []).length;
eq(adminCount, 1, 'admin guard transition preserved (exactly 1 occurrence)');
eq(userCount, 1, 'user guard transition preserved (exactly 1 occurrence)');

describe('M7 — scxmlToHtml finalRegex matches <final id="x"></final> (full form)');
var fullFinalScxml = '<?xml version="1.0"?><scxml id="m" initial="a"><state id="a"><transition event="go" target="done"/></state><final id="done"></final></scxml>';
var fullFinalHtml = transforms.scxmlToHtml(fullFinalScxml);
assert(fullFinalHtml.indexOf('mp-final') !== -1, '<final></final> full form generates mp-final state');

describe('L5 — extractAttr handles single-quoted attributes');
var singleQuotedAttrs = "event='go' to='b'";
eq(transforms.extractAttr(singleQuotedAttrs, 'event'), 'go', 'single-quoted event= read');
eq(transforms.extractAttr(singleQuotedAttrs, 'to'), 'b', 'single-quoted to= read');

describe('L6 — mp-url survives SCXML→HTML→SCXML round-trip');
var mpUrlHtml = '<div mp="m" mp-ctx=\'{}\'>' +
  '<div mp-state="orders"><mp-url>/orders</mp-url><mp-transition event="view" to="done"></mp-transition></div>' +
  '<div mp-state="done" mp-final></div></div>';
var mpUrlScxml = transforms.htmlToScxml(mpUrlHtml);
assert(mpUrlScxml.indexOf('mp-url="/orders"') !== -1, 'mp-url preserved in SCXML');
var mpUrlBack = transforms.scxmlToHtml(mpUrlScxml);
assert(mpUrlBack.indexOf('<mp-url>/orders</mp-url>') !== -1, 'mp-url survives SCXML→HTML round-trip');
var mpUrlRoundTrip = transforms.htmlToScxml(mpUrlBack);
assert(mpUrlRoundTrip.indexOf('mp-url="/orders"') !== -1, 'mp-url survives full HTML→SCXML→HTML→SCXML round-trip');


describe('Targetless HTML transition — event with action but no target survives htmlToScxml');

var targetlessHtml = [
  '<div mp="tgt">',
  '  <div mp-state="active">',
  '    <mp-transition event="ping">',
  '      <mp-action>(set! count (+ count 1))</mp-action>',
  '    </mp-transition>',
  '    <mp-transition event="go" to="done"></mp-transition>',
  '  </div>',
  '  <div mp-state="done" mp-final></div>',
  '</div>'
].join('\n');
var targetlessScxml = transforms.htmlToScxml(targetlessHtml);
assert(targetlessScxml.indexOf('event="ping"') !== -1, 'targetless transition with action survives htmlToScxml');
assert(targetlessScxml.indexOf('set! count') !== -1, 'action content preserved in targetless transition');


describe('H3 — mp-temporal survives HTML→SCXML→HTML round-trip');

var temporalHtml = [
  '<div mp="timer">',
  '  <div mp-state="waiting">',
  '    <mp-temporal>(after 5000 (to done))</mp-temporal>',
  '    <mp-transition event="skip" to="done"></mp-transition>',
  '  </div>',
  '  <div mp-state="done" mp-final></div>',
  '</div>'
].join('\n');

var temporalScxml = transforms.htmlToScxml(temporalHtml);
assert(temporalScxml.indexOf('<mp-temporal>') !== -1, 'htmlToScxml: mp-temporal element present in SCXML output');
assert(temporalScxml.indexOf('(after 5000 (to done))') !== -1, 'htmlToScxml: mp-temporal expression preserved in SCXML');
assert(temporalScxml.indexOf('mp-temporal=') === -1, 'htmlToScxml: mp-temporal is element not attribute in SCXML');

var temporalHtmlBack = transforms.scxmlToHtml(temporalScxml);
assert(temporalHtmlBack.indexOf('<mp-temporal>') !== -1, 'scxmlToHtml: mp-temporal element present in round-tripped HTML');
assert(temporalHtmlBack.indexOf('(after 5000 (to done))') !== -1, 'scxmlToHtml: mp-temporal expression preserved in round-trip');

// Double round-trip: HTML→SCXML→HTML→SCXML — expression must survive two passes
var temporalScxml2 = transforms.htmlToScxml(temporalHtmlBack);
assert(temporalScxml2.indexOf('<mp-temporal>') !== -1, 'full double round-trip: mp-temporal element survives HTML→SCXML→HTML→SCXML');


describe('mp-ctx with single quotes survives scxmlToHtml');
var sqScxml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" id="sq" initial="a" mp-ctx=\'{"title":"it&apos;s here"}\'><state id="a"/></scxml>';
var sqHtml = transforms.scxmlToHtml(sqScxml);
var sqCtx = transforms.extractContext(sqHtml);
eq(sqCtx.title, "it's here", 'context with apostrophe round-trips through scxmlToHtml');


describe('mp-init with < in expression survives HTML→SCXML round-trip');
var ltHtmlInit = '<div mp="lt" mp-current-state="a"><div mp-state="a"><mp-init>(&lt; x 10)</mp-init></div></div>';
var ltScxmlInit = transforms.htmlToScxml(ltHtmlInit);
assert(ltScxmlInit.indexOf('mp-init="(&lt; x 10)"') !== -1, 'mp-init with < correctly entity-encoded in SCXML');
var ltHtmlBack = transforms.scxmlToHtml(ltScxmlInit);
assert(ltHtmlBack.indexOf('<mp-init>(< x 10)</mp-init>') !== -1 || ltHtmlBack.indexOf('<mp-init>(&lt; x 10)</mp-init>') !== -1, 'mp-init round-trips back to HTML');
var ltScxml2 = transforms.htmlToScxml(ltHtmlBack);
assert(ltScxml2.indexOf('mp-init="(&lt; x 10)"') !== -1, 'mp-init survives double round-trip without corruption');
assert(ltScxml2.indexOf('&amp;lt;') === -1, 'no double-escaping in mp-init');


describe('scxmlToHtml — compound/nested states preserved');
var compoundScxml = '<scxml id="reactor" initial="running">' +
  '<state id="running" initial="filling">' +
  '<state id="filling"><transition event="full" target="heating"/></state>' +
  '<state id="heating"><transition event="hot" target="holding"/></state>' +
  '<state id="holding"><transition event="done" target="complete"/></state>' +
  '<state id="complete"/>' +
  '</state>' +
  '<final id="stopped"/>' +
  '</scxml>';
var compoundHtml = transforms.scxmlToHtml(compoundScxml);
assert(compoundHtml.indexOf('mp-state="running"') !== -1, 'compound: parent state running in HTML');
assert(compoundHtml.indexOf('mp-state="filling"') !== -1, 'compound: child state filling in HTML');
assert(compoundHtml.indexOf('mp-state="heating"') !== -1, 'compound: child state heating in HTML');
assert(compoundHtml.indexOf('mp-state="holding"') !== -1, 'compound: child state holding in HTML');
assert(compoundHtml.indexOf('mp-state="complete"') !== -1, 'compound: child state complete in HTML');
assert(compoundHtml.indexOf('mp-state="stopped"') !== -1, 'compound: final state stopped in HTML');
assert(compoundHtml.indexOf('mp-final') !== -1, 'compound: final marker present');
// Verify nesting: filling should be INSIDE running's div
var runningIdx = compoundHtml.indexOf('mp-state="running"');
var fillingIdx = compoundHtml.indexOf('mp-state="filling"');
assert(fillingIdx > runningIdx, 'compound: filling is nested inside running');


describe('scxmlToHtml — final state with extra attributes preserved');
var finalAttrScxml = '<scxml id="f" initial="a"><state id="a"><transition event="go" target="done"/></state><final id="done" mp-exit="(log bye)"/></scxml>';
var finalAttrHtml = transforms.scxmlToHtml(finalAttrScxml);
assert(finalAttrHtml.indexOf('mp-state="done"') !== -1, 'final with extra attrs: state present');
assert(finalAttrHtml.indexOf('mp-final') !== -1, 'final with extra attrs: mp-final marker');


// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
process.exit(failed > 0 ? 1 : 0);
