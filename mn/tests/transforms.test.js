/**
 * transforms.js — hand-computed tests.
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
// ║  extractContext — reads context from machine HTML                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('extractContext — single-quoted mn-ctx');

var html1 = '<div mn="order" mn-ctx=\'{"title":"Laptop","amount":750,"items":[{"name":"Stand","qty":2}]}\'><div mn-state="draft"></div></div>';
var ctx1 = transforms.extractContext(html1);
eq(ctx1.title, 'Laptop', 'title');
eq(ctx1.amount, 750, 'amount');
eq(ctx1.items.length, 1, 'items count');
eq(ctx1.items[0].name, 'Stand', 'item name');
eq(ctx1.items[0].qty, 2, 'item qty');


describe('extractContext — double-quoted mn-ctx with &quot; entities (browser outerHTML)');

var html2 = '<div mn="order" mn-ctx="{&quot;title&quot;:&quot;Browser Test&quot;,&quot;amount&quot;:500,&quot;items&quot;:[]}"><div mn-state="draft"></div></div>';
var ctx2 = transforms.extractContext(html2);
eq(ctx2.title, 'Browser Test', 'title from double-quoted');
eq(ctx2.amount, 500, 'amount from double-quoted');
deepEq(ctx2.items, [], 'empty items from double-quoted');


describe('extractContext — with &#39; entities in single-quoted');

var html3 = "<div mn=\"order\" mn-ctx='{\"title\":\"It&#39;s a test\",\"amount\":100}'><div mn-state=\"draft\"></div></div>";
var ctx3 = transforms.extractContext(html3);
eq(ctx3.title, "It's a test", 'title with apostrophe entity');
eq(ctx3.amount, 100, 'amount');


describe('extractContext — nested objects and arrays');

var html4 = '<div mn="po" mn-ctx=\'{"title":"Big Order","amount":999,"items":[{"name":"A","qty":1},{"name":"B","qty":3}],"notes":"urgent","urgent":true}\'></div>';
var ctx4 = transforms.extractContext(html4);
eq(ctx4.title, 'Big Order', 'title');
eq(ctx4.items.length, 2, '2 items');
eq(ctx4.items[1].name, 'B', 'second item name');
eq(ctx4.items[1].qty, 3, 'second item qty');
eq(ctx4.notes, 'urgent', 'notes');
eq(ctx4.urgent, true, 'boolean true');


describe('extractContext — no mn-ctx returns empty object');

var html5 = '<div mn="simple"><div mn-state="a"></div></div>';
var ctx5 = transforms.extractContext(html5);
deepEq(ctx5, {}, 'empty object when no mn-ctx');


describe('extractContext — malformed JSON returns empty object');

var html6 = '<div mn="bad" mn-ctx=\'not json\'></div>';
var ctx6 = transforms.extractContext(html6);
deepEq(ctx6, {}, 'empty object on bad JSON');


describe('extractContext — also extracts machine name and current state');

var html7 = '<div mn="purchase-order" mn-current-state="submitted" mn-ctx=\'{"title":"Test","amount":50}\'><div mn-state="draft"></div></div>';
var result7 = transforms.extractMachine(html7);
eq(result7.name, 'purchase-order', 'machine name');
eq(result7.state, 'submitted', 'current state');
eq(result7.context.title, 'Test', 'context title');
eq(result7.context.amount, 50, 'context amount');


describe('extractMachine — no current state defaults to null');

var html8 = '<div mn="app" mn-ctx=\'{"x":1}\'><div mn-state="idle"></div></div>';
var result8 = transforms.extractMachine(html8);
eq(result8.name, 'app', 'name');
eq(result8.state, null, 'state is null when not set');
eq(result8.context.x, 1, 'context value');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  htmlToScxml — <mn-transition> elements (the canonical form)            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('htmlToScxml — <mn-transition> with guard, action, emit');

// State machine transitions are defined by <mn-transition> structural elements.
// Bare mn-to on buttons is a UI trigger only — not transported to SCXML.
var nsHtml = '<div mn="test" mn-ctx=\'{"x":1}\'>' +
  '<div mn-state="a">' +
  '<mn-transition event="go" to="b">' +
  '<mn-guard>(> x 0)</mn-guard>' +
  '<mn-action>(inc! x)</mn-action>' +
  '<mn-emit>done</mn-emit>' +
  '</mn-transition>' +
  '</div>' +
  '<div mn-state="b"></div></div>';
var nsScxml = transforms.htmlToScxml(nsHtml);

assert(nsScxml.indexOf('target="b"') !== -1, 'SCXML has target="b"');
assert(nsScxml.indexOf('<mn-guard>') !== -1, 'SCXML has mn-guard child element');
assert(nsScxml.indexOf('<mn-action>') !== -1, 'SCXML has mn-action child element');
assert(nsScxml.indexOf('mn-ctx=') !== -1, 'SCXML has mn-ctx attribute');
assert(nsScxml.indexOf('xmlns:') === -1, 'no xmlns namespace declaration');
assert(nsScxml.indexOf('mn:') === -1, 'no mn: prefix anywhere in output');


describe('htmlToScxml — bare mn-to on button is a UI trigger, not a SCXML transition');

// Bare mn-to fires an event in the browser. It is not a state machine transition
// definition and is not extracted into SCXML.
var nsHtmlBare = '<div mn="t3" mn-ctx=\'{}\'><div mn-state="a"><button mn-to="b">Go</button></div><div mn-state="b"></div></div>';
var nsScxmlBare = transforms.htmlToScxml(nsHtmlBare);
assert(nsScxmlBare.indexOf('target="b"') === -1, 'bare mn-to on button does not create SCXML transition');
eq((nsScxmlBare.match(/<transition/g) || []).length, 0, 'exactly 0 transitions (use <mn-transition> to define state machine transitions)');


describe('htmlToScxml — <mn-init> and <mn-exit> child elements transport lifecycle hooks');

// Browser HTML uses <mn-init> and <mn-exit> child elements inside the state div.
// htmlToScxml extracts them and outputs mn-init/mn-exit attributes in SCXML.
var nsHtml2 = '<div mn="t2" mn-ctx=\'{}\'>' +
  '<div mn-state="a">' +
  '<mn-init>(log \'enter\')</mn-init>' +
  '<mn-exit>(log \'exit\')</mn-exit>' +
  '</div></div>';
var nsScxml2 = transforms.htmlToScxml(nsHtml2);

assert(nsScxml2.indexOf('mn-init=') !== -1, 'SCXML has mn-init attribute');
assert(nsScxml2.indexOf('mn-exit=') !== -1, 'SCXML has mn-exit attribute');


describe('scxmlToHtml — SCXML transitions become <mn-transition> elements');

// SCXML <transition> elements with child guards/actions become structural
// <mn-transition> elements in the HTML output. CDATA is unwrapped.
// State mn-init/mn-exit attributes become <mn-init>/<mn-exit> child elements.
var nsScxmlInput = '<?xml version="1.0"?><scxml xmlns="http://www.w3.org/2005/07/scxml" id="rt" initial="a" mn-ctx=\'{"v":42}\'>' +
  '<state id="a" mn-init="(log \'hi\')" mn-exit="(log \'bye\')">' +
  '<transition event="go" target="b"><mn-guard><![CDATA[(> v 0)]]></mn-guard><mn-action><![CDATA[(inc! v)]]></mn-action><mn-emit>moved</mn-emit></transition>' +
  '</state>' +
  '<state id="b"/>' +
  '</scxml>';
var nsHtmlOut = transforms.scxmlToHtml(nsScxmlInput);

assert(nsHtmlOut.indexOf('<mn-transition') !== -1, 'HTML has mn-transition element');
assert(nsHtmlOut.indexOf('<mn-guard>') !== -1, 'HTML has mn-guard child element');
assert(nsHtmlOut.indexOf('<mn-action>') !== -1, 'HTML has mn-action child element');
assert(nsHtmlOut.indexOf('<mn-init>') !== -1, 'HTML has mn-init child element');
assert(nsHtmlOut.indexOf('<mn-exit>') !== -1, 'HTML has mn-exit child element');
assert(nsHtmlOut.indexOf('mn-ctx') !== -1, 'HTML has mn-ctx');
assert(nsHtmlOut.indexOf('mn:') === -1, 'HTML has no mn: prefix');


describe('scxmlToHtml — bare target becomes mn-transition in HTML');

var nsScxmlBare2 = '<?xml version="1.0"?><scxml id="t" initial="a"><state id="a"><transition event="go" target="b"/></state><state id="b"/></scxml>';
var nsHtmlBare2 = transforms.scxmlToHtml(nsScxmlBare2);
assert(nsHtmlBare2.indexOf('<mn-transition') !== -1, 'bare target becomes mn-transition element');
assert(nsHtmlBare2.indexOf('to="b"') !== -1, 'target attribute maps to to= in mn-transition');


describe('updateScxmlState — updates initial and mn-ctx');

var nsScxmlUpdate = '<?xml version="1.0"?><scxml id="u" initial="a" mn-ctx=\'{"n":0}\'><state id="a"><transition event="b" target="b"/></state><state id="b"/></scxml>';
var nsUpdated = transforms.updateScxmlState(nsScxmlUpdate, 'b', { n: 99 });

assert(nsUpdated.indexOf('initial="b"') !== -1, 'initial updated to b');
assert(nsUpdated.indexOf('mn-ctx=') !== -1, 'output has mn-ctx attribute');
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
// <mn-transition> definition. Deduplication by event+target ensures
// each transition appears exactly once in SCXML.
var tmplHtml = '<div mn="transport-test" mn-current-state="draft" mn-ctx=\'{"x":1}\'>' +
  '<div mn-state="draft">' +
  '<mn-transition event="submit" to="submitted"><mn-guard>(> x 0)</mn-guard></mn-transition>' +
  '</div>' +
  '<template mn-state-template="draft">' +
  '<mn-transition event="submit" to="submitted"><mn-guard>(> x 0)</mn-guard></mn-transition>' +
  '</template>' +
  '<div mn-state="submitted" hidden></div>' +
  '<template mn-state-template="submitted">' +
  '<mn-transition event="approve" to="approved"></mn-transition>' +
  '<mn-transition event="reject" to="rejected"></mn-transition>' +
  '</template>' +
  '<div mn-state="approved" hidden></div>' +
  '<template mn-state-template="approved">' +
  '<mn-transition event="fulfil" to="fulfilled"><mn-action>(invoke! :type \'fulfil\')</mn-action></mn-transition>' +
  '</template>' +
  '<div mn-state="fulfilled" mn-final hidden></div>' +
  '<div mn-state="rejected" mn-final hidden></div>' +
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


describe('htmlToScxml — <mn-transition> elements only: UI button mn-to excluded');

// Real browser outerHTML of a purchase order form:
// UI-action buttons (emit, push!, set!) carry bare mn-to event names.
// State machine transitions are defined by <mn-transition> structural elements.
// Only <mn-transition> elements appear in SCXML; mn-to buttons are silent.
var uiHtml = '<div mn="po-real" mn-current-state="draft" mn-ctx=\'{"title":"Test","amount":500,"items":[{"name":"Widget","qty":1}],"newItem":"","submitted_at":null}\'>' +
  '<div mn-state="draft">' +
  '<button mn-to="navigate-orders">Cancel</button>' +
  '<button mn-to="add-item">Add</button>' +
  '<button mn-to="remove-item">Remove</button>' +
  '<mn-transition event="submit" to="submitted">' +
  '<mn-guard>(and (> (count items) 0) (> amount 0))</mn-guard>' +
  '<mn-action>(set! submitted_at (now))</mn-action>' +
  '</mn-transition>' +
  '</div>' +
  '<template mn-state-template="draft">' +
  '<button mn-to="navigate-orders">Cancel</button>' +
  '<button mn-to="add-item">Add</button>' +
  '<button mn-to="remove-item">Remove</button>' +
  '<mn-transition event="submit" to="submitted">' +
  '<mn-guard>(and (> (count items) 0) (> amount 0))</mn-guard>' +
  '<mn-action>(set! submitted_at (now))</mn-action>' +
  '</mn-transition>' +
  '</template>' +
  '<div mn-state="submitted" hidden></div>' +
  '<template mn-state-template="submitted">' +
  '<mn-transition event="approve" to="approved">' +
  '<mn-guard>(some? title)</mn-guard>' +
  '<mn-action>(set! approved_at (now))</mn-action>' +
  '</mn-transition>' +
  '<mn-transition event="reject" to="rejected"></mn-transition>' +
  '</template>' +
  '<div mn-state="approved" hidden></div>' +
  '<template mn-state-template="approved">' +
  '<mn-transition event="fulfil" to="fulfilled">' +
  '<mn-action>(invoke! :type \'fulfil\')</mn-action>' +
  '</mn-transition>' +
  '</template>' +
  '<div mn-state="fulfilled" mn-final hidden></div>' +
  '<div mn-state="rejected" mn-final hidden></div>' +
  '</div>';

var uiScxml = transforms.htmlToScxml(uiHtml);

// Draft: only the submit <mn-transition> survives — bare mn-to buttons do not
eq((uiScxml.match(/<transition/g) || []).length, 4, 'exactly 4 transitions total (submit, approve, reject, fulfil)');
assert(uiScxml.indexOf('navigate-orders') === -1, 'navigate-orders button excluded from SCXML');
assert(uiScxml.indexOf('add-item') === -1, 'add-item button excluded from SCXML');
assert(uiScxml.indexOf('remove-item') === -1, 'remove-item button excluded from SCXML');
assert(uiScxml.indexOf('target="submitted"') !== -1, 'submit transition preserved');
assert(uiScxml.indexOf('target="approved"') !== -1, 'approve transition preserved');
assert(uiScxml.indexOf('target="rejected"') !== -1, 'reject transition preserved');
assert(uiScxml.indexOf('target="fulfilled"') !== -1, 'fulfil transition preserved');


describe('htmlToScxml — no templates: server-built HTML with <mn-transition> elements');

// Server-built HTML uses <mn-transition> structural elements.
// No templates — transitions are in the state divs directly.
var noTmplHtml = '<div mn="classic" mn-ctx=\'{}\'>' +
  '<div mn-state="a"><mn-transition event="go" to="b"></mn-transition></div>' +
  '<div mn-state="b"><mn-transition event="back" to="a"></mn-transition></div>' +
  '</div>';
var noTmplScxml = transforms.htmlToScxml(noTmplHtml);

assert(noTmplScxml.indexOf('target="b"') !== -1, 'a→b transition present');
assert(noTmplScxml.indexOf('target="a"') !== -1, 'b→a transition present');
eq((noTmplScxml.match(/<transition/g) || []).length, 2, 'exactly 2 transitions total');


describe('htmlToScxml — HTML comments containing mn-to text do not crash');

// Comments may contain mn-to text for documentation. They must not be
// parsed as transition definitions.
var commentHtml = '<div mn="comment-test" mn-ctx=\'{}\'>' +
  '<!-- mn-to fires events in the browser -->' +
  '<div mn-state="a"><mn-transition event="go" to="b"></mn-transition></div>' +
  '<div mn-state="b"></div></div>';
var commentScxml = transforms.htmlToScxml(commentHtml);
eq((commentScxml.match(/target="b"/g) || []).length, 1, 'transition target="b" present exactly once');
eq((commentScxml.match(/<transition/g) || []).length, 1, 'exactly 1 transition (comment not parsed as definition)');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  htmlToScxml — structural <mn-transition> elements                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('htmlToScxml — <mn-transition> with <mn-guard> and <mn-action>');

var structHtml = '<div mn="struct-test" mn-ctx=\'{"x":1}\'>' +
  '<div mn-state="a">' +
  '<mn-transition event="go" to="b"><mn-guard>(> x 0)</mn-guard><mn-action>(set! x 0)</mn-action></mn-transition>' +
  '</div>' +
  '<div mn-state="b" mn-final></div></div>';
var structScxml = transforms.htmlToScxml(structHtml);

assert(structScxml.indexOf('<transition') !== -1, 'SCXML has transition element');
assert(structScxml.indexOf('event="go"') !== -1, 'transition has event="go"');
assert(structScxml.indexOf('target="b"') !== -1, 'transition has target="b"');
assert(structScxml.indexOf('(> x 0)') !== -1, 'guard expression preserved');
assert(structScxml.indexOf('(set! x 0)') !== -1, 'action expression preserved');
eq((structScxml.match(/<transition/g) || []).length, 1, 'exactly 1 transition');


describe('htmlToScxml — <mn-transition> without guard (unconditional)');

var noGuardHtml = '<div mn="ng-test" mn-ctx=\'{}\'>' +
  '<div mn-state="a"><mn-transition event="go" to="b"></mn-transition></div>' +
  '<div mn-state="b" mn-final></div></div>';
var noGuardScxml = transforms.htmlToScxml(noGuardHtml);
assert(noGuardScxml.indexOf('event="go"') !== -1, 'event preserved');
assert(noGuardScxml.indexOf('target="b"') !== -1, 'target preserved');


describe('htmlToScxml — only <mn-transition> elements create SCXML transitions');

// Bare mn-to on a button fires a browser event but does NOT define a state
// machine transition. Only <mn-transition> elements produce SCXML <transition>.
var onlyMpTransHtml = '<div mn="mix-test" mn-ctx=\'{}\'>' +
  '<div mn-state="a">' +
  '<mn-transition event="guarded" to="b"><mn-guard>(> x 0)</mn-guard></mn-transition>' +
  '<button mn-to="c">Direct</button>' +
  '</div>' +
  '<div mn-state="b" mn-final></div>' +
  '<div mn-state="c" mn-final></div></div>';
var onlyMpTransScxml = transforms.htmlToScxml(onlyMpTransHtml);
eq((onlyMpTransScxml.match(/<transition/g) || []).length, 1, '1 transition from <mn-transition> element; mn-to button excluded');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Bug fixes                                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('Bug 10 — eventless <mn-transition> event field is null, not the target name');

var eventlessHtml = '<div mn="evl" mn-ctx=\'{}\'>' +
  '<div mn-state="a"><mn-transition to="b"></mn-transition></div>' +
  '<div mn-state="b" mn-final></div></div>';
var eventlessScxml = transforms.htmlToScxml(eventlessHtml);
// Eventless transition: no event attr in SCXML (must NOT produce event="b")
assert(eventlessScxml.indexOf('event="b"') === -1, 'eventless transition has no event attribute in SCXML');
assert(eventlessScxml.indexOf('target="b"') !== -1, 'eventless transition still has target="b"');


describe('Bug 11 — updateScxmlState inserts mn-ctx when not present');

var noCtxScxml = '<scxml id="m" initial="a"/>';
var updated = transforms.updateScxmlState(noCtxScxml, 'b', { x: 1 });
assert(updated.indexOf('initial="b"') !== -1, 'state updated to b');
assert(updated.indexOf("mn-ctx='") !== -1, 'mn-ctx inserted when absent');
assert(updated.indexOf('"x":1') !== -1, 'context data in mn-ctx');


describe('Bug 12 — <mn-where> survives HTML→SCXML→HTML round-trip');

var whereHtml = '<div mn="where-rt" mn-ctx=\'{}\'>' +
  '<div mn-state="orders"><mn-where>(requires \'ui-render\')</mn-where>' +
  '<mn-transition event="create" to="form"></mn-transition></div>' +
  '<div mn-state="form" mn-final></div></div>';

// HTML → SCXML: mn-where must appear in SCXML state
var whereScxml = transforms.htmlToScxml(whereHtml);
assert(whereScxml.indexOf('<mn-where>') !== -1, 'mn-where element in SCXML output');
assert(whereScxml.indexOf("(requires 'ui-render')") !== -1, 'mn-where content preserved in SCXML');

// SCXML → HTML: mn-where must survive back to HTML
var whereHtmlBack = transforms.scxmlToHtml(whereScxml);
assert(whereHtmlBack.indexOf('<mn-where>') !== -1, 'mn-where element in round-tripped HTML');
assert(whereHtmlBack.indexOf("(requires 'ui-render')") !== -1, 'mn-where content preserved in round-trip');


describe('Bug 13 — where: null dead field removed from transition objects; no mn-where attr in SCXML');

// No mn-where attribute should appear on SCXML <transition> elements
var cleanHtml = '<div mn="clean" mn-ctx=\'{}\'>' +
  '<div mn-state="a"><mn-transition event="go" to="b"></mn-transition></div>' +
  '<div mn-state="b" mn-final></div></div>';
var cleanScxml = transforms.htmlToScxml(cleanHtml);
assert(cleanScxml.indexOf('mn-where=') === -1, 'no mn-where attribute on SCXML transitions (dead field removed)');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Quality check — new bugs                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('C1 — updateScxmlState: $-patterns in context do not corrupt output');
var dollarCtx = transforms.updateScxmlState('<scxml id="m" initial="a"/>', 'b', { tag: '$& price', ref: '$1' });
assert(dollarCtx.indexOf('$& price') !== -1, 'literal $& in context preserved');
assert(dollarCtx.indexOf('$1') !== -1, 'literal $1 in context preserved');
assert(dollarCtx.indexOf('mn-ctx=') !== -1, 'mn-ctx attribute present');

describe('C3 — extractStructuralTransitions: self-closing <mn-transition/> supported');
var selfClosingHtml = '<div mn-state="a"><mn-transition event="go" to="b"/></div>';
var selfClosingTransitions = transforms.extractStructuralTransitions(selfClosingHtml);
eq(selfClosingTransitions.length, 1, 'self-closing mn-transition extracted');
eq(selfClosingTransitions[0].event, 'go', 'event attribute read');
eq(selfClosingTransitions[0].target, 'b', 'target attribute read');

describe('H1 — stateRegex handles > inside attribute values');
var gtInAttr = '<?xml version="1.0"?><scxml id="m" initial="checking"><state id="checking" mn-init="(> x 0)"><transition event="go" target="done"/></state><final id="done"/></scxml>';
var gtHtml = transforms.scxmlToHtml(gtInAttr);
assert(gtHtml.indexOf('mn-state="checking"') !== -1, 'state with > in attr parsed correctly');
assert(gtHtml.indexOf('mn-init') !== -1, 'mn-init content preserved');

describe('H2 — scxmlToHtml converts cond= attribute to <mn-guard>');
var condScxml = '<?xml version="1.0"?><scxml id="m" initial="a"><state id="a"><transition cond="(&lt;= amount 100000)" event="approve" target="done"/></state><final id="done"/></scxml>';
var condHtml = transforms.scxmlToHtml(condScxml);
assert(condHtml.indexOf('<mn-guard>') !== -1, 'cond= converted to <mn-guard> element');

describe('H5 — scxmlToHtml id/initial read from <scxml> tag only, not first occurrence');
var multiIdScxml = '<?xml version="1.0"?><scxml id="machine" initial="first"><state id="first"><transition event="go" target="second"/></state><final id="second"/></scxml>';
var multiIdHtml = transforms.scxmlToHtml(multiIdScxml);
assert(multiIdHtml.indexOf('mn="machine"') !== -1, 'machine id from <scxml>, not first <state>');
assert(multiIdHtml.indexOf('mn-current-state="first"') !== -1, 'initial from <scxml> initial attr');

describe('M5 — scxmlToHtml escapes < in guard/action content');
var ltScxml = '<?xml version="1.0"?><scxml id="m" initial="a"><state id="a"><transition event="go" target="b"><mn-guard><![CDATA[(< x 10)]]></mn-guard></transition></state><final id="b"/></scxml>';
var ltHtml = transforms.scxmlToHtml(ltScxml);
assert(ltHtml.indexOf('<mn-guard>(&lt; x 10)</mn-guard>') !== -1, 'raw < in guard is HTML-escaped to &lt; in scxmlToHtml output');

describe('M6 — transition deduplication uses event+target+guard key');
var multiGuardHtml = '<div mn="m" mn-ctx=\'{}\'>' +
  '<div mn-state="a">' +
  '<mn-transition event="go" to="b"><mn-guard>(= role \'admin\')</mn-guard></mn-transition>' +
  '<mn-transition event="go" to="c"><mn-guard>(= role \'user\')</mn-guard></mn-transition>' +
  '</div>' +
  '<div mn-state="b" mn-final></div>' +
  '<div mn-state="c" mn-final></div>' +
  '</div>';
var multiGuardScxml = transforms.htmlToScxml(multiGuardHtml);
var adminCount = (multiGuardScxml.match(/admin/g) || []).length;
var userCount = (multiGuardScxml.match(/user/g) || []).length;
eq(adminCount, 1, 'admin guard transition preserved (exactly 1 occurrence)');
eq(userCount, 1, 'user guard transition preserved (exactly 1 occurrence)');

describe('M7 — scxmlToHtml finalRegex matches <final id="x"></final> (full form)');
var fullFinalScxml = '<?xml version="1.0"?><scxml id="m" initial="a"><state id="a"><transition event="go" target="done"/></state><final id="done"></final></scxml>';
var fullFinalHtml = transforms.scxmlToHtml(fullFinalScxml);
assert(fullFinalHtml.indexOf('mn-final') !== -1, '<final></final> full form generates mn-final state');

describe('L5 — extractAttr handles single-quoted attributes');
var singleQuotedAttrs = "event='go' to='b'";
eq(transforms.extractAttr(singleQuotedAttrs, 'event'), 'go', 'single-quoted event= read');
eq(transforms.extractAttr(singleQuotedAttrs, 'to'), 'b', 'single-quoted to= read');

describe('L6 — mn-url survives SCXML→HTML→SCXML round-trip');
var mpUrlHtml = '<div mn="m" mn-ctx=\'{}\'>' +
  '<div mn-state="orders"><mn-url>/orders</mn-url><mn-transition event="view" to="done"></mn-transition></div>' +
  '<div mn-state="done" mn-final></div></div>';
var mpUrlScxml = transforms.htmlToScxml(mpUrlHtml);
assert(mpUrlScxml.indexOf('mn-url="/orders"') !== -1, 'mn-url preserved in SCXML');
var mpUrlBack = transforms.scxmlToHtml(mpUrlScxml);
assert(mpUrlBack.indexOf('<mn-url>/orders</mn-url>') !== -1, 'mn-url survives SCXML→HTML round-trip');
var mpUrlRoundTrip = transforms.htmlToScxml(mpUrlBack);
assert(mpUrlRoundTrip.indexOf('mn-url="/orders"') !== -1, 'mn-url survives full HTML→SCXML→HTML→SCXML round-trip');


describe('Targetless HTML transition — event with action but no target survives htmlToScxml');

var targetlessHtml = [
  '<div mn="tgt">',
  '  <div mn-state="active">',
  '    <mn-transition event="ping">',
  '      <mn-action>(set! count (+ count 1))</mn-action>',
  '    </mn-transition>',
  '    <mn-transition event="go" to="done"></mn-transition>',
  '  </div>',
  '  <div mn-state="done" mn-final></div>',
  '</div>'
].join('\n');
var targetlessScxml = transforms.htmlToScxml(targetlessHtml);
assert(targetlessScxml.indexOf('event="ping"') !== -1, 'targetless transition with action survives htmlToScxml');
assert(targetlessScxml.indexOf('set! count') !== -1, 'action content preserved in targetless transition');


describe('H3 — mn-temporal survives HTML→SCXML→HTML round-trip');

var temporalHtml = [
  '<div mn="timer">',
  '  <div mn-state="waiting">',
  '    <mn-temporal>(after 5000 (to done))</mn-temporal>',
  '    <mn-transition event="skip" to="done"></mn-transition>',
  '  </div>',
  '  <div mn-state="done" mn-final></div>',
  '</div>'
].join('\n');

var temporalScxml = transforms.htmlToScxml(temporalHtml);
assert(temporalScxml.indexOf('<mn-temporal>') !== -1, 'htmlToScxml: mn-temporal element present in SCXML output');
assert(temporalScxml.indexOf('(after 5000 (to done))') !== -1, 'htmlToScxml: mn-temporal expression preserved in SCXML');
assert(temporalScxml.indexOf('mn-temporal=') === -1, 'htmlToScxml: mn-temporal is element not attribute in SCXML');

var temporalHtmlBack = transforms.scxmlToHtml(temporalScxml);
assert(temporalHtmlBack.indexOf('<mn-temporal>') !== -1, 'scxmlToHtml: mn-temporal element present in round-tripped HTML');
assert(temporalHtmlBack.indexOf('(after 5000 (to done))') !== -1, 'scxmlToHtml: mn-temporal expression preserved in round-trip');

// Double round-trip: HTML→SCXML→HTML→SCXML — expression must survive two passes
var temporalScxml2 = transforms.htmlToScxml(temporalHtmlBack);
assert(temporalScxml2.indexOf('<mn-temporal>') !== -1, 'full double round-trip: mn-temporal element survives HTML→SCXML→HTML→SCXML');


describe('mn-ctx with single quotes survives scxmlToHtml');
var sqScxml = '<scxml xmlns="http://www.w3.org/2005/07/scxml" id="sq" initial="a" mn-ctx=\'{"title":"it&apos;s here"}\'><state id="a"/></scxml>';
var sqHtml = transforms.scxmlToHtml(sqScxml);
var sqCtx = transforms.extractContext(sqHtml);
eq(sqCtx.title, "it's here", 'context with apostrophe round-trips through scxmlToHtml');


describe('mn-init with < in expression survives HTML→SCXML round-trip');
var ltHtmlInit = '<div mn="lt" mn-current-state="a"><div mn-state="a"><mn-init>(&lt; x 10)</mn-init></div></div>';
var ltScxmlInit = transforms.htmlToScxml(ltHtmlInit);
assert(ltScxmlInit.indexOf('mn-init="(&lt; x 10)"') !== -1, 'mn-init with < correctly entity-encoded in SCXML');
var ltHtmlBack = transforms.scxmlToHtml(ltScxmlInit);
assert(ltHtmlBack.indexOf('<mn-init>(< x 10)</mn-init>') !== -1 || ltHtmlBack.indexOf('<mn-init>(&lt; x 10)</mn-init>') !== -1, 'mn-init round-trips back to HTML');
var ltScxml2 = transforms.htmlToScxml(ltHtmlBack);
assert(ltScxml2.indexOf('mn-init="(&lt; x 10)"') !== -1, 'mn-init survives double round-trip without corruption');
assert(ltScxml2.indexOf('&amp;lt;') === -1, 'no double-escaping in mn-init');


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
assert(compoundHtml.indexOf('mn-state="running"') !== -1, 'compound: parent state running in HTML');
assert(compoundHtml.indexOf('mn-state="filling"') !== -1, 'compound: child state filling in HTML');
assert(compoundHtml.indexOf('mn-state="heating"') !== -1, 'compound: child state heating in HTML');
assert(compoundHtml.indexOf('mn-state="holding"') !== -1, 'compound: child state holding in HTML');
assert(compoundHtml.indexOf('mn-state="complete"') !== -1, 'compound: child state complete in HTML');
assert(compoundHtml.indexOf('mn-state="stopped"') !== -1, 'compound: final state stopped in HTML');
assert(compoundHtml.indexOf('mn-final') !== -1, 'compound: final marker present');
// Verify nesting: filling should be INSIDE running's div
var runningIdx = compoundHtml.indexOf('mn-state="running"');
var fillingIdx = compoundHtml.indexOf('mn-state="filling"');
assert(fillingIdx > runningIdx, 'compound: filling is nested inside running');


describe('scxmlToHtml — final state with extra attributes preserved');
var finalAttrScxml = '<scxml id="f" initial="a"><state id="a"><transition event="go" target="done"/></state><final id="done" mn-exit="(log bye)"/></scxml>';
var finalAttrHtml = transforms.scxmlToHtml(finalAttrScxml);
assert(finalAttrHtml.indexOf('mn-state="done"') !== -1, 'final with extra attrs: state present');
assert(finalAttrHtml.indexOf('mn-final') !== -1, 'final with extra attrs: mn-final marker');


// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
process.exit(failed > 0 ? 1 : 0);
