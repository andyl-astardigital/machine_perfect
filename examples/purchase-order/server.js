/**
 * Purchase order — example server.
 *
 * SCXML is the canonical machine format. HTML is the browser substrate.
 *
 * The pipeline endpoint speaks SCXML:
 *   - Browser transforms HTML → SCXML at the edge, sends SCXML
 *   - Server receives SCXML, pipes through services, returns SCXML
 *   - Browser receives SCXML, transforms → HTML, renders
 *
 * UI endpoints serve HTML (order list, stats, create form, detail).
 * These are browser rendering concerns, not distributed machines.
 *
 * Run: node examples/purchase-order/server.js
 */

var http = require('http');
var fs = require('fs');
var path = require('path');
var ejs = require('ejs');
var transforms = require('../../mn/transforms');
var services = require('./services');

var PORT = process.env.PORT || 4000;
var REGISTRY = process.env.REGISTRY || 'http://localhost:3100';
var ROOT = path.join(__dirname, '..', '..');
var VIEWS = path.join(__dirname, 'views');

// ── In-memory order storage (pluggable to any DB via adapter pattern) ──
var orders = [];
services.setStorage(orders);

// ── Register with the capability registry on startup ────────────────
function registerWithRegistry() {
  var data = JSON.stringify({
    id: 'po-server',
    address: 'http://localhost:' + PORT,
    capabilities: ['log', 'notify', 'persist', 'fulfil', 'ui-render'],
    formats: ['html', 'scxml']
  });

  var url = new URL(REGISTRY + '/register');
  var req = http.request({
    hostname: url.hostname, port: url.port, path: '/register',
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
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
  req.write(data);
  req.end();
}

var types = {
  '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.xslt': 'application/xml', '.mn.html': 'text/html'
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Helpers                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(view, data) {
  var file = path.join(VIEWS, view + '.ejs');
  return ejs.renderFile(file, data || {}, { views: [VIEWS] });
}

function sendHtml(res, viewPromise) {
  viewPromise
    .then(function (html) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    })
    .catch(function (err) {
      console.error('[render]', err.message);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<div class="alert alert-error"><span>Render error: ' + escHtml(err.message) + '</span></div>');
    });
}

function sendScxml(res, scxml) {
  res.writeHead(200, { 'Content-Type': 'application/xml' });
  res.end(scxml);
}

function buildStats() {
  var total = orders.length;
  var fulfilled = orders.filter(function (o) { return o.status === 'fulfilled'; }).length;
  var rejected = orders.filter(function (o) { return o.status === 'rejected'; }).length;
  var totalValue = orders.reduce(function (sum, o) { return sum + o.amount; }, 0);
  return {
    total: total, fulfilled: fulfilled, rejected: rejected,
    totalValue: totalValue, avgValue: total > 0 ? Math.round(totalValue / total) : 0,
    lastUpdated: Date.now()
  };
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  HTTP server                                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

var server = http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }


  // ── UI endpoints — server-rendered HTML (browser rendering concern) ───

  if (req.method === 'GET' && urlPath === '/api/stats') {
    sendHtml(res, render('stats', { stats: buildStats() }));
    return;
  }

  if (req.method === 'GET' && urlPath === '/api/orders') {
    sendHtml(res, render('order-list', { orders: orders }));
    return;
  }

  if (req.method === 'GET' && urlPath === '/api/orders/new') {
    sendHtml(res, render('create-form'));
    return;
  }

  if (req.method === 'GET' && urlPath.match(/^\/api\/orders\/po-/)) {
    var viewId = urlPath.split('/api/orders/')[1];
    var order = orders.find(function (o) { return o.id === viewId; });
    if (!order) { sendHtml(res, render('not-found')); return; }
    sendHtml(res, render('order-detail', { order: order }));
    return;
  }

  if (req.method === 'DELETE' && urlPath.indexOf('/api/orders/') === 0) {
    var deleteId = urlPath.split('/api/orders/')[1];
    var idx = orders.findIndex(function (o) { return o.id === deleteId; });
    if (idx !== -1) orders.splice(idx, 1);
    sendHtml(res, render('order-list', { orders: orders }));
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/orders/reset') {
    orders.length = 0;
    sendHtml(res, render('order-list', { orders: orders }));
    return;
  }


  // ── POST /api/machine ────────────────────────────────────────────────
  //
  // Dispatches by X-MN-Machine header:
  //   app             → UI render: render view HTML for target state
  //   purchase-order  → Pipeline: advance machine through services
  //   (other)         → Pipeline (default)

  if (req.method === 'POST' && urlPath === '/api/machine') {
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      var machineName = req.headers['x-mn-machine'];
      var targetState = req.headers['x-mn-target'];

      // ── UI render: app machine requests a view ──
      if (machineName === 'app' && targetState) {
        try {
          var ctx = transforms.extractContext(body);
          console.log('\n  UI render: ' + targetState + (ctx._action ? ' action=' + ctx._action : ''));

          if (ctx._action === 'delete' && ctx._actionId) {
            var delIdx = orders.findIndex(function (o) { return o.id === ctx._actionId; });
            if (delIdx !== -1) {
              orders.splice(delIdx, 1);
              console.log('  Deleted order: ' + ctx._actionId);
            }
          }

          if (targetState === 'orders') {
            sendHtml(res, render('order-list', { orders: orders }));
          } else if (targetState === 'create') {
            sendHtml(res, render('create-form'));
          } else if (targetState === 'detail') {
            var orderId = ctx._actionId;
            var order = orderId ? orders.find(function (o) { return o.id === orderId; }) : null;
            sendHtml(res, order ? render('order-detail', { order: order }) : render('not-found'));
          } else {
            sendHtml(res, render('order-list', { orders: orders }));
          }
        } catch (err) {
          console.error('[server]', err.message);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<div class="alert alert-error"><span>Error: ' + escHtml(err.message) + '</span></div>');
        }
        return;
      }

      // ── Pipeline execution: advance the machine through services ──
      var isHtml = body.trim().indexOf('<scxml') === -1;
      var scxmlInput;

      if (isHtml) {
        console.log('\n  Pipeline: received HTML (' + body.length + ' bytes)');
        scxmlInput = transforms.htmlToScxml(body);
      } else {
        console.log('\n  Pipeline: received SCXML (' + body.length + ' bytes)');
        scxmlInput = body;
      }

      services.executeAsync(scxmlInput)
        .then(function (result) {
          console.log('  Complete.\n');
          if (isHtml) {
            var htmlBack = transforms.scxmlToHtml(result.scxml);
            sendHtml(res, render('pipeline-result', {
              blocked: result.blocked || false,
              reason: result.reason || null,
              effects: result.effects || [],
              history: result.history || [],
              scxml: result.scxml,
              htmlBack: htmlBack
            }));
          } else {
            sendScxml(res, result.scxml);
          }
        })
        .catch(function (err) {
          console.error('[server]', err.message);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<div class="alert alert-error"><span>Error: ' + escHtml(err.message) + '</span></div>');
        });
    });
    return;
  }


  // ── Static files + SPA fallback ───────────────────────────────────
  if (urlPath === '/') urlPath = '/examples/purchase-order/index.html';

  // Prevent path traversal: reject any path that escapes ROOT
  var filePath = path.join(ROOT, urlPath);
  var resolvedRoot = path.resolve(ROOT);
  var resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  var ext = path.extname(urlPath);
  if (!ext && !urlPath.startsWith('/api/')) {
    var indexPath = path.join(ROOT, 'examples', 'purchase-order', 'index.html');
    fs.readFile(indexPath, function (err, data) {
      if (err) { res.writeHead(500); res.end('Server error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log('\n  machine_native — Purchase Order');
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  SCXML is the canonical format.');
  console.log('  Capabilities: log, notify, persist, fulfil, ui-render');
  console.log('  Registry: ' + REGISTRY + '\n');
  registerWithRegistry();
});
