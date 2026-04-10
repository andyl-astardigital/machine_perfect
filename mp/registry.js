/**
 * machine_perfect — capability registry server.
 *
 * The registry is a machine. Nodes register by sending events.
 * Lookups query the machine's context. The route table IS the
 * machine state.
 *
 * Endpoints:
 *   POST /register  — register a node (set context, send event)
 *   POST /deregister — remove a node
 *   GET  /routes    — the route table (registry machine context)
 *
 * Run: node mp/registry.js
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var scxml = require('./scxml');
var machine = require('./machine');

var MAX_BODY_SIZE = 65536; // 64KB — sufficient for any registration payload

var REGISTRY_SCXML_PATH = path.join(__dirname, 'machines', 'registry.scxml');


function readBody(req, callback) {
  var body = '';
  var called = false;
  req.on('data', function (chunk) {
    body += chunk;
    if (body.length > MAX_BODY_SIZE && !called) {
      called = true;
      req.destroy();
      callback(null, new Error('Body exceeds 64KB limit'));
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


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Server factory                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function createServer(options) {
  options = options || {};
  var port = options.port || parseInt(process.env.REGISTRY_PORT, 10) || 3100;
  var scxmlPath = options.scxmlPath || REGISTRY_SCXML_PATH;

  var registryScxml;
  try { registryScxml = fs.readFileSync(scxmlPath, 'utf8'); }
  catch (err) { throw new Error('[registry] cannot read ' + scxmlPath + ': ' + err.message); }

  var registryDef = scxml.compile(registryScxml, {});
  var registry = machine.createInstance(registryDef);

  console.log('[registry] machine booted — state: ' + registry.state);

  var server = http.createServer(function (req, res) {
    var urlPath = req.url.split('?')[0];

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }


    // ── GET /routes — the route table ─────────────────────────────────
    // Returns the registry machine's nodes array.
    // Every node in the system fetches this to know where to route.
    if (req.method === 'GET' && urlPath === '/routes') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(registry.context.nodes));
      return;
    }


    // ── POST /register — register a node ──────────────────────────────
    if (req.method === 'POST' && urlPath === '/register') {
      readBody(req, function (data, parseErr) {
        if (parseErr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: parseErr.message }));
          return;
        }

        // Set context fields, then send event — same as the browser pattern
        registry.context.id = data.id || null;
        registry.context.address = data.address || null;
        registry.context.capabilities = data.capabilities || null;
        registry.context.formats = data.formats || null;

        var result = machine.sendEvent(registry, 'register');

        // register is a targetless transition — check targetless, not transitioned
        if (result.transitioned || result.targetless) {
          console.log('[registry] registered: ' + data.id + ' at ' + data.address + ' caps=' + (data.capabilities || []).join(','));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ registered: true, nodes: registry.context.nodes.length }));
        } else {
          console.log('[registry] rejected: ' + data.id + ' — ' + result.reason);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ registered: false, reason: result.reason }));
        }
      });
      return;
    }


    // ── POST /deregister — remove a node ──────────────────────────────
    if (req.method === 'POST' && urlPath === '/deregister') {
      readBody(req, function (data, parseErr) {
        if (parseErr) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: parseErr.message }));
          return;
        }

        registry.context.id = data.id || null;
        var result = machine.sendEvent(registry, 'deregister');

        // deregister is targetless — guard must pass for it to fire
        if (result.transitioned || result.targetless) {
          console.log('[registry] deregistered: ' + data.id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ deregistered: true, nodes: registry.context.nodes.length }));
        } else {
          console.log('[registry] deregister failed: ' + data.id + ' — ' + result.reason);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ deregistered: false, reason: result.reason }));
        }
      });
      return;
    }


    // ── 404 ───────────────────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, function () {
    console.log('\n  machine_perfect — Capability Registry');
    console.log('  http://localhost:' + port);
    console.log('');
    console.log('  POST /register    — register a node');
    console.log('  POST /deregister  — remove a node');
    console.log('  GET  /routes      — the route table\n');
  });

  return server;
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  CLI entry point                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

if (require.main === module) {
  createServer();
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Module exports                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

module.exports = { createServer: createServer };
