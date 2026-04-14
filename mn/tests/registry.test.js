/**
 * Registry machine — hand-computed tests.
 *
 * The registry is a machine. It has states, transitions, context.
 * Nodes register by sending events. Lookups query the context.
 *
 * Run: node mn/tests/registry.test.js
 */

var fs = require('fs');
var http = require('http');
var path = require('path');
var scxml = require('../scxml');
var machine = require('../machine');
var engine = require('../engine');
var registry = require('../registry');

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


// Load the registry machine definition
var registryScxml = fs.readFileSync(path.join(__dirname, '..', 'machines', 'registry.scxml'), 'utf8');
var registryDef = scxml.compile(registryScxml, {});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Registry machine — definition                                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('registry — definition');
eq(registryDef.id, 'registry', 'id is registry');
eq(registryDef.initial, 'active', 'initial state is active');
deepEq(registryDef.context.nodes, [], 'context starts with empty nodes');
eq(typeof registryDef.states.active, 'object', 'has active state');
eq(Array.isArray(registryDef.states.active.on.register), true, 'has register transition array');
eq(Array.isArray(registryDef.states.active.on.deregister), true, 'has deregister transition array');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Register a node                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('registry — register');

var inst = machine.createInstance(registryDef);
eq(inst.context.nodes.length, 0, 'starts empty');

// Register a server node — set context, then send event
inst.context.id = 'server-1';
inst.context.capabilities = ['log', 'notify', 'ui-render'];
inst.context.transport = { type: 'http-post', address: 'http://localhost:4000/api/machine' };
var r1 = machine.sendEvent(inst, 'register');

eq(r1.targetless, true, 'register succeeded (targetless)');
eq(inst.context.nodes.length, 1, 'one node registered');
eq(inst.context.nodes[0].id, 'server-1', 'node id');
eq(inst.context.nodes[0].transport.type, 'http-post', 'transport type');
eq(inst.context.nodes[0].transport.address, 'http://localhost:4000/api/machine', 'transport address');
deepEq(inst.context.nodes[0].capabilities, ['log', 'notify', 'ui-render'], 'capabilities');
eq(typeof inst.context.nodes[0].registered_at, 'number', 'registered_at is a timestamp');


// Register a second node — fulfilment container
inst.context.id = 'fulfilment-1';
inst.context.capabilities = ['persist', 'fulfil'];
inst.context.transport = { type: 'http-post', address: 'http://localhost:4001/api/machine' };
var r2 = machine.sendEvent(inst, 'register');

eq(r2.targetless, true, 'second register succeeded (targetless)');
eq(inst.context.nodes.length, 2, 'two nodes registered');
eq(inst.context.nodes[1].id, 'fulfilment-1', 'second node id');
deepEq(inst.context.nodes[1].capabilities, ['persist', 'fulfil'], 'second capabilities');
eq(inst.context.nodes[1].transport.type, 'http-post', 'second transport type');


// Register a browser node with SSE transport
inst.context.id = 'browser-abc';
inst.context.capabilities = ['dom', 'director-review'];
inst.context.transport = { type: 'sse', channel: 'http://localhost:4000/sse/browser-abc' };
var r2b = machine.sendEvent(inst, 'register');

eq(r2b.targetless, true, 'browser SSE register succeeded');
eq(inst.context.nodes.length, 3, 'three nodes registered');
eq(inst.context.nodes[2].transport.type, 'sse', 'browser transport is SSE');
eq(inst.context.nodes[2].transport.channel, 'http://localhost:4000/sse/browser-abc', 'SSE channel');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Register guard — rejects incomplete registration                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('registry — guard rejects incomplete');

// Clear the fields, then try to register with missing data
inst.context.id = 'bad-1';
inst.context.transport = null;
inst.context.capabilities = null;
var r3 = machine.sendEvent(inst, 'register');
eq(r3.transitioned, false, 'rejected: no transport or capabilities');
eq(inst.context.nodes.length, 3, 'still three nodes');

inst.context.id = 'bad-2';
inst.context.capabilities = ['log'];
inst.context.transport = null;
var r4 = machine.sendEvent(inst, 'register');
eq(r4.transitioned, false, 'rejected: no transport');
eq(inst.context.nodes.length, 3, 'still three nodes');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Lookup — query nodes by capability                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('registry — lookup by capability');

// Lookup is a pure evaluation against the registry context.
// No event needed — just query the context with the engine.

var nodes = inst.context.nodes;

// Find nodes that can 'persist'
var persistNodes = engine.eval(
  "(->> nodes (filter (fn [n] (includes? (get n :capabilities) 'persist'))))",
  { nodes: nodes }
);
eq(persistNodes.length, 1, 'one node can persist');
eq(persistNodes[0].id, 'fulfilment-1', 'fulfilment node');

// Find nodes that can 'log'
var logNodes = engine.eval(
  "(->> nodes (filter (fn [n] (includes? (get n :capabilities) 'log'))))",
  { nodes: nodes }
);
eq(logNodes.length, 1, 'one node can log');
eq(logNodes[0].id, 'server-1', 'server node');

// Find nodes reachable via http-post
var httpNodes = engine.eval(
  "(->> nodes (filter (fn [n] (= (get (get n :transport) :type) 'http-post'))))",
  { nodes: nodes }
);
eq(httpNodes.length, 2, 'two nodes reachable via http-post');

// Find nodes reachable via SSE
var sseNodes = engine.eval(
  "(->> nodes (filter (fn [n] (= (get (get n :transport) :type) 'sse'))))",
  { nodes: nodes }
);
eq(sseNodes.length, 1, 'one node reachable via SSE');
eq(sseNodes[0].id, 'browser-abc', 'SSE node is browser');

// Find nodes that can BOTH persist AND fulfil
var bothNodes = engine.eval(
  "(->> nodes (filter (fn [n] (and (includes? (get n :capabilities) 'persist') (includes? (get n :capabilities) 'fulfil')))))",
  { nodes: nodes }
);
eq(bothNodes.length, 1, 'one node can persist AND fulfil');
eq(bothNodes[0].id, 'fulfilment-1', 'fulfilment has both');

// No node can 'email' — empty result
var emailNodes = engine.eval(
  "(->> nodes (filter (fn [n] (includes? (get n :capabilities) 'email'))))",
  { nodes: nodes }
);
eq(emailNodes.length, 0, 'no node can email');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Deregister                                                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('registry — deregister');

inst.context.id = 'server-1';
var r5 = machine.sendEvent(inst, 'deregister');
eq(r5.targetless, true, 'deregister succeeded (targetless)');
eq(inst.context.nodes.length, 2, 'two nodes remaining (fulfilment + browser)');
eq(inst.context.nodes[0].id, 'fulfilment-1', 'fulfilment remains');

// Deregister fulfilment
inst.context.id = 'fulfilment-1';
machine.sendEvent(inst, 'deregister');
eq(inst.context.nodes.length, 1, 'one node remaining (browser)');

// Deregister browser
inst.context.id = 'browser-abc';
machine.sendEvent(inst, 'deregister');
eq(inst.context.nodes.length, 0, 'no nodes remaining');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  State stays active — registry never leaves active state                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('registry — always active');
eq(inst.state, 'active', 'still in active state after all operations');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Bug fixes                                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('Bug 17 — register event is targetless (transitioned=false, targetless=true)');
// The HTTP handler must check `result.targetless` not just `result.transitioned`,
// otherwise it always returns {registered: false} even on success.

(function () {
  var freshInst = machine.createInstance(registryDef);
  freshInst.context.id = 'bugtest-1';
  freshInst.context.capabilities = ['log'];
  freshInst.context.transport = { type: 'http-post', address: 'http://localhost:9000/api/machine' };
  var result = machine.sendEvent(freshInst, 'register');
  eq(result.transitioned, false, 'register: transitioned=false (targetless, no state change)');
  eq(result.targetless, true, 'register: targetless=true (self-update)');
  eq(freshInst.context.nodes.length, 1, 'node was added despite transitioned=false');
})();


describe('H7 — duplicate node ID registration is rejected');

(function () {
  var dupInst = machine.createInstance(registryDef);
  dupInst.context.id = 'dup-1';
  dupInst.context.capabilities = ['log'];
  dupInst.context.transport = { type: 'http-post', address: 'http://localhost:5000/api/machine' };
  machine.sendEvent(dupInst, 'register');
  eq(dupInst.context.nodes.length, 1, 'first registration succeeds');

  // Same ID, different transport — must be rejected
  dupInst.context.id = 'dup-1';
  dupInst.context.transport = { type: 'http-post', address: 'http://localhost:5001/api/machine' };
  var rDup = machine.sendEvent(dupInst, 'register');
  eq(rDup.transitioned, false, 'duplicate id: transitioned=false');
  assert(!rDup.targetless, 'duplicate id: not targetless (guard blocked)');
  eq(dupInst.context.nodes.length, 1, 'still one node — original not replaced');
  eq(dupInst.context.nodes[0].transport.address, 'http://localhost:5000/api/machine', 'original transport preserved');
})();


describe('Bug 18 — deregister with null id: guard blocks, not targetless');
// The HTTP handler must check result.targetless before responding 200.
// The deregister guard is (some? id) — null id fails the guard.

(function () {
  var freshInst = machine.createInstance(registryDef);
  freshInst.context.id = null;  // null id fails (some? id)
  var result = machine.sendEvent(freshInst, 'deregister');
  eq(result.transitioned, false, 'deregister null id: transitioned=false');
  assert(!result.targetless, 'deregister null id: not targetless (guard blocked)');
  // HTTP handler must return 400 for this case, not 200
})();


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  HTTP server tests                                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Spin up a real registry server on a random port and exercise the API.

var httpPort = 13000 + Math.floor(Math.random() * 1000);
var httpBase = 'http://localhost:' + httpPort;

function httpPost(url, body) {
  return new Promise(function (resolve, reject) {
    var data = body ? JSON.stringify(body) : '{}';
    var urlObj = new URL(url);
    var opts = {
      hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    var req = http.request(opts, function (res) {
      var chunks = '';
      res.on('data', function (c) { chunks += c; });
      res.on('end', function () {
        var json = null; try { json = JSON.parse(chunks); } catch (e) {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise(function (resolve, reject) {
    var urlObj = new URL(url);
    var req = http.request({ hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname, method: 'GET' }, function (res) {
      var chunks = '';
      res.on('data', function (c) { chunks += c; });
      res.on('end', function () {
        var json = null; try { json = JSON.parse(chunks); } catch (e) {}
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runHttpTests() {
  var serverInstance;
  var origLog = console.log;
  console.log = function () {};
  try {
    serverInstance = registry.createServer({ port: httpPort });
  } finally {
    console.log = origLog;
  }

  await new Promise(function (resolve) { setTimeout(resolve, 300); });


  describe('HTTP — POST /register succeeds');
  var reg1 = await httpPost(httpBase + '/register', {
    id: 'http-node-1',
    capabilities: ['log'],
    transport: { type: 'http-post', address: 'http://localhost:9000/api/machine' }
  });
  eq(reg1.status, 200, 'status 200');
  eq(reg1.body.registered, true, 'registered: true');
  eq(reg1.body.nodes, 1, 'one node registered');


  describe('HTTP — POST /register rejects bad payload');
  var regBad = await httpPost(httpBase + '/register', { id: 'incomplete' });
  eq(regBad.status, 400, 'status 400 for incomplete registration');
  eq(regBad.body.registered, false, 'registered: false');


  describe('HTTP — GET /routes returns node list');
  var routes = await httpGet(httpBase + '/routes');
  eq(routes.status, 200, 'status 200');
  eq(Array.isArray(routes.body), true, 'body is an array');
  eq(routes.body.length, 1, 'one node in routes');
  eq(routes.body[0].id, 'http-node-1', 'correct node id');


  describe('HTTP — POST /deregister succeeds');
  var dereg = await httpPost(httpBase + '/deregister', { id: 'http-node-1' });
  eq(dereg.status, 200, 'status 200');
  eq(dereg.body.deregistered, true, 'deregistered: true');
  eq(dereg.body.nodes, 0, 'zero nodes remaining');


  describe('HTTP — POST /deregister unknown id returns 400');
  var deregUnknown = await httpPost(httpBase + '/deregister', { id: 'nobody' });
  eq(deregUnknown.status, 400, 'status 400');
  eq(deregUnknown.body.deregistered, false, 'deregistered: false');


  describe('HTTP — oversized POST body returns 400');
  var bigBody = JSON.stringify({ id: 'x', address: 'http://x', capabilities: [], formats: [], data: 'x'.repeat(70000) });
  var bigRes = await new Promise(function (resolve, reject) {
    var urlObj = new URL(httpBase + '/register');
    var opts = {
      hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bigBody) }
    };
    var req = http.request(opts, function (res) {
      var chunks = '';
      res.on('data', function (c) { chunks += c; });
      res.on('end', function () { resolve({ status: res.statusCode }); });
    });
    req.on('error', function () { resolve({ status: 0 }); });
    req.write(bigBody);
    req.end();
  });
  assert(bigRes.status === 400 || bigRes.status === 0, 'oversized body: 400 or connection error');


  serverInstance.close();


  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
  process.exit(failed > 0 ? 1 : 0);
}

runHttpTests().catch(function (err) {
  console.error(err);
  process.exit(1);
});
