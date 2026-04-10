/**
 * adapters.js — interface validation tests.
 *
 * Run: node mp/tests/adapters.test.js
 */

var adapters = require('../adapters');
var server = require('../host');

var passed = 0;
var failed = 0;

function describe(name) { console.log('\n' + name); }
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
function throws(fn, substr, message) {
  try { fn(); assert(false, message + ' — did not throw'); }
  catch (e) { assert(e.message.indexOf(substr) !== -1, message + ' (threw: ' + e.message + ')'); }
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Host adapter validation                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function makeValidHost(overrides) {
  var base = {
    now: function () { return Date.now(); },
    scheduleAfter: function () {},
    scheduleEvery: function () {},
    cancelTimer: function () {},
    emit: function () {},
    persist: function () {},
    log: function () {},
    capabilities: ['log', 'notify']
  };
  var host = {};
  for (var k in base) host[k] = base[k];
  for (var ok in overrides) host[ok] = overrides[ok];
  return host;
}

describe('validateHost — complete adapter passes');
eq(adapters.validateHost(makeValidHost()), undefined, 'full host passes (no throw)');

describe('validateHost — capabilities is required');
// Bug 8 — adapters.js Design Issue: host.capabilities not in validated interface
// machine.js reads host.capabilities || []; adapter without it silently disables mp-where
throws(function () {
  adapters.validateHost(makeValidHost({ capabilities: undefined }));
}, 'capabilities', 'rejects host without capabilities array');

throws(function () {
  adapters.validateHost(makeValidHost({ capabilities: 'log' }));
}, 'capabilities', 'rejects capabilities as string (must be array)');

describe('validateHost — required function fields');
throws(function () {
  adapters.validateHost(makeValidHost({ now: null }));
}, 'now', 'rejects missing now');

throws(function () {
  adapters.validateHost(makeValidHost({ scheduleAfter: 42 }));
}, 'scheduleAfter', 'rejects non-function scheduleAfter');

describe('validateHost — reports all missing fields');
(function () {
  var caught = null;
  try { adapters.validateHost({}); } catch (e) { caught = e; }
  assert(caught !== null, 'throws for empty host');
  assert(caught.message.indexOf('now') !== -1, 'lists now in error');
  assert(caught.message.indexOf('emit') !== -1, 'lists emit in error');
  assert(caught.message.indexOf('capabilities') !== -1, 'lists capabilities in error');
})();


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Storage validation                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('validateStorage — complete adapter passes');
var good = server.createMemoryStorage();
var storageValid = adapters.validateStorage(good);
eq(storageValid, undefined, 'memory storage passes validation (no throw)');

describe('validateStorage — missing methods detected');
throws(function () {
  adapters.validateStorage({});
}, 'missing methods', 'rejects empty object');

throws(function () {
  adapters.validateStorage({
    putDefinition: function () {},
    getDefinition: function () {},
    listDefinitions: function () {}
  });
}, 'putInstance', 'reports specific missing method');

describe('validateStorage — partial adapter lists all missing');
try {
  adapters.validateStorage({ putDefinition: function () {} });
} catch (err) {
  assert(err.message.indexOf('getDefinition') !== -1, 'lists getDefinition in error');
  assert(err.message.indexOf('putInstance') !== -1, 'lists putInstance in error');
  assert(err.message.indexOf('deleteInstance') !== -1, 'lists deleteInstance in error');
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Effect validation                                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('validateEffect — function passes');
var effectValid = adapters.validateEffect('test', function () {});
eq(effectValid, undefined, 'function adapter passes validation (no throw)');

describe('validateEffect — non-function rejected');
throws(function () { adapters.validateEffect('bad', 'not a function'); }, 'must be a function', 'rejects string');
throws(function () { adapters.validateEffect('bad', {}); }, 'must be a function', 'rejects object');
throws(function () { adapters.validateEffect('bad', null); }, 'must be a function', 'rejects null');

describe('validateEffects — validates all entries');
var multiValid = adapters.validateEffects({ 'http.post': function () {}, 'db.query': function () {} });
eq(multiValid, undefined, 'multiple valid effects pass (no throw)');

throws(function () {
  adapters.validateEffects({ 'http.post': function () {}, 'bad.one': 42 });
}, 'bad.one', 'reports which effect is invalid');

describe('validateEffects — null/undefined skipped');
eq(adapters.validateEffects(null), undefined, 'null effects accepted');
eq(adapters.validateEffects(undefined), undefined, 'undefined effects accepted');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Memory storage — contract tests                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('memory storage — definitions');
var store = server.createMemoryStorage();

store.putDefinition({ id: 'test-def', initial: 'a', stateNames: ['a', 'b'] });
var def = store.getDefinition('test-def');
eq(def.id, 'test-def', 'putDefinition + getDefinition returns correct id');
deepEq(def.stateNames, ['a', 'b'], 'definition stateNames preserved');

eq(store.getDefinition('nonexistent'), null, 'returns null for missing definition');

var defs = store.listDefinitions();
eq(defs.length, 1, 'listDefinitions returns 1');
eq(defs[0].id, 'test-def', 'listed id matches');

describe('memory storage — instances');
store.putInstance({ id: 'inst-1', definitionId: 'test-def', state: 'a', context: {} });
var inst = store.getInstance('inst-1');
eq(inst.id, 'inst-1', 'putInstance + getInstance returns correct id');
eq(inst.state, 'a', 'correct state');

eq(store.getInstance('nonexistent'), null, 'returns null for missing instance');

var insts = store.listInstances();
eq(insts.length, 1, 'listInstances returns 1');

store.putInstance({ id: 'inst-1', definitionId: 'test-def', state: 'b', context: {} });
var updated = store.getInstance('inst-1');
eq(updated.state, 'b', 'putInstance updates existing');

store.deleteInstance('inst-1');
eq(store.getInstance('inst-1'), null, 'deleteInstance removes');
eq(store.listInstances().length, 0, 'listInstances empty after delete');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Server rejects bad adapters at startup                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('server startup — rejects bad storage');
throws(function () {
  server.createServer({ storage: {}, port: 19999, machinesDir: '/nonexistent' });
}, 'missing methods', 'server throws on invalid storage adapter');

describe('server startup — rejects bad effects');
throws(function () {
  server.createServer({ effects: { 'bad': 42 }, port: 19998, machinesDir: '/nonexistent' });
}, 'must be a function', 'server throws on invalid effect adapter');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Summary                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
process.exit(failed > 0 ? 1 : 0);
