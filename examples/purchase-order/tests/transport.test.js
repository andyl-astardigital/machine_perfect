/**
 * Transport tests — SSE on PO server + fire-and-forget POST.
 *
 * Tests the bidirectional transport: browser POSTs machine (fire and forget),
 * server pushes result back via SSE.
 *
 * Requires PO server running on port 4000.
 *
 * Run: node --test examples/purchase-order/tests/transport.test.js
 */

var test = require('node:test');
var assert = require('node:assert');
var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = parseInt(process.env.PORT, 10) || 4000;


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Helpers                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function post(urlPath, body, headers) {
  return new Promise(function (resolve, reject) {
    var reqHeaders = headers || {};
    if (body && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/xml';
    var data = '';
    var req = http.request({ hostname: 'localhost', port: PORT, path: urlPath, method: 'POST', headers: reqHeaders }, function (res) {
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: data, headers: res.headers }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function connectSSE(sessionId) {
  return new Promise(function (resolve, reject) {
    var req = http.get({
      hostname: 'localhost', port: PORT, path: '/sse/' + sessionId,
      headers: { 'Accept': 'text/event-stream' }
    }, function (res) {
      resolve({ res: res, status: res.statusCode, headers: res.headers });
    });
    req.on('error', reject);
  });
}

function resetOrders() {
  return post('/api/reset', '<scxml/>');
}

function waitForSSEEvent(res) {
  return new Promise(function (resolve) {
    var buf = '';
    var onData = function (chunk) {
      buf += chunk.toString();
      // Look for a complete SSE event (event: machine\ndata: ...\n\n)
      if (buf.indexOf('event: machine') !== -1 && buf.indexOf('\n\n', buf.indexOf('event: machine')) !== -1) {
        res.removeListener('data', onData);
        resolve(buf);
      }
    };
    res.on('data', onData);
  });
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SSE connection                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('SSE: server serves event-stream with correct headers', async function () {
  var sse = await connectSSE('test-headers');
  assert.strictEqual(sse.status, 200);
  assert.strictEqual(sse.headers['content-type'], 'text/event-stream');
  var first = await new Promise(function (r) { sse.res.once('data', function (c) { r(c.toString()); }); });
  assert.strictEqual(first, ':ok\n\n');
  sse.res.destroy();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Fire and forget POST                                                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('POST /api/machine returns 202 accepted', async function () {
  var scxml = fs.readFileSync(path.join(__dirname, '..', 'machines', 'order-list.scxml'), 'utf8');
  var res = await post('/api/machine', scxml, { 'X-MN-Session': 'test-202' });
  assert.strictEqual(res.status, 202);
  var body = JSON.parse(res.body);
  assert.strictEqual(body.accepted, true);
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Full round-trip: POST out, SSE back                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('round-trip: POST machine → server processes → result pushed via SSE', async function () {
  await resetOrders();

  // Connect SSE
  var sse = await connectSSE('test-roundtrip');
  await new Promise(function (r) { sse.res.once('data', r); }); // skip :ok

  // Start listening for result BEFORE posting
  var resultPromise = waitForSSEEvent(sse.res);

  // POST order-list machine (fire and forget)
  var scxml = fs.readFileSync(path.join(__dirname, '..', 'machines', 'order-list.scxml'), 'utf8');
  var postRes = await post('/api/machine', scxml, { 'X-MN-Session': 'test-roundtrip' });
  assert.strictEqual(postRes.status, 202, 'POST returns 202');

  // Wait for SSE result
  var eventData = await resultPromise;
  assert.strictEqual(eventData.indexOf('event: machine') !== -1, true, 'SSE event type is machine');

  // Decode and verify
  var dataLine = eventData.split('\n').find(function (l) { return l.indexOf('data: ') === 0; });
  var decoded = Buffer.from(dataLine.replace('data: ', ''), 'base64').toString();
  assert.strictEqual(decoded.indexOf('<scxml') !== -1, true, 'decoded is SCXML');
  assert.strictEqual(decoded.indexOf('initial="list"') !== -1, true, 'machine reached list state');

  sse.res.destroy();
});
