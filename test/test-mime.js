'use strict';

// MIME-detection coverage for representative file types.
//
// Expected values are those produced by the libmagic bundled in deps/ (5.32).
// They are asserted strictly on purpose: if deps/libmagic is ever upgraded,
// some of these legitimately change (e.g. 5.35+ classifies JSON as
// application/json and 5.38+ classifies CSV as text/csv) and we want that to
// fail loudly rather than silently alter what callers receive.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const mmm = require('../lib/index');

const FIXTURES = path.join(__dirname, 'fixtures');

const detectFile = (file, flags) =>
  new Promise((resolve, reject) => {
    new mmm.Magic(flags).detectFile(path.join(FIXTURES, file), (err, res) =>
      err ? reject(err) : resolve(res));
  });

const detectBuffer = (buf, flags) =>
  new Promise((resolve, reject) => {
    new mmm.Magic(flags).detect(buf, (err, res) =>
      err ? reject(err) : resolve(res));
  });

// file -> [expected mime type, expected mime encoding]
const CASES = [
  // Signature-free text. These are the important ones: a normal text or CSV
  // file has no magic bytes, so it is classified purely by libmagic's text
  // heuristics. It must not fail or come back as a binary type.
  ['text.txt',  'text/plain',       'us-ascii'],
  ['csv.csv',   'text/plain',       'us-ascii'],
  ['json.json', 'text/plain',       'us-ascii'],
  // Text with a recognised structure.
  ['xml.xml',   'text/xml',         'us-ascii'],
  // Binary formats, detected by signature.
  ['pdf.pdf',   'application/pdf',  'us-ascii'],
  ['png.png',   'image/png',        'binary'],
  ['jpg.jpg',   'image/jpeg',       'binary'],
  ['zip.zip',   'application/zip',  'binary'],
];

test('MAGIC_MIME_TYPE returns the expected type for each fixture', async () => {
  for (const [file, mime] of CASES) {
    assert.strictEqual(await detectFile(file, mmm.MAGIC_MIME_TYPE), mime,
      `${file} should be detected as ${mime}`);
  }
});

test('MAGIC_MIME_ENCODING returns the expected encoding', async () => {
  for (const [file, , encoding] of CASES) {
    assert.strictEqual(await detectFile(file, mmm.MAGIC_MIME_ENCODING), encoding,
      `${file} should report encoding ${encoding}`);
  }
});

test('MAGIC_MIME combines type and encoding', async () => {
  for (const [file, mime, encoding] of CASES) {
    assert.strictEqual(await detectFile(file, mmm.MAGIC_MIME),
      `${mime}; charset=${encoding}`);
  }
});

test('buffer detection agrees with file detection', async () => {
  for (const [file, mime] of CASES) {
    const buf = fs.readFileSync(path.join(FIXTURES, file));
    assert.strictEqual(await detectBuffer(buf, mmm.MAGIC_MIME_TYPE), mime,
      `${file} via detect(Buffer) should be ${mime}`);
  }
});

test('default flags return a human-readable description', async () => {
  const desc = await detectFile('png.png', mmm.MAGIC_NONE);
  assert.match(desc, /^PNG image data/);
});

test('MAGIC_CONTINUE returns an array of matches', async () => {
  const res = await detectFile('zip.zip',
    mmm.MAGIC_MIME_TYPE | mmm.MAGIC_CONTINUE);
  assert.ok(Array.isArray(res), 'expected an array of matches');
  assert.strictEqual(res[0], 'application/zip');
});

test('an empty file is classified, not an error', async () => {
  const empty = path.join(FIXTURES, 'empty.tmp');
  fs.writeFileSync(empty, '');
  try {
    // libmagic 5.32 reports inode/x-empty; 5.37+ renamed this to
    // application/x-empty. Bundled version decides.
    assert.strictEqual(await detectFile('empty.tmp', mmm.MAGIC_MIME_TYPE),
      'inode/x-empty');
  } finally {
    fs.unlinkSync(empty);
  }
});

test('a nonexistent path yields an Error, not a throw', async () => {
  await assert.rejects(detectFile('does-not-exist-1234', mmm.MAGIC_MIME_TYPE),
    /./);
});

test('UTF-8 filenames are handled', async () => {
  // Fixture carries an accented character; upstream regression test.
  const res = await detectFile('tést.txt', mmm.MAGIC_MIME_TYPE);
  assert.strictEqual(typeof res, 'string');
  assert.ok(res.length > 0);
});
