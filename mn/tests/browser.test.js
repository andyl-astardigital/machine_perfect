/**
 * machine_native — Puppeteer runner for browser.test.html.
 *
 * Serves browser.test.html over HTTP (required for history.pushState),
 * loads it in a headless browser, waits for the test suite to finish,
 * prints each result line, and exits with the appropriate code.
 *
 * Run: node mn/tests/browser.test.js
 */

var puppeteer = require('puppeteer');
var http = require('http');
var fs = require('fs');
var path = require('path');

var SUITE_DIR = __dirname;
var MP_DIR = path.join(__dirname, '..');
var PORT = 19000 + Math.floor(Math.random() * 1000);


// ── Minimal static file server ───────────────────────────────────────────────

function serveFile(res, filePath) {
  var ext = path.extname(filePath).toLowerCase();
  var types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  var type = types[ext] || 'application/octet-stream';
  try {
    var content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not found: ' + filePath);
  }
}

var fileServer = http.createServer(function (req, res) {
  var urlPath = req.url.split('?')[0];

  // Serve browser.test.html at root
  if (urlPath === '/' || urlPath === '/browser.test.html') {
    return serveFile(res, path.join(SUITE_DIR, 'browser.test.html'));
  }
  // Serve engine.js and browser.js from mn/
  if (urlPath === '/engine.js') return serveFile(res, path.join(MP_DIR, 'engine.js'));
  if (urlPath === '/browser.js') return serveFile(res, path.join(MP_DIR, 'browser.js'));
  // Serve logo from repo root
  if (urlPath.endsWith('.svg')) return serveFile(res, path.join(MP_DIR, '..', urlPath.replace(/^\//, '')));

  res.writeHead(404);
  res.end('Not found');
});


// ── Puppeteer runner ─────────────────────────────────────────────────────────

async function main() {
  await new Promise(function (resolve) { fileServer.listen(PORT, resolve); });

  var browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    var page = await browser.newPage();

    page.on('console', function (msg) {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        process.stderr.write('[browser] ' + msg.text() + '\n');
      }
    });

    await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle0' });

    // Wait until the test suite finishes (summary no longer says "Running...")
    await page.waitForFunction(function () {
      var s = document.getElementById('summary');
      return s && s.textContent !== 'Running...';
    }, { timeout: 30000 });

    // Collect results
    var results = await page.evaluate(function () {
      var allEls = Array.from(document.querySelectorAll('.group, .result'));
      var output = allEls.map(function (el) {
        if (el.classList.contains('group')) {
          return { type: 'group', text: el.textContent };
        }
        var detail = el.querySelector('.detail');
        return {
          type: 'result',
          pass: el.classList.contains('pass'),
          text: el.childNodes[0] ? el.childNodes[0].textContent.trim() : el.textContent.trim(),
          detail: detail ? detail.textContent.trim() : null
        };
      });
      return { output: output, summary: document.getElementById('summary').textContent };
    });

    // Print
    for (var i = 0; i < results.output.length; i++) {
      var item = results.output[i];
      if (item.type === 'group') {
        console.log('\n' + item.text);
      } else {
        console.log('  ' + (item.pass ? '\u2713' : '\u2717') + ' ' + item.text);
        if (!item.pass && item.detail) console.log('      ' + item.detail);
      }
    }

    console.log('\n' + results.summary);

    var match = results.summary.match(/(\d+) passed, (\d+) failed/);
    var failed = match ? parseInt(match[2], 10) : 1;

    process.exit(failed > 0 ? 1 : 0);

  } finally {
    await browser.close();
    fileServer.close();
  }
}

main().catch(function (err) {
  console.error(err);
  fileServer.close();
  process.exit(1);
});
