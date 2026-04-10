/**
 * machine_native — backend HTTP server.
 *
 * Machine-native API. No Express, no Fastify, no dependencies.
 * Loads SCXML definitions, creates instances, accepts events,
 * returns machine state + enabled transitions.
 *
 * Usage:
 *   node mn/host.js                                 # start on port 4000
 *   node mn/host.js --port 8080                     # custom port
 *   node mn/host.js --machines ./my-machines         # custom definitions dir
 *
 * API:
 *   GET  /definitions                     List loaded definitions
 *   GET  /definitions/:id                 Inspect a definition
 *   POST /definitions/:id/validate        Validate a definition
 *   POST /instances                       Create instance { definition, id?, context? }
 *   GET  /instances                       List all instances
 *   GET  /instances/:id                   Inspect instance (state, enabled, context)
 *   GET  /instances/:id/history           Audit trail
 *   POST /instances/:id/events/:event     Send event { data? }
 *   GET  /instances/:id/snapshot          Export instance
 *
 * @version 0.5.0
 * @license MIT
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var scxml = require('./scxml');
var machine = require('./machine');
var adapters = require('./adapters');


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Storage — in-memory (Postgres adapter replaces this later)             ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Dependency injection: the server receives a storage object.
// In-memory for now, Postgres later. Same interface.

function createMemoryStorage(options) {
  options = options || {};
  var maxInstances = options.maxInstances || 10000;
  var definitions = {};
  var instances = {};
  var instanceOrder = []; // insertion-ordered IDs for eviction

  return {
    // ── Definitions ──
    putDefinition: function (def) {
      definitions[def.id] = def;
    },
    getDefinition: function (id) {
      return definitions[id] || null;
    },
    listDefinitions: function () {
      return Object.keys(definitions).map(function (id) {
        return { id: id, initial: definitions[id].initial, states: definitions[id].stateNames };
      });
    },

    // ── Instances ──
    putInstance: function (instance) {
      if (!instances[instance.id]) {
        instanceOrder.push(instance.id);
        // Evict oldest if over cap
        while (instanceOrder.length > maxInstances) {
          var evicted = instanceOrder.shift();
          delete instances[evicted];
        }
      }
      instances[instance.id] = instance;
    },
    getInstance: function (id) {
      return instances[id] || null;
    },
    listInstances: function () {
      return instanceOrder.filter(function (id) { return !!instances[id]; }).map(function (id) {
        var inst = instances[id];
        return { id: id, definitionId: inst.definitionId, state: inst.state };
      });
    },
    deleteInstance: function (id) {
      delete instances[id];
      var idx = instanceOrder.indexOf(id);
      if (idx !== -1) instanceOrder.splice(idx, 1);
    }
  };
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Definition loader                                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Scans a directory for .scxml files, compiles each, stores in storage.

function loadDefinitions(directory, storage) {
  if (!fs.existsSync(directory)) {
    console.log('[mn-server] machines directory not found: ' + directory);
    return 0;
  }

  var files = fs.readdirSync(directory).filter(function (file) {
    return file.endsWith('.scxml');
  });

  var loaded = 0;
  for (var i = 0; i < files.length; i++) {
    var filePath = path.join(directory, files[i]);
    var xmlContent = fs.readFileSync(filePath, 'utf-8');
    var id = path.basename(files[i], '.scxml');

    try {
      var def = scxml.compile(xmlContent, { id: id });
      storage.putDefinition(def);
      console.log('[mn-server] loaded definition: ' + id + ' (' + def.stateNames.length + ' states)');
      loaded++;
    } catch (err) {
      console.warn('[mn-server] failed to compile ' + files[i] + ': ' + err.message);
    }
  }

  return loaded;
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  HTTP request handling                                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function createServer(options) {
  options = options || {};
  var storage = options.storage || createMemoryStorage();
  var effects = options.effects || {};
  var port = options.port || 4000;
  var machinesDir = options.machinesDir || path.join(__dirname, 'machines');

  // Validate adapters at startup — fail fast, not on first request
  adapters.validateStorage(storage);
  adapters.validateEffects(effects);

  // Load definitions from disk
  var loaded = loadDefinitions(machinesDir, storage);
  console.log('[mn-server] ' + loaded + ' definition(s) loaded from ' + machinesDir);

  // ── Route matching ──
  // Simple pattern matching — no router dependency.
  function match(method, urlPath, pattern) {
    if (method !== pattern.method) return null;
    var patternParts = pattern.path.split('/');
    var urlParts = urlPath.split('/');
    if (patternParts.length !== urlParts.length) return null;

    var params = {};
    for (var i = 0; i < patternParts.length; i++) {
      if (patternParts[i].charAt(0) === ':') {
        try { params[patternParts[i].substring(1)] = decodeURIComponent(urlParts[i]); }
        catch (e) { return null; }
      } else if (patternParts[i] !== urlParts[i]) {
        return null;
      }
    }
    return params;
  }

  // ── Response helpers ──
  function json(res, statusCode, data) {
    var body = JSON.stringify(data, null, 2);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-MN-Target, X-MN-Machine'
    });
    res.end(body);
  }

  var MAX_BODY_SIZE = 1048576; // 1MB

  function readBody(req, callback) {
    var body = '';
    var called = false;
    req.on('data', function (chunk) {
      body += chunk;
      if (body.length > MAX_BODY_SIZE && !called) {
        called = true;
        req.destroy();
        callback(null, new Error('Body exceeds 1MB limit'));
      }
    });
    req.on('end', function () {
      if (called) return;
      called = true;
      if (!body) return callback({});
      try { callback(JSON.parse(body)); }
      catch (err) { callback(null, err); }
    });
    req.on('error', function (err) {
      if (!called) { called = true; callback(null, err); }
    });
  }

  // ── Host adapter for instances ──
  // Instances created via the API use this host, which persists
  // snapshots back to storage on every transition.
  function createHost() {
    return {
      now: function () { return Date.now(); },
      scheduleAfter: function (ms, callback) { return setTimeout(callback, ms); },
      scheduleEvery: function (ms, callback) { return setInterval(callback, ms); },
      cancelTimer: function (id) { clearTimeout(id); clearInterval(id); },
      emit: function () {},
      persist: function (snapshot) {
        storage.putInstance(snapshot);
      },
      log: function () {},
      capabilities: []
    };
  }

  // ── Request handler ──
  var server = http.createServer(function (req, res) {
    var urlPath = req.url.split('?')[0];
    var method = req.method;
    var params;

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-MN-Target, X-MN-Machine'
      });
      res.end();
      return;
    }

    // ── GET /definitions ──
    if ((params = match(method, urlPath, { method: 'GET', path: '/definitions' }))) {
      return json(res, 200, { definitions: storage.listDefinitions() });
    }

    // ── GET /definitions/:id ──
    if ((params = match(method, urlPath, { method: 'GET', path: '/definitions/:id' }))) {
      var def = storage.getDefinition(params.id);
      if (!def) return json(res, 404, { error: 'Definition not found: ' + params.id });
      return json(res, 200, {
        id: def.id,
        initial: def.initial,
        states: def.stateNames,
        context: def.context,
        definition: def.states
      });
    }

    // ── POST /definitions/:id/validate ──
    if ((params = match(method, urlPath, { method: 'POST', path: '/definitions/:id/validate' }))) {
      var def = storage.getDefinition(params.id);
      if (!def) return json(res, 404, { error: 'Definition not found: ' + params.id });
      var issues = machine.validate(def);
      return json(res, 200, { id: params.id, valid: issues.length === 0, issues: issues });
    }

    // ── POST /instances ──
    if ((params = match(method, urlPath, { method: 'POST', path: '/instances' }))) {
      return readBody(req, function (body, parseErr) {
        if (parseErr) return json(res, 400, { error: 'Invalid JSON: ' + parseErr.message });
        if (!body.definition) return json(res, 400, { error: 'Missing "definition" field' });

        var def = storage.getDefinition(body.definition);
        if (!def) return json(res, 404, { error: 'Definition not found: ' + body.definition });

        var instanceId = body.id || def.id + '_' + Date.now();
        if (storage.getInstance(instanceId)) {
          return json(res, 409, { error: 'Instance already exists: ' + instanceId });
        }

        var inst = machine.createInstance(def, {
          id: instanceId,
          context: body.context || {},
          host: createHost()
        });
        storage.putInstance(inst);

        var info = machine.inspect(inst);
        return json(res, 201, {
          id: inst.id,
          definitionId: inst.definitionId,
          state: info.state,
          context: info.context,
          enabled: info.enabled.map(function (transition) { return transition.event; }),
          isFinal: info.isFinal
        });
      });
    }

    // ── GET /instances ──
    if ((params = match(method, urlPath, { method: 'GET', path: '/instances' }))) {
      return json(res, 200, { instances: storage.listInstances() });
    }

    // ── GET /instances/:id ──
    if ((params = match(method, urlPath, { method: 'GET', path: '/instances/:id' }))) {
      var inst = storage.getInstance(params.id);
      if (!inst) return json(res, 404, { error: 'Instance not found: ' + params.id });
      var info = machine.inspect(inst);
      return json(res, 200, {
        id: info.id,
        definitionId: info.definitionId,
        state: info.state,
        context: info.context,
        enabled: info.enabled.map(function (t) { return t.event; }),
        isFinal: info.isFinal
      });
    }

    // ── GET /instances/:id/history ──
    if ((params = match(method, urlPath, { method: 'GET', path: '/instances/:id/history' }))) {
      var inst = storage.getInstance(params.id);
      if (!inst) return json(res, 404, { error: 'Instance not found: ' + params.id });
      return json(res, 200, { id: params.id, history: inst.history });
    }

    // ── GET /instances/:id/snapshot ──
    if ((params = match(method, urlPath, { method: 'GET', path: '/instances/:id/snapshot' }))) {
      var inst = storage.getInstance(params.id);
      if (!inst) return json(res, 404, { error: 'Instance not found: ' + params.id });
      return json(res, 200, machine.snapshot(inst));
    }

    // ── POST /instances/:id/events/:event ──
    if ((params = match(method, urlPath, { method: 'POST', path: '/instances/:id/events/:event' }))) {
      var inst = storage.getInstance(params.id);
      if (!inst) return json(res, 404, { error: 'Instance not found: ' + params.id });

      return readBody(req, function (body, parseErr) {
        if (parseErr) return json(res, 400, { error: 'Invalid JSON: ' + parseErr.message });
        var eventData = body && body.data ? body.data : null;
        var result = machine.sendEvent(inst, params.event, eventData);
        storage.putInstance(inst);

        // ── Dispatch effects to registered adapters ──
        // Effects are async — resolve each one and re-inject success/error
        // events back into the machine. The HTTP response returns immediately
        // with the transition result; effects resolve in the background.
        var effectResults = [];
        if (result.effects && result.effects.length > 0) {
          for (var ei = 0; ei < result.effects.length; ei++) {
            (function (effect) {
              var type = effect.type;
              var adapter = effects[type];
              if (!adapter) {
                console.warn('[mn-server] no effect adapter for "' + type + '"');
                effectResults.push({ type: type, status: 'no-adapter' });
                return;
              }

              // Execute adapter async — re-inject result events
              try {
                var adapterResult = adapter(effect.input, JSON.parse(JSON.stringify(inst.context)));
                // Handle both sync and async adapters
                if (adapterResult && typeof adapterResult.then === 'function') {
                  adapterResult.then(function (value) {
                    if (effect.bind) inst.context[effect.bind] = value;
                    if (effect['on-success']) {
                      machine.sendEvent(inst, effect['on-success'], value);
                      storage.putInstance(inst);
                    }
                  }).catch(function (err) {
                    if (effect.bind) inst.context[effect.bind] = err && err.message ? err.message : String(err);
                    if (effect['on-error']) {
                      machine.sendEvent(inst, effect['on-error'], { error: String(err) });
                      storage.putInstance(inst);
                    } else {
                      console.warn('[mn-server] effect "' + type + '" failed:', err);
                    }
                  });
                  effectResults.push({ type: type, status: 'dispatched' });
                } else {
                  // Sync adapter
                  if (effect.bind) inst.context[effect.bind] = adapterResult;
                  if (effect['on-success']) {
                    machine.sendEvent(inst, effect['on-success'], adapterResult);
                    storage.putInstance(inst);
                  }
                  effectResults.push({ type: type, status: 'resolved', value: adapterResult });
                }
              } catch (err) {
                if (effect.bind) inst.context[effect.bind] = err && err.message ? err.message : String(err);
                if (effect['on-error']) {
                  machine.sendEvent(inst, effect['on-error'], { error: String(err) });
                  storage.putInstance(inst);
                } else {
                  console.warn('[mn-server] effect "' + type + '" failed:', err);
                }
                effectResults.push({ type: type, status: 'error', error: String(err) });
              }
            })(result.effects[ei]);
          }
        }

        return json(res, 200, {
          id: inst.id,
          event: result.event,
          transitioned: result.transitioned,
          targetless: result.targetless || false,
          from: result.from,
          to: result.to,
          reason: result.reason,
          changed: result.changed,
          emits: result.emits,
          effects: effectResults,
          enabled: result.enabled,
          isFinal: result.isFinal,
          context: inst.context
        });
      });
    }

    // ── 404 ──
    json(res, 404, { error: 'Not found: ' + method + ' ' + urlPath });
  });

  server.listen(port, function () {
    console.log('[mn-server] machine_native backend running on http://localhost:' + port);
    console.log('[mn-server] endpoints:');
    console.log('  GET  /definitions');
    console.log('  GET  /definitions/:id');
    console.log('  POST /definitions/:id/validate');
    console.log('  POST /instances');
    console.log('  GET  /instances');
    console.log('  GET  /instances/:id');
    console.log('  GET  /instances/:id/history');
    console.log('  GET  /instances/:id/snapshot');
    console.log('  POST /instances/:id/events/:event');
  });

  return server;
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  CLI entry point                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

if (require.main === module) {
  var args = process.argv.slice(2);
  var port = 4000;
  var machinesDir = path.join(__dirname, 'machines');

  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[i + 1], 10);
    if (args[i] === '--machines' && args[i + 1]) machinesDir = path.resolve(args[i + 1]);
  }

  createServer({ port: port, machinesDir: machinesDir });
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Module exports                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

module.exports = {
  createServer: createServer,
  createMemoryStorage: createMemoryStorage,
  loadDefinitions: loadDefinitions
};
