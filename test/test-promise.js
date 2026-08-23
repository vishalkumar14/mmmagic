'use strict';

// Promise / async-await support.
//
// The contract has two halves and both matter:
//   1. Omitting the callback returns a Promise.
//   2. Passing a callback changes NOTHING -- same results, same return values.
//
// The second half is what makes this safe to ship: every existing call site in
// the API service and the batch workers uses the callback form and must be unaffected.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Worker } = require('node:worker_threads');

const mmm = require('../lib/index');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (f) => path.join(FIXTURES, f);

const CASES = [
  ['text.txt', 'text/plain'],
  ['csv.csv',  'text/plain'],
  ['png.png',  'image/png'],
  ['jpg.jpg',  'image/jpeg'],
  ['zip.zip',  'application/zip'],
  ['pdf.pdf',  'application/pdf'],
];

// --- half one: the promise form ---------------------------------------------

test('detectFile without a callback returns a Promise', () => {
  const p = new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(fixture('png.png'));
  assert.ok(p instanceof Promise);
  return p;
});

test('detect without a callback returns a Promise', () => {
  const buf = fs.readFileSync(fixture('png.png'));
  const p = new mmm.Magic(mmm.MAGIC_MIME_TYPE).detect(buf);
  assert.ok(p instanceof Promise);
  return p;
});

test('awaited detectFile gives the expected type for each fixture', async () => {
  for (const [file, mime] of CASES) {
    assert.strictEqual(
      await new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(fixture(file)), mime);
  }
});

test('awaited detect(Buffer) gives the expected type for each fixture', async () => {
  for (const [file, mime] of CASES) {
    const buf = fs.readFileSync(fixture(file));
    assert.strictEqual(
      await new mmm.Magic(mmm.MAGIC_MIME_TYPE).detect(buf), mime);
  }
});

test('MAGIC_MIME and MAGIC_CONTINUE work through the promise form', async () => {
  const magic = new mmm.Magic(mmm.MAGIC_MIME);
  assert.strictEqual(await magic.detectFile(fixture('png.png')),
    'image/png; charset=binary');

  const multi = new mmm.Magic(mmm.MAGIC_MIME_TYPE | mmm.MAGIC_CONTINUE);
  const res = await multi.detectFile(fixture('zip.zip'));
  assert.ok(Array.isArray(res), 'MAGIC_CONTINUE must still yield an array');
  assert.strictEqual(res[0], 'application/zip');
});

// --- error handling ---------------------------------------------------------

test('a missing file rejects rather than resolving', async () => {
  await assert.rejects(
    new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile('/no/such/path-9876'),
    (err) => err instanceof Error && /cannot stat|No such file|opening file/i.test(err.message));
});

test('bad argument types reject instead of throwing synchronously', async () => {
  // The addon throws a TypeError synchronously. A promise-returning function
  // must not do that, so the executor converts it into a rejection.
  const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);

  await assert.rejects(magic.detectFile(12345), /First argument must be a string/);
  await assert.rejects(magic.detect('not a buffer'), /First argument must be a Buffer/);

  // And confirm it really is a rejection, not a throw: reaching this line at
  // all proves nothing escaped synchronously.
  assert.ok(true);
});

// --- half two: the callback form is untouched -------------------------------

test('callback form still delivers results', (t, done) => {
  const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);
  magic.detectFile(fixture('png.png'), (err, result) => {
    assert.strictEqual(err, null);
    assert.strictEqual(result, 'image/png');
    done();
  });
});

test('callback form preserves the original return values', (t, done) => {
  const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);

  // detectFile returned undefined before promises existed; detect returned
  // `this`. Both are quirks, both are load-bearing for anyone who relied on
  // them, so both are preserved.
  const rFile = magic.detectFile(fixture('png.png'), () => {
    const rBuf = magic.detect(Buffer.from('hello'), () => {
      assert.strictEqual(rFile, undefined, 'detectFile should return undefined');
      assert.strictEqual(rBuf, magic, 'detect should return this');
      done();
    });
  });
});

test('callback errors still arrive as the first argument', (t, done) => {
  new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile('/no/such/path-9876', (err, result) => {
    assert.ok(err instanceof Error);
    assert.strictEqual(result, undefined);
    done();
  });
});

// --- the subclass must not disturb anything else ---------------------------

test('every constructor overload still works', async () => {
  const mgc = path.join(__dirname, '..', 'magic', 'magic.mgc');
  const buf = fs.readFileSync(mgc);

  // no args / flags only
  assert.match(await new mmm.Magic().detectFile(fixture('png.png')), /^PNG image data/);
  assert.strictEqual(
    await new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(fixture('png.png')), 'image/png');

  // explicit magic-file path, with and without flags
  assert.strictEqual(
    await new mmm.Magic(mgc, mmm.MAGIC_MIME_TYPE).detectFile(fixture('png.png')), 'image/png');

  // magic database supplied as a Buffer
  assert.strictEqual(
    await new mmm.Magic(buf, mmm.MAGIC_MIME_TYPE).detectFile(fixture('png.png')), 'image/png');

  // `false` = let libmagic search for its own database
  const viaSearch = new mmm.Magic(false, mmm.MAGIC_MIME_TYPE);
  assert.strictEqual(typeof await viaSearch.detectFile(fixture('png.png')), 'string');
});

test('instanceof still identifies a Magic', () => {
  assert.ok(new mmm.Magic(mmm.MAGIC_MIME_TYPE) instanceof mmm.Magic);
});

test('all 20 MAGIC_* constants are still exported', () => {
  const names = Object.keys(mmm).filter((k) => k.startsWith('MAGIC_'));
  assert.strictEqual(names.length, 20);
  assert.strictEqual(mmm.MAGIC_MIME, mmm.MAGIC_MIME_TYPE | mmm.MAGIC_MIME_ENCODING);
});

// --- concurrency and non-blocking ------------------------------------------

test('Promise.all runs detections concurrently', async () => {
  const results = await Promise.all(
    CASES.map(([f]) => new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(fixture(f))));
  assert.deepStrictEqual(results, CASES.map(([, m]) => m));
});

test('the main thread is not blocked while detection runs',
  { timeout: 120000 }, async (t) => {
    // Regression guard for the property people assume promises give them and
    // that this addon already had: work happens on the libuv threadpool.
    // If detection ever moved onto the main thread, the interval below would
    // stop firing.
    const big = path.join(os.tmpdir(), `mmm-nonblock-${process.pid}.csv`);
    fs.writeFileSync(big, 'a,b,c\n1,2,3\n'.repeat(3000000));
    t.after(() => { try { fs.unlinkSync(big); } catch { /* gone */ } });

    let ticks = 0;
    const iv = setInterval(() => { ticks++; }, 1);
    try {
      const results = await Promise.all(Array.from({ length: 6 },
        () => new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(big)));
      assert.deepStrictEqual(results, Array(6).fill('text/plain'));
    } finally {
      clearInterval(iv);
    }
    assert.ok(ticks > 0,
      'the event loop never ticked during detection - the main thread was blocked');
  });

test('the promise form works inside a worker_thread', async () => {
  const out = await new Promise((resolve, reject) => {
    const w = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const mmm = require(workerData.entry);
      (async () => {
        try {
          parentPort.postMessage({
            result: await new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(workerData.file)
          });
        } catch (e) { parentPort.postMessage({ error: e.message }); }
      })();
    `, {
      eval: true,
      workerData: { entry: require.resolve('../lib/index'), file: fixture('png.png') },
    });
    let msg;
    w.on('message', (m) => { msg = m; });
    w.on('error', reject);
    w.on('exit', (code) => code === 0 ? resolve(msg) : reject(new Error(`exit ${code}`)));
  });
  assert.strictEqual(out.error, undefined, `worker reported: ${out.error}`);
  assert.strictEqual(out.result, 'image/png');
});
