'use strict';

// worker_threads support.
//
// The NAN implementation registered with NODE_MODULE, which is not
// context-aware. It loaded on the main thread but any Worker that required it
// died with "Module did not self-register", and setFallback() mutated a
// file-scope pointer that two threads could race on.
//
// The Node-API implementation registers with NODE_API_MODULE and keeps its
// state in per-addon-instance data, so each thread gets its own. These tests
// are the regression guard for that.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const mmm = require('../lib/index');

const FIXTURES = path.join(__dirname, 'fixtures');

// Runs `body` inside a Worker and resolves with whatever it postMessage()s.
function inWorker(body, workerData) {
  return new Promise((resolve, reject) => {
    const w = new Worker(body, { eval: true, workerData });
    let received;
    w.on('message', (m) => { received = m; });
    w.on('error', reject);
    w.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`worker exited with code ${code}`));
      resolve(received);
    });
  });
}

const DETECT_IN_WORKER = `
  const { parentPort, workerData } = require('node:worker_threads');
  const mmm = require(workerData.entry);
  const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);
  magic.detectFile(workerData.file, (err, result) => {
    parentPort.postMessage(err ? { error: err.message } : { result });
  });
`;

const entry = require.resolve('../lib/index');

test('the addon loads and detects inside a worker_thread', async () => {
  const out = await inWorker(DETECT_IN_WORKER, {
    entry,
    file: path.join(FIXTURES, 'png.png'),
  });
  assert.strictEqual(out.error, undefined, `worker reported: ${out.error}`);
  assert.strictEqual(out.result, 'image/png');
});

test('main thread and worker agree on the same file', async () => {
  const file = path.join(FIXTURES, 'csv.csv');

  const mainResult = await new Promise((resolve, reject) => {
    new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(file, (e, r) =>
      e ? reject(e) : resolve(r));
  });

  const workerOut = await inWorker(DETECT_IN_WORKER, { entry, file });

  assert.strictEqual(mainResult, 'text/csv');
  assert.strictEqual(workerOut.result, mainResult);
});

test('several workers can use the addon concurrently', async () => {
  // Each thread constructs its own addon instance and its own fallback path.
  // Under the old file-scope-global implementation this was a data race even
  // when it did not outright fail to load.
  const cases = [
    ['png.png', 'image/png'],
    ['jpg.jpg', 'image/jpeg'],
    ['zip.zip', 'application/zip'],
    ['pdf.pdf', 'application/pdf'],
    ['text.txt', 'text/plain'],
    ['csv.csv', 'text/csv'],
  ];

  const results = await Promise.all(cases.map(([file]) =>
    inWorker(DETECT_IN_WORKER, { entry, file: path.join(FIXTURES, file) })));

  results.forEach((out, i) => {
    const [file, expected] = cases[i];
    assert.strictEqual(out.error, undefined,
      `worker for ${file} reported: ${out.error}`);
    assert.strictEqual(out.result, expected, `${file} in worker`);
  });
});

test('a worker that only requires the addon exits cleanly', async () => {
  // Guards addon teardown: instance data is freed when the Agent goes away, and
  // getting that wrong shows up as a crash or a hang on worker exit rather than
  // a failed assertion.
  await inWorker(`
    const { parentPort, workerData } = require('node:worker_threads');
    require(workerData.entry);
    parentPort.postMessage({ ok: true });
  `, { entry });
});
