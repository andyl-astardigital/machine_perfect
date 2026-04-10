/**
 * Purchase order pipeline — capability-based machine execution.
 *
 * Effect adapters define this host's capabilities. The framework's
 * executePipeline handles the compile→instance→event loop→dispatch
 * pattern. This file only defines WHAT this host can do.
 */

var scxml = require('../../mp/scxml');
var machine = require('../../mp/machine');
var transforms = require('../../mp/transforms');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Storage                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var storage = [];

function setStorage(store) { storage = store; }


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Effect adapters — this host's capabilities                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var adapters = {
  'log': function (input) {
    console.log('[effect:log] ' + input);
  },
  'notify': function (input) {
    // Async — simulates sending an email via an external API
    return new Promise(function (resolve) {
      setTimeout(function () {
        console.log('[effect:notify] to=' + input.to + ' subject=' + input.subject);
        resolve({ sent: true, to: input.to });
      }, 2);
    });
  },
  'fulfil': function (input) {
    console.log('[effect:fulfil] ' + input.title + ' (' + input.items.length + ' items)');
  },
  'persist': function (input, context) {
    // Async — simulates a database write
    var id = 'po-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    var order = {
      id: id, title: input.title, amount: input.amount,
      items: input.items, notes: input.notes || '',
      status: input.status || 'fulfilled', created_at: input.created_at || Date.now()
    };
    return new Promise(function (resolve) {
      setTimeout(function () {
        storage.push(order);
        console.log('[effect:persist] order ' + id + ' stored (' + storage.length + ' total)');
        resolve(id);
      }, 2);
    });
  }
};

var capabilities = Object.keys(adapters);


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Pipeline execution                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function execute(scxmlMarkup) {
  console.log('[executor] received SCXML');

  var def = scxml.compile(scxmlMarkup, {});

  var result = machine.executePipeline(def, {
    effects: adapters,
    maxSteps: 10,
    format: scxmlMarkup,
    formatUpdater: transforms.updateScxmlState
  });

  var isFinal = result.instance && result.instance.state &&
    def._stateTree[result.instance.state] &&
    def._stateTree[result.instance.state].spec.final;

  if (isFinal) console.log('[executor] final state: ' + result.instance.state);
  if (result.blocked) console.log('[executor] blocked: ' + result.reason);
  if (result.route) console.log('[executor] route signal: requires ' + result.route.requires.join(', '));

  console.log('[executor] complete.\n');

  return {
    scxml: result.format || scxmlMarkup,
    history: result.history,
    effects: result.effects,
    blocked: result.blocked || false,
    reason: result.reason || null,
    route: result.route || null
  };
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Async pipeline execution                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Same as execute() but awaits each effect adapter. Use when adapters
// return promises (database queries, HTTP calls, solver invocations).
// The bind field on invoke! injects the resolved value back into context
// before the next guard evaluates.

async function executeAsync(scxmlMarkup) {
  console.log('[executor] received SCXML (async)');

  var def = scxml.compile(scxmlMarkup, {});

  var result = await machine.executePipelineAsync(def, {
    effects: adapters,
    maxSteps: 10,
    format: scxmlMarkup,
    formatUpdater: transforms.updateScxmlState
  });

  var isFinal = result.instance && result.instance.state &&
    def._stateTree[result.instance.state] &&
    def._stateTree[result.instance.state].spec.final;

  if (isFinal) console.log('[executor] final state: ' + result.instance.state);
  if (result.blocked) console.log('[executor] blocked: ' + result.reason);
  if (result.route) console.log('[executor] route signal: requires ' + result.route.requires.join(', '));

  console.log('[executor] complete.\n');

  return {
    scxml: result.format || scxmlMarkup,
    history: result.history,
    effects: result.effects,
    blocked: result.blocked || false,
    reason: result.reason || null,
    route: result.route || null
  };
}


module.exports = {
  execute: execute,
  executeAsync: executeAsync,
  setStorage: setStorage,
  capabilities: capabilities
};
