/**
 * machine_native application server.
 *
 * GENERIC — copy this to any new app. Never touch it.
 *
 * One endpoint: POST /api/machine (fire and forget, 202 accepted).
 * One receive channel: GET /sse/:sessionId (server pushes results).
 * One persistence layer: SQLite via db.js.
 *
 * The server is dumb infrastructure. It wires up adapters, runs pipelines,
 * stores blocked machines, and pushes results. Zero business logic.
 *
 * Run: node examples/purchase-order/server.js
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var transforms = require('../../mn/transforms');
var services = require('./services');
var db = require('./db');

var PORT = process.env.PORT || 4000;
var REGISTRY = process.env.REGISTRY || 'http://localhost:3100';
var ROOT = path.join(__dirname, '..', '..');

// ── SSE connections ─────────────────────────────────────────────
var sseClients = {};


// ── Register with the capability registry on startup ────────────
function registerWithRegistry() {
  var reg = JSON.stringify({
    id: 'app-server',
    capabilities: services.capabilities,
    transport: { type: 'http-post', address: 'http://localhost:' + PORT + '/api/machine' }
  });

  var url = new URL(REGISTRY + '/register');
  var req = http.request({
    hostname: url.hostname, port: url.port, path: '/register',
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reg) }
  }, function (res) {
    var body = '';
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      console.log('[registry] registered: ' + body);
    });
  });
  req.on('error', function (err) {
    console.log('[registry] not available — running without registry (' + err.message + ')');
  });
  req.write(reg);
  req.end();
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Helpers                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var types = {
  '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.scxml': 'application/xml', '.mn.html': 'text/html'
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  HTTP server                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var server = http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MN-Session');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }


  // ── Test utility: reset database ──────────────────────────────
  if (req.method === 'POST' && urlPath === '/api/reset') {
    db.reset();
    sendJson(res, 200, { reset: true });
    return;
  }


  // ── GET /sse/:sessionId — browser connects here ───────────────
  var sseMatch = urlPath.match(/^\/sse\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'GET' && sseMatch) {
    var sessionId = sseMatch[1];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(':ok\n\n');
    sseClients[sessionId] = res;
    console.log('[sse] connected: ' + sessionId);
    req.on('close', function () {
      delete sseClients[sessionId];
      console.log('[sse] disconnected: ' + sessionId);
    });
    return;
  }


  // ── POST /api/machine — fire and forget ─────────────────────────
  if (req.method === 'POST' && urlPath === '/api/machine') {
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      var sourceSession = req.headers['x-mn-session'] || null;
      console.log('\n  Pipeline: received (' + body.length + ' bytes) from ' + (sourceSession || 'unknown'));

      // 202 — accepted, processing async
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted: true }));

      // Execute pipeline
      services.executeAsync(body)
        .then(function (result) {
          // Pipeline blocked (route signal) — snapshot the machine
          if (result.route) {
            var blockedMachine = transforms.extractMachine(result.scxml);
            var blockedId = db.insert(blockedMachine.name, blockedMachine.state, result.scxml);
            console.log('  Blocked — stored as ' + blockedId);
          }

          // Push result to sender via SSE
          if (sourceSession && sseClients[sourceSession] && !sseClients[sourceSession].destroyed) {
            var encoded = Buffer.from(result.scxml).toString('base64');
            sseClients[sourceSession].write('event: machine\ndata: ' + encoded + '\n\n');
            console.log('  Pushed to ' + sourceSession);
          }
        })
        .catch(function (err) {
          console.error('[server]', err.message);
          if (sourceSession && sseClients[sourceSession] && !sseClients[sourceSession].destroyed) {
            var errScxml = '<?xml version="1.0"?><scxml id="error" initial="error" mn-ctx=\'' +
              JSON.stringify({ $error: err.message }).replace(/'/g, '&apos;') + '\'><final id="error"/></scxml>';
            var encoded = Buffer.from(errScxml).toString('base64');
            sseClients[sourceSession].write('event: machine\ndata: ' + encoded + '\n\n');
          }
        });
    });
    return;
  }


  // ── Static files + SPA fallback ───────────────────────────────
  if (urlPath === '/') urlPath = '/examples/purchase-order/index.html';

  var filePath = path.join(ROOT, urlPath);
  var resolvedRoot = path.resolve(ROOT);
  var resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  var ext = path.extname(urlPath);
  if (!ext && !urlPath.startsWith('/api/')) {
    var indexPath = path.join(ROOT, 'examples', 'purchase-order', 'index.html');
    fs.readFile(indexPath, function (err, fileData) {
      if (err) { res.writeHead(500); res.end('Server error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fileData);
    });
    return;
  }

  fs.readFile(filePath, function (err, fileData) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(fileData);
  });
});

server.listen(PORT, function () {
  console.log('\n  machine_native application server');
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  POST /api/machine  — fire and forget (202)');
  console.log('  GET  /sse/:id      — browser receive channel');
  console.log('  POST /api/reset    — clear database');
  console.log('  Capabilities: ' + services.capabilities.join(', '));
  console.log('  Database: ' + (process.env.DB_PATH || 'app.db'));
  console.log('  Registry: ' + REGISTRY + '\n');
  registerWithRegistry();
});
