/**
 * Simulates the exact browser submit flow:
 * 1. Browser reads machine outerHTML (double-quoted, entity-encoded)
 * 2. POSTs it to /api/machine as text/html
 * 3. Checks the pipeline result
 * 4. Checks the order persisted in GET /api/orders
 *
 * Run: node examples/purchase-order/test-browser-flow.js
 */

var http = require('http');
var PORT = 4000;

function req(method, path, body) {
  return new Promise(function (resolve, reject) {
    var opts = { hostname: 'localhost', port: PORT, path: path, method: method, headers: {} };
    if (body) opts.headers['Content-Type'] = 'text/html';
    var r = http.request(opts, function (res) {
      var d = ''; res.on('data', function (c) { d += c; }); res.on('end', function () { resolve(d); });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// Build HTML exactly as browser outerHTML would produce it:
// - double-quoted attributes
// - &quot; for " inside attribute values
// - &gt; for > inside attribute values
// - single quotes in s-expressions survive (they're not attribute delimiters)
function browserOuterHTML(title, amount, items) {
  var ctx = JSON.stringify({
    title: title, amount: amount, items: items,
    newItem: '', notes: '', urgent: false,
    submitted_at: null, approved_at: null
  });
  // Double-quote encode: " becomes &quot;
  var encodedCtx = ctx.replace(/"/g, '&quot;');

  return '<div mp="purchase-order" mp-ctx="' + encodedCtx + '">' +
    '<div mp-state="draft">' +
    "<button mp-to=\"(when (and (&gt; (count items) 0) (&gt; amount 0) (not (empty? title))) (do (set! submitted_at (now)) (invoke! :type 'log' :input (str 'Order: ' title)) (to submitted)))\" hidden>submit</button>" +
    '</div>' +
    '<div mp-state="submitted">' +
    "<button mp-to=\"(when (some? title) (do (set! approved_at (now)) (invoke! :type 'notify' :input (obj :to 'f@co' :subject (str 'OK: ' title))) (to approved)))\">approve</button>" +
    '<button mp-to="rejected">reject</button>' +
    '</div>' +
    '<div mp-state="approved">' +
    "<button mp-to=\"(do (invoke! :type 'fulfil' :input (obj :title title :items items)) (invoke! :type 'persist' :input (obj :title title :amount amount :items items)) (to fulfilled))\">fulfil</button>" +
    '</div>' +
    '<div mp-state="fulfilled" mp-final></div>' +
    '<div mp-state="rejected" mp-final></div>' +
    '</div>';
}

(async function () {
  console.log('\nBrowser flow simulation\n');

  // Reset
  await req('POST', '/api/orders/reset');

  // Build browser-style HTML
  var html = browserOuterHTML('Browser Order', 500, [{ name: 'Pens', qty: 3 }, { name: 'Paper', qty: 10 }]);
  console.log('HTML length:', html.length);
  console.log('Has &quot;:', html.indexOf('&quot;') !== -1);
  console.log('Has &gt;:', html.indexOf('&gt;') !== -1);

  // Submit
  var result = await req('POST', '/api/machine', html);
  var approved = result.indexOf('Approved') !== -1 && result.indexOf('Order Rejected') === -1;
  var rejected = result.indexOf('Order Rejected') !== -1;
  console.log('\nPipeline result:');
  console.log('  Approved & Fulfilled:', approved);
  console.log('  Rejected:', rejected);

  if (rejected) {
    // Find why
    var scxmlStart = result.indexOf('&lt;scxml');
    if (scxmlStart !== -1) {
      var snippet = result.substring(scxmlStart, scxmlStart + 500).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      console.log('  SCXML snippet:', snippet.substring(0, 300));
    }
  }

  // Check orders
  var orders = await req('GET', '/api/orders');
  console.log('\nOrders:');
  console.log('  Has Browser Order:', orders.indexOf('Browser Order') !== -1);
  console.log('  Order count:', (orders.match(/order-card/g) || []).length);

  // Final verdict
  console.log('\n' + (approved && orders.indexOf('Browser Order') !== -1 ? 'PASS' : 'FAIL'));
  process.exit(approved && orders.indexOf('Browser Order') !== -1 ? 0 : 1);
})();
