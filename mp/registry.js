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

var PORT = parseInt(process.env.REGISTRY_PORT, 10) || 3100;

// ── Boot the registry machine from its SCXML definition ──────────
var registryPath = path.join(__dirname, 'machines', 'registry.scxml');
var registryScxml;
try { registryScxml = fs.readFileSync(registryPath, 'utf8'); }
catch (err) { console.error('[registry] cannot read ' + registryPath + ': ' + err.message); process.exit(1); }
var registryDef = scxml.compile(registryScxml, {});
var registry = machine.createInstance(registryDef);

console.log('[registry] machine booted — state: ' + registry.state);


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  HTTP server                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

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
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      try {
        var data = JSON.parse(body);

        // Set context fields, then send event — same as the browser pattern
        registry.context.id = data.id || null;
        registry.context.address = data.address || null;
        registry.context.capabilities = data.capabilities || null;
        registry.context.formats = data.formats || null;

        var result = machine.sendEvent(registry, 'register');

        if (result.transitioned) {
          console.log('[registry] registered: ' + data.id + ' at ' + data.address + ' caps=' + (data.capabilities || []).join(','));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ registered: true, nodes: registry.context.nodes.length }));
        } else {
          console.log('[registry] rejected: ' + data.id + ' — ' + result.reason);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ registered: false, reason: result.reason }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }


  // ── POST /deregister — remove a node ──────────────────────────────
  if (req.method === 'POST' && urlPath === '/deregister') {
    var deregBody = '';
    req.on('data', function (chunk) { deregBody += chunk; });
    req.on('end', function () {
      try {
        var data = JSON.parse(deregBody);
        registry.context.id = data.id || null;

        var result = machine.sendEvent(registry, 'deregister');
        console.log('[registry] deregistered: ' + data.id);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deregistered: true, nodes: registry.context.nodes.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }


  // ── 404 ───────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, function () {
  console.log('\n  machine_perfect — Capability Registry');
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  POST /register    — register a node');
  console.log('  POST /deregister  — remove a node');
  console.log('  GET  /routes      — the route table\n');
});
