/**
 * machine_native — adapter interfaces.
 *
 * Formal contracts for storage and effect adapters. Any implementation
 * that satisfies these interfaces can be injected into the server.
 * The framework ships with in-memory storage. Everything else is yours.
 *
 * @version 0.5.0
 * @license MIT
 */


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Storage adapter interface                                              ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// A storage adapter persists machine definitions and instances.
// All methods may be sync or async (return values or promises).
// The server awaits all calls.
//
// Implementations: in-memory, Postgres, SQLite, MongoDB, Redis,
// flat files, S3, or anything else that can store and retrieve objects.
//
// INTERFACE:
//
//   putDefinition(def)          Store a compiled machine definition.
//                               def: { id, initial, context, states, stateNames }
//
//   getDefinition(id)           Retrieve a definition by id.
//                               Returns: definition object or null.
//
//   listDefinitions()           List all stored definitions.
//                               Returns: [{ id, initial, states }]
//
//   putInstance(instance)        Store a machine instance (create or update).
//                               instance: { id, definitionId, state, context, history, ... }
//
//   getInstance(id)             Retrieve an instance by id.
//                               Returns: instance object or null.
//
//   listInstances()              List all instances.
//                               Returns: [{ id, definitionId, state }]
//
//   deleteInstance(id)           Remove an instance.
//


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Effect adapter interface                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// An effect adapter executes a side effect on behalf of a machine.
// The machine declares WHAT (via invoke!), the adapter decides HOW.
//
// Effects are registered by type name at server startup:
//
//   createServer({
//     effects: {
//       'http.post': myHttpAdapter,
//       'db.query': myDbAdapter,
//       'email.send': myEmailAdapter
//     }
//   });
//
// INTERFACE:
//
// An effect adapter is a function:
//
//   async function(input, context) → result
//
//   input:    The evaluated s-expression from the machine's invoke! call.
//             Typically an object: { url, json, to, subject, sql, ... }
//
//   context:  Read-only snapshot of the machine's current context.
//             For reference — the adapter should NOT mutate this.
//
//   Returns:  A result value that will be stored in the machine's context
//             at the key specified by the invoke!'s :bind parameter.
//
//   Throws:   On failure. The machine transitions to the error state
//             specified by :on-error, or the error is logged if none.
//
// EXAMPLE:
//
//   // HTTP POST effect adapter
//   async function httpPost(input) {
//     var res = await fetch(input.url, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify(input.json)
//     });
//     if (!res.ok) throw new Error('HTTP ' + res.status);
//     return await res.json();
//   }
//


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Host adapter interface                                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// The host adapter is the bridge between the shared engine and the
// platform. Passed to createInstance. The machine calls these for
// platform capabilities it cannot provide itself.
//
// INTERFACE:
//
//   now()                       Returns current timestamp (ms).
//
//   scheduleAfter(ms, cb)       One-shot timer. Returns timer id.
//
//   scheduleEvery(ms, cb)       Repeating timer. Returns timer id.
//
//   cancelTimer(id)             Cancel a timer by id.
//
//   emit(name, detail)          Dispatch an inter-machine event.
//
//   persist(snapshot)            Save instance state. Called after every
//                               transition. snapshot: { id, definitionId,
//                               state, context, history }
//
//   log(level, ...args)         Diagnostic output.
//
//   capabilities                Array of capability strings this host
//                               provides. Required for mn-where routing —
//                               machine.js reads host.capabilities || []
//                               so an adapter without this silently reports
//                               no capabilities and mn-where always routes
//                               remotely instead of executing locally.
//                               Example: ['log', 'notify', 'persist']
//
// The server creates a host adapter per instance that delegates to
// the storage adapter for persistence and to effect adapters for
// side effects.
//


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Validation                                                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Verify that an object satisfies an adapter interface at startup,
// before the first request hits it.

function validateHost(host) {
  var requiredFns = ['now', 'scheduleAfter', 'scheduleEvery', 'cancelTimer', 'emit', 'persist', 'log'];
  var missing = [];
  for (var i = 0; i < requiredFns.length; i++) {
    if (typeof host[requiredFns[i]] !== 'function') missing.push(requiredFns[i]);
  }
  if (!Array.isArray(host.capabilities)) missing.push('capabilities (must be an array)');
  if (missing.length > 0) {
    throw new Error('[mn] host adapter missing fields: ' + missing.join(', '));
  }
}

function validateStorage(adapter) {
  var required = ['putDefinition', 'getDefinition', 'listDefinitions',
                  'putInstance', 'getInstance', 'listInstances', 'deleteInstance'];
  var missing = [];
  for (var i = 0; i < required.length; i++) {
    if (typeof adapter[required[i]] !== 'function') missing.push(required[i]);
  }
  if (missing.length > 0) {
    throw new Error('[mn] storage adapter missing methods: ' + missing.join(', '));
  }
}

function validateEffect(name, adapter) {
  if (typeof adapter !== 'function') {
    throw new Error('[mn] effect adapter "' + name + '" must be a function');
  }
}

function validateEffects(effects) {
  if (!effects) return;
  for (var name in effects) {
    if (effects.hasOwnProperty(name)) validateEffect(name, effects[name]);
  }
}


module.exports = {
  validateHost: validateHost,
  validateStorage: validateStorage,
  validateEffect: validateEffect,
  validateEffects: validateEffects
};
