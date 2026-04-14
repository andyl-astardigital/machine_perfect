/**
 * Purchase order pipeline — capability-based machine execution.
 *
 * Wires effect adapters from adapters/ into the pipeline executor.
 * Each adapter is a single-responsibility module. This file only
 * composes them and exposes the pipeline execution function.
 *
 * No business logic. The machine carries the logic. This file is
 * pure infrastructure: compile SCXML, execute with adapters, return SCXML.
 */

var scxml = require('../../mn/scxml');
var machine = require('../../mn/machine');
var transforms = require('../../mn/transforms');

var auth = require('./adapters/auth');
var log = require('./adapters/log');
var notify = require('./adapters/notify');
var fulfil = require('./adapters/fulfil');
var persist = require('./adapters/persist');
var data = require('./adapters/data');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Effect adapter registry                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var adapters = {
  'auth': auth,
  'data': data,
  'log': log,
  'notify': notify,
  'fulfil': fulfil,
  'persist': persist
};

var capabilities = Object.keys(adapters);


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Result formatting                                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function _formatResult(def, result, scxmlMarkup) {
  var isFinal = result.instance && result.instance.state &&
    def._stateTree[result.instance.state] &&
    def._stateTree[result.instance.state].spec.final;

  if (isFinal) console.log('[executor] final state: ' + result.instance.state);
  if (result.blocked) console.log('[executor] blocked: ' + result.reason);
  if (result.route) console.log('[executor] routed: requires ' + (result.route.requires || []).join(', '));
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
// ║  Pipeline execution                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function execute(scxmlMarkup) {
  console.log('[executor] received SCXML');
  var def = scxml.compile(scxmlMarkup, {});
  var result = machine.executePipeline(def, {
    effects: adapters,
    maxSteps: 10,
    format: scxmlMarkup,
    formatUpdater: transforms.updateScxmlState,
    compiler: scxml.compile,
    canonicalResolver: function (id) { return require('./db').one(id); }
  });
  return _formatResult(def, result, scxmlMarkup);
}

async function executeAsync(scxmlMarkup) {
  console.log('[executor] received SCXML (async)');
  var def = scxml.compile(scxmlMarkup, {});
  var result = await machine.executePipelineAsync(def, {
    effects: adapters,
    maxSteps: 10,
    effectTimeout: 10000,
    format: scxmlMarkup,
    formatUpdater: transforms.updateScxmlState,
    compiler: scxml.compile,
    canonicalResolver: function (id) { return require('./db').one(id); }
  });
  return _formatResult(def, result, scxmlMarkup);
}


module.exports = {
  execute: execute,
  executeAsync: executeAsync,
  capabilities: capabilities
};
