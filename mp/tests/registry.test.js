/**
 * Registry machine — hand-computed tests.
 *
 * The registry is a machine. It has states, transitions, context.
 * Nodes register by sending events. Lookups query the context.
 *
 * Run: node mp/tests/registry.test.js
 */

var fs = require('fs');
var path = require('path');
var scxml = require('../scxml');
var machine = require('../machine');
var engine = require('../engine');

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
inst.context.address = 'http://localhost:4000';
inst.context.capabilities = ['log', 'notify', 'ui-render'];
inst.context.formats = ['html', 'scxml'];
var r1 = machine.sendEvent(inst, 'register');

eq(r1.targetless, true, 'register succeeded (targetless)');
eq(inst.context.nodes.length, 1, 'one node registered');
eq(inst.context.nodes[0].id, 'server-1', 'node id');
eq(inst.context.nodes[0].address, 'http://localhost:4000', 'node address');
deepEq(inst.context.nodes[0].capabilities, ['log', 'notify', 'ui-render'], 'capabilities');
deepEq(inst.context.nodes[0].formats, ['html', 'scxml'], 'formats');
eq(typeof inst.context.nodes[0].registered_at, 'number', 'registered_at is a timestamp');


// Register a second node — fulfilment container
inst.context.id = 'fulfilment-1';
inst.context.address = 'http://localhost:4001';
inst.context.capabilities = ['persist', 'fulfil'];
inst.context.formats = ['scxml'];
var r2 = machine.sendEvent(inst, 'register');

eq(r2.targetless, true, 'second register succeeded (targetless)');
eq(inst.context.nodes.length, 2, 'two nodes registered');
eq(inst.context.nodes[1].id, 'fulfilment-1', 'second node id');
deepEq(inst.context.nodes[1].capabilities, ['persist', 'fulfil'], 'second capabilities');
deepEq(inst.context.nodes[1].formats, ['scxml'], 'second formats');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Register guard — rejects incomplete registration                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('registry — guard rejects incomplete');

// Clear the fields, then try to register with missing data
inst.context.id = 'bad-1';
inst.context.address = null;
inst.context.capabilities = null;
inst.context.formats = null;
var r3 = machine.sendEvent(inst, 'register');
eq(r3.transitioned, false, 'rejected: no address or capabilities');
eq(inst.context.nodes.length, 2, 'still two nodes');

inst.context.id = 'bad-2';
inst.context.address = 'http://x';
inst.context.capabilities = ['log'];
inst.context.formats = null;
var r4 = machine.sendEvent(inst, 'register');
eq(r4.transitioned, false, 'rejected: no formats');
eq(inst.context.nodes.length, 2, 'still two nodes');


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

// Find nodes that accept 'html'
var htmlNodes = engine.eval(
  "(->> nodes (filter (fn [n] (includes? (get n :formats) 'html'))))",
  { nodes: nodes }
);
eq(htmlNodes.length, 1, 'one node accepts html');
eq(htmlNodes[0].id, 'server-1', 'server accepts html');

// Find nodes that accept 'scxml'
var scxmlNodes = engine.eval(
  "(->> nodes (filter (fn [n] (includes? (get n :formats) 'scxml'))))",
  { nodes: nodes }
);
eq(scxmlNodes.length, 2, 'two nodes accept scxml');

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
eq(inst.context.nodes.length, 1, 'one node remaining');
eq(inst.context.nodes[0].id, 'fulfilment-1', 'fulfilment remains');

// Deregister the last one
inst.context.id = 'fulfilment-1';
machine.sendEvent(inst, 'deregister');
eq(inst.context.nodes.length, 0, 'no nodes remaining');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  State stays active — registry never leaves active state                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

describe('registry — always active');
eq(inst.state, 'active', 'still in active state after all operations');


// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
process.exit(failed > 0 ? 1 : 0);
