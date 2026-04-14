/**
 * Purchase order app — real browser e2e tests.
 *
 * Every test opens a browser, types into inputs, clicks buttons, and
 * verifies what appears on screen. No faking. No HTTP injection.
 * If the user can't do it, the test can't either.
 *
 * Requires: registry on port 3100, PO server on port 4000.
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

async function launch() {
  var browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
  var page = await browser.newPage();
  return { browser: browser, page: page };
}

function resetDb() {
  return new Promise(function (resolve) {
    var req = http.request({
      hostname: 'localhost', port: 4000, path: '/api/reset', method: 'POST'
    }, function (res) { res.on('data', function () {}); res.on('end', resolve); });
    req.end();
  });
}

async function login(page, username) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[mn-model="username"]', { timeout: 10000 });
  await page.type('input[mn-model="username"]', username);
  await page.type('input[mn-model="password"]', username);
  await page.click('button[mn-to="authenticate"]');
  await page.waitForFunction(function () {
    var nav = document.querySelector('[mn="nav"]');
    return nav && nav._mn && nav._mn.state === 'orders';
  }, { timeout: 15000 });
  await sleep(500);
}

async function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function navState(page) {
  return page.evaluate(function () {
    var nav = document.querySelector('[mn="nav"]');
    return nav && nav._mn ? nav._mn.state : null;
  });
}

async function pageText(page) {
  return page.evaluate(function () { return document.body.innerText; });
}


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Tests                                                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

test('login — alice types credentials, clicks Sign in, sees order list', async function () {
  var b = await launch();
  try {
    await login(b.page, 'alice');
    assert.strictEqual(await navState(b.page), 'orders');
    var text = await pageText(b.page);
    assert.ok(text.indexOf('Alice Chen') !== -1, 'alice name in navbar');
    assert.ok(text.indexOf('requester') !== -1, 'role badge visible');
    assert.ok(text.indexOf('Sign in to continue') === -1, 'login form NOT visible after auth');
    assert.ok(text.indexOf('(or ') === -1, 'no raw s-expressions visible');
    assert.ok(text.indexOf('(get ') === -1, 'no raw s-expressions visible (get)');
  } finally { await b.browser.close(); }
});


test('login — wrong password shows error, stays on login', async function () {
  var b = await launch();
  try {
    await b.page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await b.page.waitForSelector('input[mn-model="username"]', { timeout: 10000 });
    await b.page.type('input[mn-model="username"]', 'alice');
    await b.page.type('input[mn-model="password"]', 'wrongpassword');
    await b.page.click('button[mn-to="authenticate"]');
    await b.page.waitForFunction(function () {
      return document.body.innerText.indexOf('Invalid') !== -1;
    }, { timeout: 15000 });
    assert.strictEqual(await navState(b.page), 'login', 'still on login');
  } finally { await b.browser.close(); }
});


test('alice creates £25k PO — clicks through form, submits, sees fulfilled', async function () {
  await resetDb();
  var b = await launch();
  try {
    await login(b.page, 'alice');

    // Click + New
    await b.page.click('button[mn-to="create-order"]');
    await b.page.waitForSelector('input[mn-model="title"]', { timeout: 10000 });
    await sleep(300);

    // Fill form
    await b.page.type('input[mn-model="title"]', 'Office Supplies');
    var amountInput = await b.page.$('input[mn-model="amount"]');
    await amountInput.click({ clickCount: 3 });
    await amountInput.type('25000');

    // Add item
    await b.page.type('input[mn-model="newItem"]', 'Printer Paper');
    await b.page.click('button[mn-to="add-item"]');
    await sleep(200);

    // Submit button should be enabled
    var disabled = await b.page.evaluate(function () {
      return document.querySelector('button[mn-to="submit"]').disabled;
    });
    assert.strictEqual(disabled, false, 'submit button enabled');

    // Click submit
    await b.page.click('button[mn-to="submit"]');

    // Wait for review (pipeline runs, SSE pushes result, nav transitions)
    await b.page.waitForFunction(function () {
      var nav = document.querySelector('[mn="nav"]');
      return nav && nav._mn && nav._mn.state === 'review';
    }, { timeout: 20000 });

    var text = await pageText(b.page);
    assert.ok(text.indexOf('Fulfilled') !== -1 || text.indexOf('fulfilled') !== -1, 'review shows fulfilled');
  } finally { await b.browser.close(); }
});


test('alice does not see Director tab in navbar', async function () {
  var b = await launch();
  try {
    await login(b.page, 'alice');
    var directorVisible = await b.page.evaluate(function () {
      var buttons = document.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].textContent.trim() === 'Director' && buttons[i].offsetParent !== null) return true;
      }
      return false;
    });
    assert.strictEqual(directorVisible, false, 'director tab hidden for alice');
  } finally { await b.browser.close(); }
});


test('bob sees Director tab and can navigate to director queue', async function () {
  var b = await launch();
  try {
    await login(b.page, 'bob');
    var text = await pageText(b.page);
    assert.ok(text.indexOf('Director') !== -1, 'director tab visible for bob');
    // Director button uses mn-on, not mn-to — click it by text
    await b.page.evaluate(function () {
      var buttons = document.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].textContent.trim() === 'Director' && buttons[i].offsetParent !== null) {
          buttons[i].click();
          break;
        }
      }
    });
    await b.page.waitForFunction(function () {
      var nav = document.querySelector('[mn="nav"]');
      return nav && nav._mn && nav._mn.state === 'director-queue';
    }, { timeout: 15000 });
    assert.strictEqual(await navState(b.page), 'director-queue');
  } finally { await b.browser.close(); }
});


test('alice sees projected status card — no sensitive data in DOM', async function () {
  await resetDb();
  var b = await launch();
  try {
    // Alice submits a £75k PO with sensitive fields
    await login(b.page, 'alice');
    await b.page.click('button[mn-to="create-order"]');
    await b.page.waitForSelector('input[mn-model="title"]', { timeout: 10000 });
    await sleep(300);

    await b.page.type('input[mn-model="title"]', 'Server Upgrade');
    var amountInput = await b.page.$('input[mn-model="amount"]');
    await amountInput.click({ clickCount: 3 });
    await amountInput.type('75000');
    await b.page.type('input[mn-model="newItem"]', 'Dell R750');
    await b.page.click('button[mn-to="add-item"]');
    await sleep(200);
    await b.page.type('textarea[mn-model="notes"]', 'Confidential budget note');
    await b.page.type('input[mn-model="cost_centre"]', 'OPS-017');

    await b.page.click('button[mn-to="submit"]');
    await sleep(5000);

    // Go to orders
    await b.page.click('button[mn-to="back-to-orders"]');
    await b.page.waitForFunction(function () {
      var nav = document.querySelector('[mn="nav"]');
      return nav && nav._mn && nav._mn.state === 'orders';
    }, { timeout: 15000 });
    await sleep(3000);

    // Check: alice sees the PO but NOT the sensitive fields
    var text = await pageText(b.page);
    assert.ok(text.indexOf('Server Upgrade') !== -1, 'title visible');
    assert.ok(text.indexOf('pending') !== -1, 'status shows pending');
    assert.ok(text.indexOf('Confidential budget note') === -1, 'notes NOT in page');
    assert.ok(text.indexOf('OPS-017') === -1, 'cost centre NOT in page');

    // Also check the raw DOM — mn-ctx should not contain sensitive data
    var rawHtml = await b.page.evaluate(function () { return document.body.innerHTML; });
    assert.ok(rawHtml.indexOf('Confidential budget note') === -1, 'notes NOT in raw HTML');
    assert.ok(rawHtml.indexOf('OPS-017') === -1, 'cost centre NOT in raw HTML');
  } finally { await b.browser.close(); }
});
