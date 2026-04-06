/**
 * Headless browser test runner.
 *
 * Opens mp/tests/browser.test.html in Puppeteer, waits for results,
 * asserts all pass. Uses Node built-in test runner.
 *
 * Requires a server running on port 4000.
 *
 * Run: node --test tests/run-browser-tests.js
 */

var test = require('node:test');
var assert = require('node:assert');
var puppeteer = require('puppeteer');

var PORT = process.env.PORT || 4000;
var URL = 'http://localhost:' + PORT + '/mp/tests/browser.test.html';

test('browser test suite passes', async function () {
  var browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    var page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });

    await page.waitForFunction(function () {
      var s = document.getElementById('summary');
      return s && s.textContent.indexOf('passed') !== -1;
    }, { timeout: 30000 });

    var results = await page.evaluate(function () {
      var s = document.getElementById('summary').textContent;
      var match = s.match(/(\d+) passed, (\d+) failed/);
      var failures = [];
      var items = document.querySelectorAll('.result.fail');
      for (var i = 0; i < items.length; i++) failures.push(items[i].textContent.trim());
      return { passed: parseInt(match[1]), failed: parseInt(match[2]), failures: failures };
    });

    if (results.failures.length > 0) {
      results.failures.forEach(function (f) { console.log('    ✗ ' + f); });
    }
    console.log('    ' + results.passed + ' passed, ' + results.failed + ' failed');
    assert.strictEqual(results.failed, 0, results.failed + ' browser tests failed');
  } finally {
    await browser.close();
  }
});
