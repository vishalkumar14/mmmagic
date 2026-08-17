// Compatibility smoke test for Node versions that predate node:test (< 18).
//
// NOT part of `npm test` -- the main suites use node:test, which needs Node 18+.
// This exists to verify the prebuilt binaries still work on older runtimes:
//
//   node test/legacy-smoke.js                        # against this checkout
//   MMM_ENTRY=@vishalkumar14/mmmagic node smoke.js        # against an installed copy
//
// Env: MMM_ENTRY (module to require), MMM_FIXTURES (fixture dir),
//      MMM_LARGE_MB (large-file size, default 120).
// Deliberately ES2019-safe: no node: prefixes, no optional chaining, no
// top-level await. Exits non-zero on any failure.
'use strict';

var path = require('path');
var fs = require('fs');
var os = require('os');
var assert = require('assert');

var pkg = process.env.MMM_ENTRY || '../lib/index';
var mmm = require(pkg);
var FIX = process.env.MMM_FIXTURES || path.join(__dirname, 'fixtures');

var failures = 0;
var checks = 0;

function check(name, actual, expected) {
  checks++;
  try {
    assert.strictEqual(actual, expected);
    console.log('    ok   ' + name + ' -> ' + actual);
  } catch (e) {
    failures++;
    console.log('    FAIL ' + name + ' -> got ' + JSON.stringify(actual) +
                ', want ' + JSON.stringify(expected));
  }
}

var CASES = [
  ['text.txt', 'text/plain', 'us-ascii'],
  ['csv.csv', 'text/plain', 'us-ascii'],
  ['json.json', 'text/plain', 'us-ascii'],
  ['xml.xml', 'text/xml', 'us-ascii'],
  ['pdf.pdf', 'application/pdf', 'us-ascii'],
  ['png.png', 'image/png', 'binary'],
  ['jpg.jpg', 'image/jpeg', 'binary'],
  ['zip.zip', 'application/zip', 'binary']
];

function detectFile(file, flags, cb) {
  new mmm.Magic(flags).detectFile(file, cb);
}

function step1() {
  console.log('  [1] detectFile - MIME type');
  var i = 0;
  (function next() {
    if (i >= CASES.length) return step2();
    var c = CASES[i++];
    detectFile(path.join(FIX, c[0]), mmm.MAGIC_MIME_TYPE, function (err, res) {
      check(c[0], err ? 'ERROR: ' + err.message : res, c[1]);
      next();
    });
  })();
}

function step2() {
  console.log('  [2] detectFile - MIME type + encoding');
  var i = 0;
  (function next() {
    if (i >= CASES.length) return step3();
    var c = CASES[i++];
    detectFile(path.join(FIX, c[0]), mmm.MAGIC_MIME, function (err, res) {
      check(c[0], err ? 'ERROR: ' + err.message : res, c[1] + '; charset=' + c[2]);
      next();
    });
  })();
}

function step3() {
  console.log('  [3] detect(Buffer)');
  var i = 0;
  (function next() {
    if (i >= CASES.length) return step4();
    var c = CASES[i++];
    var buf = fs.readFileSync(path.join(FIX, c[0]));
    new mmm.Magic(mmm.MAGIC_MIME_TYPE).detect(buf, function (err, res) {
      check(c[0] + ' (buffer)', err ? 'ERROR: ' + err.message : res, c[1]);
      next();
    });
  })();
}

function step4() {
  console.log('  [4] MAGIC_CONTINUE returns an array');
  detectFile(path.join(FIX, 'zip.zip'),
             mmm.MAGIC_MIME_TYPE | mmm.MAGIC_CONTINUE, function (err, res) {
    checks++;
    if (err || !Array.isArray(res) || res[0] !== 'application/zip') {
      failures++;
      console.log('    FAIL got ' + JSON.stringify(err ? err.message : res));
    } else {
      console.log('    ok   array of ' + res.length + ', first = ' + res[0]);
    }
    step5();
  });
}

function step5() {
  console.log('  [5] nonexistent path yields an Error');
  detectFile('/no/such/path-1234567', mmm.MAGIC_MIME_TYPE, function (err, res) {
    checks++;
    if (err) console.log('    ok   Error: ' + err.message);
    else { failures++; console.log('    FAIL expected an error, got ' + res); }
    step6();
  });
}

function step6() {
  console.log('  [6] large file is not read into memory');
  var mb = Number(process.env.MMM_LARGE_MB || 120);
  var tmp = path.join(os.tmpdir(), 'mmm-legacy-' + process.pid + '.csv');
  var rows = [];
  for (var i = 0; i < 16384; i++) rows.push('ORD' + i + ',Koramangala,Dosa,2,120.00');
  var chunk = Buffer.from(rows.join('\n') + '\n');
  var fd = fs.openSync(tmp, 'w');
  var written = 0;
  while (written < mb * 1024 * 1024) { fs.writeSync(fd, chunk); written += chunk.length; }
  fs.closeSync(fd);

  var sizeMb = fs.statSync(tmp).size / 1048576;
  detectFile(tmp, mmm.MAGIC_MIME_TYPE, function () {   // warm
    var before = process.memoryUsage().rss / 1048576;
    var t0 = Date.now();
    detectFile(tmp, mmm.MAGIC_MIME_TYPE, function (err, res) {
      var grew = process.memoryUsage().rss / 1048576 - before;
      var ms = Date.now() - t0;
      try { fs.unlinkSync(tmp); } catch (e) {}
      checks++;
      var okMime = !err && res === 'text/plain';
      var okMem = grew < 32;
      if (okMime && okMem) {
        console.log('    ok   ' + sizeMb.toFixed(1) + ' MB | RSS +' +
                    grew.toFixed(1) + ' MB | ' + ms + ' ms | ' + res);
      } else {
        failures++;
        console.log('    FAIL ' + sizeMb.toFixed(1) + ' MB | RSS +' +
                    grew.toFixed(1) + ' MB | ' + (err ? err.message : res));
      }
      step7();
    });
  });
}

function step7() {
  console.log('  [7] worker_threads');
  var wt;
  try { wt = require('worker_threads'); }
  catch (e) { console.log('    skip worker_threads unavailable'); return done(); }

  var src =
    'var wt = require("worker_threads");' +
    'var mmm = require(wt.workerData.entry);' +
    'new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(wt.workerData.file, function (e, r) {' +
    '  wt.parentPort.postMessage(e ? { error: e.message } : { result: r });' +
    '});';

  var w = new wt.Worker(src, {
    eval: true,
    workerData: { entry: require.resolve(pkg), file: path.join(FIX, 'png.png') }
  });
  var got = null;
  w.on('message', function (m) { got = m; });
  w.on('error', function (e) {
    checks++; failures++;
    console.log('    FAIL worker error: ' + String(e.message).split('\n')[0]);
    done();
  });
  w.on('exit', function () {
    if (got === null) return;
    checks++;
    if (got.result === 'image/png') console.log('    ok   worker detected image/png');
    else { failures++; console.log('    FAIL worker: ' + JSON.stringify(got)); }
    done();
  });
}

function done() {
  console.log('  ---- ' + (checks - failures) + '/' + checks + ' checks passed on ' +
              process.version + ' ' + process.arch +
              ' (napi ' + (process.versions.napi || 'n/a') + ')');
  process.exit(failures === 0 ? 0 : 1);
}

step1();
