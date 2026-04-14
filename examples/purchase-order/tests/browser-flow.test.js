/**
 * Browser submit flow — fire-and-forget + SSE.
 *
 * Simulates what the browser does: POST machine, receive result via SSE.
 * Tests the SCXML wire format round-trip through the transport layer.
 *
 * Run: node --test examples/purchase-order/tests/browser-flow.test.js
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

function uniqueSession() { return 'flow-' + (++SESSION_COUNTER) + '-' + Date.now(); }

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

function openSession(sessionId) {
  return new Promise(function (resolve, reject) {
    http.get({ hostname: 'localhost', port: PORT, path: '/sse/' + sessionId }, function (res) {
      // Skip :ok
      res.once('data', function () {
        resolve({
          res: res,
          wait: function (timeout) {
            return new Promise(function (resolve2, reject2) {
              var buf = '';
              var timer = setTimeout(function () { reject2(new Error('SSE timeout')); }, timeout || 10000);
              var onData = function (chunk) {
                buf += chunk.toString();
                if (buf.indexOf('event: machine') !== -1 && buf.indexOf('\n\n', buf.indexOf('event: machine')) !== -1) {
                  clearTimeout(timer);
                  res.removeListener('data', onData);
                  var dataLine = buf.split('\n').find(function (l) { return l.indexOf('data: ') === 0; });
                  resolve2(Buffer.from(dataLine.replace('data: ', ''), 'base64').toString());
                }
              };
              res.on('data', onData);
            });
          },
          close: function () { res.destroy(); }
        });
      });
    }).on('error', reject);
  });
}

function resetOrders() { return post('/api/reset', '<scxml/>'); }

function buildPurchaseOrderScxml(title, amount, items, state) {
  var scxmlTemplate = fs.readFileSync(path.join(__dirname, '..', 'machines', 'purchase-order.scxml'), 'utf8');
  var ctx = { title: title, amount: amount, items: items, newItem: '', notes: '', urgent: false, submitted_at: Date.now(), approved_at: null };
  return transforms.updateScxmlState(scxmlTemplate, state || 'submitted', ctx);
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Auto-approve path                                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('auto-approve: £750 → fulfilled via SSE', async function () {
  await resetOrders();
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = buildPurchaseOrderScxml('Browser Flow Order', 750, [{ name: 'Pens', qty: 3 }, { name: 'Paper', qty: 10 }]);
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  var machine = transforms.extractMachine(result);
  assert.strictEqual(machine.state, 'fulfilled');
  var ctx = transforms.extractContext(result);
  assert.strictEqual(ctx.title, 'Browser Flow Order');
  assert.strictEqual(ctx.amount, 750);
  assert.strictEqual(typeof ctx.approved_at, 'number');

  sse.close();
});

test('auto-approve: order persisted as invoke in order-list', async function () {
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var listScxml = fs.readFileSync(path.join(__dirname, '..', 'machines', 'order-list.scxml'), 'utf8');
  var resultPromise = sse.wait();
  await post('/api/machine', listScxml, sid);

  var result = await resultPromise;
  var ctx = transforms.extractContext(result);
  assert.strictEqual(ctx._invokeCounts.total, 1, 'one machine persisted');
  assert.strictEqual(result.indexOf('Browser Flow Order') !== -1, true, 'invoke has order title');
  assert.strictEqual(result.indexOf('<invoke') !== -1, true, 'response has invoke');

  sse.close();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Rejection path                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('rejection: £150k → rejected via SSE', async function () {
  await resetOrders();
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = buildPurchaseOrderScxml('Expensive Equipment', 150000, [{ name: 'Industrial Robot', qty: 1 }]);
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  assert.strictEqual(transforms.extractMachine(result).state, 'rejected');

  sse.close();
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Director escalation                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('director: £75k blocks at director-approval via SSE', async function () {
  await resetOrders();
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = buildPurchaseOrderScxml('Mid-range', 75000, [{ name: 'CNC Machine', qty: 1 }]);
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  assert.strictEqual(transforms.extractMachine(result).state, 'director-approval');
  assert.strictEqual(transforms.extractContext(result).title, 'Mid-range');

  sse.close();
});

test('director: approved state sent to server → fulfilled via SSE', async function () {
  var sid = uniqueSession();
  var sse = await openSession(sid);

  var scxml = buildPurchaseOrderScxml('Mid-range Approved', 75000, [{ name: 'CNC Machine', qty: 1 }], 'approved');
  var resultPromise = sse.wait();
  await post('/api/machine', scxml, sid);

  var result = await resultPromise;
  assert.strictEqual(transforms.extractMachine(result).state, 'fulfilled');

  sse.close();
});
