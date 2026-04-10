/**
 * Purchase order app — end-to-end browser journey tests.
 *
 * Every test exercises a REAL user journey through the actual app:
 * page load, form fill, pipeline submission, navigation, persistence.
 * No cheating with HTTP injection — if the browser can't do it, it fails.
 *
 * Requires: registry on port 3100, PO server on port 4000.
 *
 * Run: node --test examples/purchase-order/tests/integration.test.js
 */

var test = require('node:test');
var assert = require('node:assert');
var http = require('http');
var puppeteer = require('puppeteer');

var URL = 'http://localhost:4000';


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Helpers                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝

async function withPage(fn) {
  var browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    var page = await browser.newPage();
    await fn(page);
  } finally {
    await browser.close();
  }
}

async function waitForState(page, stateName, timeout) {
  await page.waitForFunction(function (name) {
    var inst = document.querySelector('[mp="app"]');
    if (!inst || !inst._mp) return false;
    if (inst._mp.state !== name) return false;
    var state = document.querySelector('[mp-state="' + name + '"]');
    return state && !state.hidden && state.children.length > 0;
  }, { timeout: timeout || 15000 }, stateName);
  await new Promise(function (r) { setTimeout(r, 500); });
}

function resetOrders() {
  return new Promise(function (resolve) {
    var req = http.request({
      hostname: 'localhost', port: 4000, path: '/api/orders/reset', method: 'POST'
    }, function (res) {
      res.on('data', function () {}); res.on('end', resolve);
    });
    req.end();
  });
}

async function fillAndSubmitOrder(page, title, amount, items) {
  // Navigate to create
  await page.click('button[mp-to="create"]');
  await waitForState(page, 'create');

  // Wait for purchase-order machine
  await page.waitForFunction(function () {
    return !!document.querySelector('[mp="purchase-order"]');
  }, { timeout: 10000 });
  await new Promise(function (r) { setTimeout(r, 300); });

  // Fill title
  await page.type('input[mp-model="title"]', title);

  // Clear amount then type (initial value is 0, don't append)
  var amountInput = await page.$('input[mp-model="amount"]');
  await amountInput.click({ clickCount: 3 });
  await amountInput.type(String(amount));

  // Add items
  for (var i = 0; i < items.length; i++) {
    await page.type('input[mp-model="newItem"]', items[i]);
    await page.click('button[mp-to="add-item"]');
    await new Promise(function (r) { setTimeout(r, 200); });
  }

  // Click submit
  var submitBtn = await page.$('button[mp-to="submit"]');
  assert(submitBtn, 'submit button exists');
  await submitBtn.click();

  // Wait for pipeline result
  await page.waitForFunction(function () {
    var stateEl = document.querySelector('[mp-state="submitted"]');
    if (!stateEl || stateEl.hidden) return false;
    return stateEl.innerHTML.indexOf('Pipeline Complete') !== -1;
  }, { timeout: 15000 });
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Journey 1: Page load and navigation                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('page load — orders state renders with server content', async function () {
  await withPage(async function (page) {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });

    await page.waitForFunction(function () {
      var el = document.querySelector('[mp-state="orders"]');
      if (!el || el.hidden) return false;
      return el.innerHTML.indexOf('loading-spinner') === -1 && el.innerHTML.trim().length > 20;
    }, { timeout: 15000 });

    var state = await page.evaluate(function () {
      var el = document.querySelector('[mp-state="orders"]');
      return {
        appState: document.querySelector('[mp="app"]')._mp.state,
        hidden: el.hidden,
        hasSpinner: el.innerHTML.indexOf('loading-spinner') !== -1
      };
    });
    assert.strictEqual(state.appState, 'orders', 'app starts in orders state');
    assert.strictEqual(state.hidden, false, 'orders state visible');
    assert.strictEqual(state.hasSpinner, false, 'spinner replaced by server content');
  });
});

test('navbar — orders and create buttons navigate correctly', async function () {
  await withPage(async function (page) {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await waitForState(page, 'orders');

    // Navigate to create
    await page.click('button[mp-to="create"]');
    await waitForState(page, 'create');
    var createState = await page.evaluate(function () {
      return document.querySelector('[mp="app"]')._mp.state;
    });
    assert.strictEqual(createState, 'create', 'navigated to create');

    // Navigate back to orders
    await page.click('#btn-nav-orders');
    await waitForState(page, 'orders', 15000);
    var ordersState = await page.evaluate(function () {
      return document.querySelector('[mp="app"]')._mp.state;
    });
    assert.strictEqual(ordersState, 'orders', 'navigated back to orders');
  });
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Journey 2: Create → submit → approved → order in list                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('full journey: create order → pipeline approves → navigate to orders → order in list', async function () {
  await resetOrders();

  await withPage(async function (page) {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await waitForState(page, 'orders');

    // ── Step 1: Fill and submit ──
    await fillAndSubmitOrder(page, 'Journey Test Order', 750, ['Laptop Stand', 'Cable Tidy']);

    // ── Step 2: Verify pipeline result ──
    var pipeline = await page.evaluate(function () {
      var stateEl = document.querySelector('[mp-state="submitted"]');
      var html = stateEl.innerHTML;
      return {
        hasOrderApproved: html.indexOf('Order Approved') !== -1,
        hasOrderRejected: html.indexOf('Order Rejected') !== -1,
        scxmlFinalState: (html.match(/initial="([^"]+)"/) || [])[1] || 'none',
        hasViewAllBtn: !!stateEl.querySelector('#btn-view-all-orders')
      };
    });
    assert.strictEqual(pipeline.hasOrderApproved, true, 'pipeline approved the order');
    assert.strictEqual(pipeline.hasOrderRejected, false, 'order was not rejected');
    assert.strictEqual(pipeline.scxmlFinalState, 'fulfilled', 'SCXML reached fulfilled state');
    assert.strictEqual(pipeline.hasViewAllBtn, true, 'View All Orders button present');

    // ── Step 3: Click View All Orders → navigate to order list ──
    await page.click('#btn-view-all-orders');
    await waitForState(page, 'orders', 15000);

    // ── Step 4: Verify order appears in list ──
    var orderList = await page.evaluate(function () {
      var ordersEl = document.querySelector('[mp-state="orders"]');
      var html = ordersEl.innerHTML;
      return {
        appState: document.querySelector('[mp="app"]')._mp.state,
        hasOrder: html.indexOf('Journey Test Order') !== -1,
        hasNoOrders: html.indexOf('No orders yet') !== -1,
        totalStat: (html.match(/Total<\/div>\s*<div[^>]*>(\d+)</) || [])[1] || '0'
      };
    });
    assert.strictEqual(orderList.appState, 'orders', 'app in orders state');
    assert.strictEqual(orderList.hasOrder, true, 'Journey Test Order appears in list');
    assert.strictEqual(orderList.hasNoOrders, false, 'list is not empty');
    assert.strictEqual(orderList.totalStat, '1', 'stats show 1 order');
  });
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Journey 3: Multiple orders persist correctly                           ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('two orders submitted → both appear in order list with correct stats', async function () {
  await resetOrders();

  await withPage(async function (page) {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await waitForState(page, 'orders');

    // ── First order ──
    await fillAndSubmitOrder(page, 'First Order', 500, ['Widget']);

    // Verify approval
    var first = await page.evaluate(function () {
      return document.querySelector('[mp-state="submitted"]').innerHTML.indexOf('Order Approved') !== -1;
    });
    assert.strictEqual(first, true, 'first order approved');

    // Navigate back via View All Orders
    await page.click('#btn-view-all-orders');
    await waitForState(page, 'orders', 15000);

    // ── Second order ──
    await fillAndSubmitOrder(page, 'Second Order', 300, ['Gadget']);

    var second = await page.evaluate(function () {
      return document.querySelector('[mp-state="submitted"]').innerHTML.indexOf('Order Approved') !== -1;
    });
    assert.strictEqual(second, true, 'second order approved');

    // Navigate back
    await page.click('#btn-view-all-orders');
    await waitForState(page, 'orders', 15000);

    // ── Verify both orders in list ──
    var list = await page.evaluate(function () {
      var html = document.querySelector('[mp-state="orders"]').innerHTML;
      return {
        hasFirst: html.indexOf('First Order') !== -1,
        hasSecond: html.indexOf('Second Order') !== -1,
        totalStat: (html.match(/Total<\/div>\s*<div[^>]*>(\d+)</) || [])[1] || '0'
      };
    });
    assert.strictEqual(list.hasFirst, true, 'First Order in list');
    assert.strictEqual(list.hasSecond, true, 'Second Order in list');
    assert.strictEqual(list.totalStat, '2', 'stats show 2 orders');
  });
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Journey 4: Form validation prevents empty submissions                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('form validation — submit button disabled without title/amount/items', async function () {
  await withPage(async function (page) {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await waitForState(page, 'orders');

    await page.click('button[mp-to="create"]');
    await waitForState(page, 'create');
    await page.waitForFunction(function () {
      return !!document.querySelector('[mp="purchase-order"]');
    }, { timeout: 10000 });

    // Submit button should be disabled with empty form
    var disabled = await page.evaluate(function () {
      var btn = document.querySelector('button[mp-to="submit"]');
      return btn ? btn.disabled : 'no button';
    });
    assert.strictEqual(disabled, true, 'submit disabled when form is empty');

    // Fill only title — still disabled
    await page.type('input[mp-model="title"]', 'Incomplete Order');
    await new Promise(function (r) { setTimeout(r, 200); });
    var afterTitle = await page.evaluate(function () {
      return document.querySelector('button[mp-to="submit"]').disabled;
    });
    assert.strictEqual(afterTitle, true, 'submit disabled with only title');

    // Add amount — still disabled (no items)
    var amountInput = await page.$('input[mp-model="amount"]');
    await amountInput.click({ clickCount: 3 });
    await amountInput.type('100');
    await new Promise(function (r) { setTimeout(r, 200); });
    var afterAmount = await page.evaluate(function () {
      return document.querySelector('button[mp-to="submit"]').disabled;
    });
    assert.strictEqual(afterAmount, true, 'submit disabled with no items');

    // Add item — now enabled
    await page.type('input[mp-model="newItem"]', 'Final Item');
    await page.click('button[mp-to="add-item"]');
    await new Promise(function (r) { setTimeout(r, 300); });
    var afterItem = await page.evaluate(function () {
      return document.querySelector('button[mp-to="submit"]').disabled;
    });
    assert.strictEqual(afterItem, false, 'submit enabled with title + amount + item');
  });
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Journey 5: Cancel from create returns to orders without side effects   ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('cancel from create form returns to orders without submitting', async function () {
  await resetOrders();

  await withPage(async function (page) {
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await waitForState(page, 'orders');

    // Go to create, fill some data, then cancel
    await page.click('button[mp-to="create"]');
    await waitForState(page, 'create');
    await page.waitForFunction(function () {
      return !!document.querySelector('[mp="purchase-order"]');
    }, { timeout: 10000 });

    await page.type('input[mp-model="title"]', 'Should Not Persist');
    var amountInput = await page.$('input[mp-model="amount"]');
    await amountInput.click({ clickCount: 3 });
    await amountInput.type('999');

    // Click navbar Orders button to cancel
    await page.click('#btn-nav-orders');
    await waitForState(page, 'orders', 15000);

    // Verify no order was created
    var list = await page.evaluate(function () {
      var html = document.querySelector('[mp-state="orders"]').innerHTML;
      return {
        hasNoOrders: html.indexOf('No orders yet') !== -1,
        hasCancelled: html.indexOf('Should Not Persist') !== -1
      };
    });
    assert.strictEqual(list.hasNoOrders, true, 'orders list is empty');
    assert.strictEqual(list.hasCancelled, false, 'cancelled order did not persist');
  });
});


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Journey 6: No console errors through full lifecycle                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('no console errors through create → submit → view orders lifecycle', async function () {
  await resetOrders();

  await withPage(async function (page) {
    var errors = [];
    var undefinedVarWarnings = [];
    page.on('console', function (msg) {
      if (msg.type() === 'error') errors.push(msg.text());
      if ((msg.type() === 'warning' || msg.type() === 'warn') && msg.text().indexOf('undefined variable') !== -1) {
        undefinedVarWarnings.push(msg.text());
      }
    });

    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
    await waitForState(page, 'orders');

    // Full lifecycle: create → fill → submit → view orders
    await fillAndSubmitOrder(page, 'Error Check Order', 200, ['Pen']);
    await page.click('#btn-view-all-orders');
    await waitForState(page, 'orders', 15000);

    // Navigate to create and back
    await page.click('button[mp-to="create"]');
    await waitForState(page, 'create');
    await page.click('#btn-nav-orders');
    await waitForState(page, 'orders', 15000);

    assert.strictEqual(errors.length, 0, 'no console errors: ' + errors.join('; '));
    assert.strictEqual(undefinedVarWarnings.length, 0,
      undefinedVarWarnings.length + ' undefined variable warnings: ' + undefinedVarWarnings.slice(0, 5).join('; '));
  });
});
