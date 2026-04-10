/**
 * Purchase order pipeline — hand-computed integration tests.
 *
 * Every response is HTML. Every assertion checks markup content.
 * The machine IS the transport. No JSON anywhere.
 *
 * Run: node examples/purchase-order/tests/pipeline.test.js
 * Requires server running on port 4000.
 */

var http = require('http');
var assert = require('assert');
var transforms = require('../../../mp/transforms');

var PORT = parseInt(process.env.PORT, 10) || 4000;
var passed = 0;
var failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log('  \u2713 ' + name); }
  catch (err) { failed++; console.log('  \u2717 ' + name + ' — ' + err.message); }
}

function request(method, path, body, callback) {
  var data = '';
  var headers = {};
  if (body) headers['Content-Type'] = 'text/html';
  var req = http.request({ hostname: 'localhost', port: PORT, path: path, method: method, headers: headers }, function (res) {
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function () { callback(null, res.statusCode, data); });
  });
  req.on('error', function (err) { callback(err); });
  if (body) req.write(body);
  req.end();
}

function has(html, str, msg) { assert(html.indexOf(str) !== -1, msg + ' — missing: ' + str); }
function notHas(html, str, msg) { assert(html.indexOf(str) === -1, msg + ' — should not contain: ' + str); }


// ══════════════════════════════════════════════════════════════════
//  Machine definition for pipeline tests.
//  Same structure as the create form — draft → submitted → approved → fulfilled.
// ══════════════════════════════════════════════════════════════════

function buildMachine(title, amount, items, notes) {
  return '<div mp="purchase-order" mp-ctx=\'' + JSON.stringify({
    title: title, amount: amount, items: items,
    notes: notes || '', submitted_at: null, approved_at: null
  }) + '\'>' +
    '<div mp-state="draft">' +
    '<mp-transition event="submit" to="submitted">' +
    '<mp-guard>(and (> (count items) 0) (> amount 0) (not (empty? title)))</mp-guard>' +
    '<mp-action>(do (set! submitted_at (now)) (invoke! :type \'log\' :input (str \'Order submitted: \' title \' — £\' amount)))</mp-action>' +
    '</mp-transition>' +
    '</div>' +
    '<div mp-state="submitted">' +
    '<mp-transition event="approve" to="approved">' +
    '<mp-guard>(<= amount 100000)</mp-guard>' +
    '<mp-action>(do (set! approved_at (now)) (invoke! :type \'notify\' :input (obj :to \'finance@company.com\' :subject (str \'Approved: \' title) :amount amount)))</mp-action>' +
    '<mp-emit>order-approved</mp-emit>' +
    '</mp-transition>' +
    '<mp-transition event="reject" to="rejected">' +
    '<mp-guard>(> amount 100000)</mp-guard>' +
    '<mp-action>(do (invoke! :type \'notify\' :input (obj :to \'requester@company.com\' :subject (str \'Rejected: \' title))) ' +
    '(invoke! :type \'persist\' :input (obj :title title :amount amount :items items :notes notes :status \'rejected\' :created_at submitted_at)))</mp-action>' +
    '</mp-transition>' +
    '</div>' +
    '<div mp-state="approved">' +
    '<mp-transition event="fulfil" to="fulfilled">' +
    '<mp-action>(do (invoke! :type \'fulfil\' :input (obj :title title :items items)) ' +
    '(invoke! :type \'persist\' :input (obj :title title :amount amount :items items :notes notes :created_at submitted_at)))</mp-action>' +
    '</mp-transition>' +
    '</div>' +
    '<div mp-state="fulfilled" mp-final></div>' +
    '<div mp-state="rejected" mp-final></div>' +
    '</div>';
}


console.log('\nPurchase order pipeline — hand-computed tests\n');


// ════════════════════════════════════════════════════════════════
//  Bug 22: Path traversal — escaping ROOT must return 403
// ════════════════════════════════════════════════════════════════

console.log('Bug 22 — path traversal');
// Use percent-encoded dots to bypass Node's HTTP URL normalization
request('GET', '/%2e%2e/package.json', null, function (errPT, statusPT) {
  test('path traversal → 403', function () { assert.strictEqual(statusPT, 403); });


// Reset server state
request('POST', '/api/orders/reset', '', function () {

  // ════════════════════════════════════════════════════════════════
  //  TEST 1: Happy path — £750, 2 items → approved & fulfilled
  // ════════════════════════════════════════════════════════════════

  var happyMachine = buildMachine('Laptop Stand', 750,
    [{ name: 'Stand', qty: 1 }, { name: 'Cable Tidy', qty: 3 }], 'For the new office');

  console.log('happy path — £750 order, 2 items');
  request('POST', '/api/machine', happyMachine, function (err, status, body) {
    test('HTTP 200', function () { assert.strictEqual(status, 200); });
    test('response is HTML', function () { has(body, '<div', 'contains HTML'); });
    test('pipeline completed', function () { has(body, 'Pipeline Complete', 'has heading'); });
    test('order approved & fulfilled', function () { has(body, 'Approved', 'has approved text'); });
    test('log effect shown', function () { has(body, 'log', 'has log badge'); has(body, 'order', 'has order service'); });
    test('notify effect shown', function () { has(body, 'notify', 'has notify badge'); has(body, 'host', 'has host service'); });
    test('fulfil effect shown', function () { has(body, 'fulfil', 'has fulfil badge'); has(body, 'host', 'has host service'); });
    test('persist effect shown', function () { has(body, 'persist', 'has persist badge'); });
    test('audit trail has submitted', function () { has(body, 'submitted', 'has submitted event'); });
    test('audit trail has approved', function () { has(body, 'approved', 'has approved event'); });
    test('audit trail has fulfilled', function () { has(body, 'fulfilled', 'has fulfilled event'); });
    test('SCXML shown', function () { has(body, 'scxml', 'has scxml content'); });
    test('HTML markup shown', function () { has(body, 'mp-current-state', 'has returned HTML'); });
    test('SCXML has fulfilled state', function () { has(body, 'initial="fulfilled"', 'SCXML final state is fulfilled'); });
    test('contains Laptop Stand', function () { has(body, 'Laptop Stand', 'title in response'); });


    // ════════════════════════════════════════════════════════════════
    //  TEST 2: Rejection — £150,000 → rejected by approval service
    // ════════════════════════════════════════════════════════════════

    console.log('\nrejection path — £150,000 order');
    var rejectMachine = buildMachine('Expensive', 150000, [{ name: 'Gold', qty: 1 }]);

    request('POST', '/api/machine', rejectMachine, function (err2, status2, body2) {
      test('HTTP 200', function () { assert.strictEqual(status2, 200); });
      test('order rejected', function () { has(body2, 'Rejected', 'has rejected text'); });
      test('log effect (order service ran)', function () { has(body2, 'log', 'has log'); });
      test('notify effect (rejection email)', function () { has(body2, 'requester@company.com', 'rejection to requester'); });
      test('no fulfil effect badge', function () { notHas(body2, 'badge-success\">fulfil', 'no fulfil badge'); });
      // Bug 25: rejected orders must be persisted (for stats and audit)
      test('persist effect present on rejection', function () { has(body2, '>persist<', 'rejected: persist effect shown'); });
      test('rejection: pipeline completed (not blocked)', function () { has(body2, 'Pipeline Complete', 'rejection is a valid terminal state'); });


      // ════════════════════════════════════════════════════════════════
      //  TEST 3: Guard rejection — empty title
      // ════════════════════════════════════════════════════════════════

      console.log('\nguard rejection — empty title');
      var emptyTitle = buildMachine('', 500, [{ name: 'Pen', qty: 1 }]);

      request('POST', '/api/machine', emptyTitle, function (err3, status3, body3) {
        test('order rejected', function () { has(body3, 'Rejected', 'guard blocked'); });
        test('no effects section', function () { notHas(body3, 'Side effects triggered', 'no effects heading'); });


        // ════════════════════════════════════════════════════════════════
        //  TEST 4: Persistence — order list from GET /api/orders
        // ════════════════════════════════════════════════════════════════

        console.log('\npersistence — GET /api/orders');
        request('GET', '/api/orders', null, function (err4, status4, body4) {
          test('returns HTML', function () { has(body4, '<div', 'is HTML'); });
          test('contains Laptop Stand (from happy path)', function () { has(body4, 'Laptop Stand', 'persisted order'); });
          // Bug 25: rejected orders are now persisted too — Expensive should appear
          test('contains Expensive (rejected, persisted)', function () { has(body4, 'Expensive', 'rejected order in list'); });
          test('order card uses mp-define template', function () { has(body4, 'mp="order-card"', 'uses template'); });
          test('card has mp-ctx', function () { has(body4, 'mp-ctx=', 'has context'); });
          // Both fulfilled (£750) and rejected (£150,000) orders are stored
          test('stats show 2 orders', function () { has(body4, '>2<', 'total count'); });
          test('stats show £750 (fulfilled)', function () { has(body4, '750', 'total value includes £750'); });


          // ════════════════════════════════════════════════════════════════
          //  TEST 5: Order detail
          // ════════════════════════════════════════════════════════════════

          console.log('\norder detail');
          // Extract order ID from the list
          var idMatch = body4.match(/po-[a-z0-9-]+/);
          var orderId = idMatch ? idMatch[0] : 'unknown';

          request('GET', '/api/orders/' + orderId, null, function (err5, status5, body5) {
            test('detail returns HTML', function () { has(body5, '<div', 'is HTML'); });
            test('detail is a machine', function () { has(body5, 'mp="order-detail"', 'has machine'); });
            test('has mp-each for items', function () { has(body5, 'mp-each', 'has list'); });
            test('has mp-class with cond', function () { has(body5, 'cond', 'has conditional class'); });
            test('has mp-on click.outside', function () { has(body5, 'event="click.outside"', 'has outside click'); });
            test('has mp-temporal', function () { has(body5, 'mp-temporal', 'has transition'); });
            test('has sort-by expression', function () { has(body5, 'sort-by', 'has sort-by'); });
            test('has let expression', function () { has(body5, 'let', 'has let'); });


            // ════════════════════════════════════════════════════════════════
            //  TEST 6: Delete
            // ════════════════════════════════════════════════════════════════

            console.log('\ndelete — DELETE /api/orders/:id');
            request('DELETE', '/api/orders/' + orderId, null, function (err6, status6, body6) {
              test('returns updated list', function () { has(body6, '<div', 'is HTML'); });
              test('order removed', function () { notHas(body6, 'Laptop Stand', 'no longer in list'); });
              // Rejected order was persisted (Bug 25), so 1 order remains after deleting the fulfilled one.
              // Reset to verify empty state.
              request('POST', '/api/orders/reset', '', function (err6r, status6r, body6r) {
                test('empty state shown', function () { has(body6r, 'No orders yet', 'empty message'); });


              // ════════════════════════════════════════════════════════════════
              //  TEST 7: Stats endpoint
              // ════════════════════════════════════════════════════════════════

              console.log('\nstats — GET /api/stats');
              request('GET', '/api/stats', null, function (err7, status7, body7) {
                test('returns machine markup', function () { has(body7, 'mp="live-stats"', 'has machine'); });
                test('has mp-text bindings', function () { has(body7, '<mp-text>', 'has bindings'); });
                test('has date-fmt', function () { has(body7, 'date-fmt', 'has date formatting'); });


                // ════════════════════════════════════════════════════════════════
                //  TEST 8: Create form
                // ════════════════════════════════════════════════════════════════

                console.log('\ncreate form — GET /api/orders/new');
                request('GET', '/api/orders/new', null, function (err8, status8, body8) {
                  test('is a machine', function () { has(body8, 'mp="purchase-order"', 'has machine'); });
                  test('has mp-model', function () { has(body8, 'mp-model=', 'has binding'); });
                  test('has guard via when in mp-to', function () { has(body8, '(when ', 'has guard via when'); });
                  test('has mp-each', function () { has(body8, 'mp-each=', 'has list'); });
                  test('has mp-persist', function () { has(body8, 'mp-persist=', 'has persistence'); });
                  test('has mp-ref', function () { has(body8, 'mp-ref=', 'has refs'); });
                  test('has mp-on keydown', function () { has(body8, '<mp-on event="keydown">', 'has keyboard'); });
                  test('has pipeline states', function () {
                    has(body8, 'mp-state="submitted"', 'has submitted');
                    has(body8, 'mp-state="approved"', 'has approved');
                    has(body8, 'mp-state="fulfilled"', 'has fulfilled');
                    has(body8, 'mp-state="rejected"', 'has rejected');
                  });
                  test('has invoke! effects', function () { has(body8, 'invoke!', 'has effects'); });
                  test('has focus!', function () { has(body8, 'focus!', 'has focus'); });
                  // Bug 26: approve guard must not include (some? title) — that causes deadlock
                  test('approve guard is (<= amount 100000) only', function () {
                    has(body8, '(<= amount 100000)', 'correct approve guard');
                    notHas(body8, '(and (some? title) (<= amount 100000))', 'no deadlock guard');
                  });
                  // Bug 25: reject transition must persist the rejected order
                  test('reject transition has persist invoke with status rejected', function () {
                    has(body8, ":status 'rejected'", 'rejected status in persist invoke');
                  });


                  // ════════════════════════════════════════════════════════════════
                  //  TEST 9: SPA fallback
                  // ════════════════════════════════════════════════════════════════

                  console.log('\nSPA fallback routing');
                  var routes = ['/orders', '/orders/new', '/orders/detail'];
                  var done = 0;
                  routes.forEach(function (route) {
                    request('GET', route, null, function (errR, statusR, bodyR) {
                      test(route + ' → 200', function () { assert.strictEqual(statusR, 200); });
                      test(route + ' serves index.html', function () { has(bodyR, 'Purchase Orders', 'has app title'); });
                      done++;
                      if (done === routes.length) {

                        // ════════════════════════════════════════════════════════════════
                        //  TEST 10: Bug 27 — maxSteps exhaustion shows distinct message
                        // ════════════════════════════════════════════════════════════════

                        console.log('\nBug 27 — maxSteps blocked message');
                        // A→B→A cycling machine with named event 'go' — never final, exhausts maxSteps
                        var stalledMachine = '<div mp="loop-test" mp-ctx=\'{"n":0}\'>' +
                          '<div mp-state="a"><mp-transition event="go" to="b"><mp-action>(inc! n)</mp-action></mp-transition></div>' +
                          '<div mp-state="b"><mp-transition event="go" to="a"><mp-action>(inc! n)</mp-action></mp-transition></div>' +
                          '</div>';

                        request('POST', '/api/machine', stalledMachine, function (errS, statusS, bodyS) {
                          test('stalled machine: HTTP 200', function () { assert.strictEqual(statusS, 200); });
                          test('stalled machine: shows Pipeline Stalled not Order Rejected', function () {
                            has(bodyS, 'Pipeline Stalled', 'maxSteps shows stalled message');
                            notHas(bodyS, 'Order Rejected', 'maxSteps does not show order rejected');
                          });
                          test('stalled machine: shows reason text', function () {
                            has(bodyS, 'maxSteps exceeded', 'reason text in response');
                          });
                          finish();
                        });
                      }
                    });
                  });
                });
              });
              });  // reset callback (empty state)
            });
          });
        });
      });
    });
  });
}); // reset callback

}); // path traversal callback


function finish() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total\n');
  process.exit(failed > 0 ? 1 : 0);
}
