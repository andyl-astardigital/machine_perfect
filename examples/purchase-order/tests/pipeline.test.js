/**
 * Purchase order pipeline — fire-and-forget + SSE tests.
 *
 * Every machine is sent via POST (202 accepted). Results arrive via SSE.
 * The machine IS the transport.
 *
 * Run: node --test examples/purchase-order/tests/pipeline.test.js
 * Requires server running on port 4000.
 */

var test = require('node:test');
var assert = require('node:assert');
var http = require('http');
var fs = require('fs');
var path = require('path');
var transforms = require('../../../mn/transforms');

var PORT = parseInt(process.env.PORT, 10) || 4000;
var SESSION_COUNTER = 0;


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Helpers                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

function uniqueSession() { return 'pipeline-' + (++SESSION_COUNTER) + '-' + Date.now(); }

function post(urlPath, body, sessionId) {
  return new Promise(function (resolve, reject) {
    var headers = { 'Content-Type': 'application/xml' };
    if (sessionId) headers['X-MN-Session'] = sessionId;
    var data = '';
    var req = http.request({ hostname: 'localhost', port: PORT, path: urlPath, method: 'POST', headers: headers }, function (res) {
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function connectSSE(sessionId) {
  return new Promise(function (resolve, reject) {
    var req = http.get({ hostname: 'localhost', port: PORT, path: '/sse/' + sessionId }, function (res) {
      resolve(res);
    });
    req.on('error', reject);
  });
}

function waitForMachine(sseRes, timeout) {
  return new Promise(function (resolve, reject) {
    var buf = '';
    var timer = setTimeout(function () {
      sseRes.removeAllListeners('data');
      reject(new Error('SSE timeout after ' + (timeout || 10000) + 'ms'));
    }, timeout || 10000);
    var onData = function (chunk) {
      buf += chunk.toString();
      var eventIdx = buf.indexOf('event: machine');
      if (eventIdx !== -1) {
        var endIdx = buf.indexOf('\n\n', eventIdx);
        if (endIdx !== -1) {
          clearTimeout(timer);
          sseRes.removeListener('data', onData);
          var eventBlock = buf.substring(eventIdx, endIdx);
          var dataLine = eventBlock.split('\n').find(function (l) { return l.indexOf('data: ') === 0; });
          var decoded = Buffer.from(dataLine.replace('data: ', ''), 'base64').toString();
          resolve(decoded);
        }
      }
    };
    sseRes.on('data', onData);
  });
}

// Connect SSE, skip :ok, return { res, waitForMachine }
async function openSession(sessionId) {
  var res = await connectSSE(sessionId);
  await new Promise(function (r) { res.once('data', r); }); // skip :ok
  return {
    res: res,
    wait: function (timeout) { return waitForMachine(res, timeout); },
    close: function () { res.destroy(); }
  };
}

function resetOrders() { return post('/api/reset', '<scxml/>'); }

function buildPipelineScxml(title, amount, items) {
  var fileSrc = fs.readFileSync(path.join(__dirname, '..', 'machines', 'purchase-order.scxml'), 'utf8');
  var fromSubmitted = fileSrc.replace('initial="draft"', 'initial="submitted"');
  var ctx = JSON.stringify({
    title: title, amount: amount, items: items,
    newItem: '', notes: '', urgent: false,
    submitted_at: Date.now(), approved_at: null
  }).replace(/'/g, '&apos;');
  return fromSubmitted.replace(/mn-ctx='[^']*'/, "mn-ctx='" + ctx + "'");
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Security                                                               ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('path traversal → 403', async function () {
  var res = await post('/%2e%2e/package.json');
  assert.strictEqual(res.status, 403);
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Fire-and-forget POST returns 202                                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('POST /api/machine returns 202 accepted', async function () {
  var scxml = buildPipelineScxml('Test', 100, [{ name: 'Pen', qty: 1 }]);
  var res = await post('/api/machine', scxml, 'test-202');
  assert.strictEqual(res.status, 202);
  assert.strictEqual(JSON.parse(res.body).accepted, true);
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Happy path — £750 → fulfilled via SSE                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('happy path: £750 order → fulfilled result arrives via SSE', async function () {
  await resetOrders();
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = buildPipelineScxml('Laptop Stand', 750, [{ name: 'Stand', qty: 1 }, { name: 'Cable Tidy', qty: 3 }]);
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  var machine = transforms.extractMachine(result);
  assert.strictEqual(machine.state, 'fulfilled', 'reached fulfilled');
  var ctx = transforms.extractContext(result);
  assert.strictEqual(ctx.title, 'Laptop Stand');
  assert.strictEqual(ctx.amount, 750);
  assert.strictEqual(typeof ctx.submitted_at, 'number');
  assert.strictEqual(typeof ctx.approved_at, 'number');

  sse.close();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Rejection — £150k → rejected via SSE                                   ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('rejection: £150k order → rejected result via SSE', async function () {
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = buildPipelineScxml('Expensive', 150000, [{ name: 'Gold', qty: 1 }]);
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  var machine = transforms.extractMachine(result);
  assert.strictEqual(machine.state, 'rejected');
  assert.strictEqual(transforms.extractContext(result).title, 'Expensive');

  sse.close();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Guard rejection — empty title stays in draft                           ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('guard rejection: empty title → blocked in draft via SSE', async function () {
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var ctx = JSON.stringify({
    title: '', amount: 500, items: [{ name: 'Pen', qty: 1 }],
    newItem: '', notes: '', urgent: false, submitted_at: null, approved_at: null
  }).replace(/'/g, '&apos;');
  var fileSrc = fs.readFileSync(path.join(__dirname, '..', 'machines', 'purchase-order.scxml'), 'utf8');
  var scxml = fileSrc.replace(/mn-ctx='[^']*'/, "mn-ctx='" + ctx + "'");

  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  assert.strictEqual(transforms.extractMachine(result).state, 'draft', 'stays in draft');

  sse.close();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Data fetch — order-list machine                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('data: order-list returns invokes and _invokeCounts via SSE', async function () {
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = fs.readFileSync(path.join(__dirname, '..', 'machines', 'order-list.scxml'), 'utf8');
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  var ctx = transforms.extractContext(result);
  assert.strictEqual(typeof ctx._invokeCounts, 'object', 'has _invokeCounts');
  assert.strictEqual(ctx._invokeCounts.total >= 0, true, 'total is a number');
  assert.strictEqual(result.indexOf('<invoke') !== -1 || ctx._invokeCounts.total === 0, true, 'has invokes or zero total');

  sse.close();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Reset                                                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('reset clears all machines', async function () {
  await resetOrders();

  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = fs.readFileSync(path.join(__dirname, '..', 'machines', 'order-list.scxml'), 'utf8');
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  var ctx = transforms.extractContext(result);
  assert.strictEqual(ctx._invokeCounts.total, 0, 'no machines after reset');
  assert.strictEqual(result.indexOf('<content>') === -1, true, 'no embedded machine content');

  sse.close();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SPA fallback                                                           ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('SPA fallback: /orders serves index.html', async function () {
  var res = await new Promise(function (resolve, reject) {
    http.get({ hostname: 'localhost', port: PORT, path: '/orders' }, function (res) {
      var d = ''; res.on('data', function (c) { d += c; }); res.on('end', function () { resolve({ status: res.statusCode, body: d }); });
    }).on('error', reject);
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.indexOf('Purchase Orders') !== -1, true);
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Three-tier: auto-approve £750                                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('three-tier: £750 auto-approve → fulfilled + persisted', async function () {
  await resetOrders();
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = buildPipelineScxml('Auto', 750, [{ name: 'Pen', qty: 1 }]);
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  assert.strictEqual(transforms.extractMachine(result).state, 'fulfilled');

  // Fetch order-list to verify persisted machine appears as invoke
  var sid2 = uniqueSession();
  var sse2 = await openSession(sid2);
  var listScxml = fs.readFileSync(path.join(__dirname, '..', 'machines', 'order-list.scxml'), 'utf8');
  var listPromise = sse2.wait();
  await post('/api/machine', listScxml, sid2);
  var listResult = await listPromise;
  var listCtx = transforms.extractContext(listResult);
  assert.strictEqual(listCtx._invokeCounts.total, 1, 'one machine persisted');
  assert.strictEqual(listCtx._invokeCounts.byState.fulfilled, 1, 'one fulfilled');
  assert.strictEqual(listResult.indexOf('<invoke') !== -1, true, 'response has invoke element');
  assert.strictEqual(listResult.indexOf('Auto') !== -1, true, 'invoke contains order title');

  sse.close();
  sse2.close();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Three-tier: £75k blocks at director-approval                           ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('three-tier: £75k blocks at director-approval', async function () {
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = buildPipelineScxml('Director', 75000, [{ name: 'Server', qty: 1 }]);
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  assert.strictEqual(transforms.extractMachine(result).state, 'director-approval');
  assert.strictEqual(transforms.extractContext(result).title, 'Director');

  sse.close();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Three-tier: £150k rejected                                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('three-tier: £150k → rejected + persisted', async function () {
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = buildPipelineScxml('Expensive', 150000, [{ name: 'Gold', qty: 1 }]);
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  assert.strictEqual(transforms.extractMachine(result).state, 'rejected');

  // Fetch order-list to verify persisted rejected machine
  var sid2 = uniqueSession();
  var sse2 = await openSession(sid2);
  var listScxml = fs.readFileSync(path.join(__dirname, '..', 'machines', 'order-list.scxml'), 'utf8');
  var listPromise = sse2.wait();
  await post('/api/machine', listScxml, sid2);
  var listResult = await listPromise;
  assert.strictEqual(listResult.indexOf('Expensive') !== -1, true, 'invoke contains rejected order title');
  var listCtx = transforms.extractContext(listResult);
  assert.strictEqual(listCtx._invokeCounts.byState.rejected >= 1, true, 'at least one rejected');

  sse.close();
  sse2.close();
});
