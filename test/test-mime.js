'use strict';

// MIME-detection coverage for representative file types.
//
// ---------------------------------------------------------------------------
// EVERY EXPECTATION HERE IS PINNED TO THE BUNDLED libmagic 5.32 (deps/libmagic).
//
// They are asserted strictly on purpose. libmagic 5.32 is from 2018, and it is
// deliberately not upgraded, because a newer libmagic *changes return values
// that callers already depend on*. If you bump the bundled version, these
// tests are designed to fail loudly rather than let the change reach consumers
// silently. Known differences you would have to accept:
//
//   * 5.35+  classifies JSON as application/json, not text/plain
//   * 5.38+  classifies CSV  as text/csv,         not text/plain
//   * newer releases also add/rename Office, archive and image types, and some
//     of the legacy `x-` spellings below become the registered names
//     (image/x-ms-bmp -> image/bmp, application/x-gzip -> application/gzip)
//
// So: to FIX any wrong answer recorded in this file -- including the tar
// encoding bug pinned at the bottom -- you must increase the libmagic version
// in deps/libmagic and then update these expectations together, as one change.
// There is no way to fix the detection results without that upgrade; the
// answers come from libmagic's magic database and C source, not from this
// addon.
// ---------------------------------------------------------------------------
//
// The synthesized binary fixtures (Office, images, archives) are produced by
// `python3 scripts/make-fixtures.py`, which is byte-deterministic. Regenerating
// them must produce no diff.

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
//
// tar.tar is deliberately absent: its MAGIC_MIME_ENCODING answer is broken
// upstream, so it gets its own tests at the bottom of this file.
const CASES = [
  // -- Signature-free text -------------------------------------------------
  // The important ones for us: a plain text or CSV upload has no magic bytes,
  // so it is classified purely by libmagic's text heuristics. It must not fail
  // and must not come back as a binary type.
  ['text.txt',          'text/plain',      'us-ascii'],
  ['csv.csv',           'text/plain',      'us-ascii'],
  ['json.json',         'text/plain',      'us-ascii'],

  // -- CSV variants --------------------------------------------------------
  // Line endings, byte-order marks, encodings and quoting must not change the
  // type, only the reported encoding. csv-crlf/csv-utf16/csv-utf8-bom are held
  // byte-exact by .gitattributes; without that the eol=lf rule would rewrite
  // them and these assertions would silently start testing nothing.
  ['csv-crlf.csv',      'text/plain',      'us-ascii'],
  ['csv-utf8-bom.csv',  'text/plain',      'utf-8'],
  ['csv-utf16.csv',     'text/plain',      'utf-16le'],
  ['csv-semicolon.csv', 'text/plain',      'us-ascii'],
  ['csv-quoted.csv',    'text/plain',      'us-ascii'],
  ['csv-numeric.csv',   'text/plain',      'us-ascii'],

  // -- Text with a recognised structure ------------------------------------
  ['xml.xml',           'text/xml',        'us-ascii'],
  ['html.html',         'text/html',       'us-ascii'],
  ['svg.svg',           'image/svg+xml',   'us-ascii'],

  // -- Documents -----------------------------------------------------------
  ['pdf.pdf',           'application/pdf', 'us-ascii'],

  // -- Images, detected by signature ---------------------------------------
  // gif87a as well as gif89a: both header versions must resolve to image/gif.
  ['png.png',           'image/png',       'binary'],
  ['jpg.jpg',           'image/jpeg',      'binary'],
  ['gif89a.gif',        'image/gif',       'binary'],
  ['gif87a.gif',        'image/gif',       'binary'],
  ['bmp.bmp',           'image/x-ms-bmp',  'binary'],
  ['tiff.tif',          'image/tiff',      'binary'],
  ['webp.webp',         'image/webp',      'binary'],
  ['ico.ico',           'image/x-icon',    'binary'],

  // -- Office: OOXML -------------------------------------------------------
  // These are zip containers. libmagic only reaches the specific type because
  // [Content_Types].xml is the FIRST zip entry; a package that orders its
  // entries differently is only detectable as application/zip. Real Office
  // writes it first, but not every generator does -- so do not rely on this
  // alone to validate a spreadsheet upload.
  ['xlsx.xlsx',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   'binary'],
  ['docx.docx',
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
   'binary'],
  ['pptx.pptx',
   'application/vnd.openxmlformats-officedocument.presentationml.presentation',
   'binary'],

  // -- Office: ODF ---------------------------------------------------------
  // ODF is also a zip, but carries its media type verbatim in a STORED first
  // entry named `mimetype`, which is what libmagic reads.
  ['ods.ods', 'application/vnd.oasis.opendocument.spreadsheet', 'binary'],
  ['odt.odt', 'application/vnd.oasis.opendocument.text',        'binary'],

  // -- Archives ------------------------------------------------------------
  ['zip.zip',           'application/zip',    'binary'],
  ['gzip.gz',           'application/x-gzip', 'binary'],
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

test('detection is driven by content, not by the file extension', async () => {
  // Upload validation depends on this: a renamed file must not be believed.
  const png = fs.readFileSync(path.join(FIXTURES, 'png.png'));
  const csv = fs.readFileSync(path.join(FIXTURES, 'csv.csv'));
  const lying = path.join(FIXTURES, 'lying-name.tmp');

  fs.writeFileSync(lying, png);
  try {
    assert.strictEqual(
      await new Promise((res, rej) => new mmm.Magic(mmm.MAGIC_MIME_TYPE)
        .detectFile(lying, (e, r) => (e ? rej(e) : res(r)))),
      'image/png', 'PNG bytes under a .tmp name are still image/png');

    fs.writeFileSync(lying, csv);
    assert.strictEqual(
      await new Promise((res, rej) => new mmm.Magic(mmm.MAGIC_MIME_TYPE)
        .detectFile(lying, (e, r) => (e ? rej(e) : res(r)))),
      'text/plain', 'CSV bytes under a .tmp name are still text/plain');
  } finally {
    fs.unlinkSync(lying);
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

test('an empty Buffer cannot use the stat layer, unlike an empty file',
  async () => {
    // Not a bug and not platform-specific: inode/* answers come from
    // libmagic's fsmagic, which stats a path. A Buffer has no path, so the
    // same emptiness is reported from content instead.
    assert.strictEqual(
      await detectBuffer(Buffer.alloc(0), mmm.MAGIC_MIME_TYPE),
      'application/x-empty');
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

// ---------------------------------------------------------------------------
// tar: an upstream libmagic bug, pinned so a version bump surfaces it.
// ---------------------------------------------------------------------------
//
// deps/libmagic/src/is_tar.c:70 does:
//
//     int mime = ms->flags & MAGIC_MIME;
//
// MAGIC_MIME is (MAGIC_MIME_TYPE|MAGIC_MIME_ENCODING), so that test is true
// when EITHER bit is set. Asking for only the encoding therefore still makes
// is_tar() emit the *type*, and funcs.c then appends the encoding without the
// "; charset=" separator it only adds when MAGIC_MIME_TYPE is also set. Result:
// the single run-together token asserted below.
//
// The correct idiom is the one softmagic.c:2054 uses -- gate on
// MAGIC_MIME_TYPE specifically. is_tar.c has no platform conditionals, so this
// reproduces identically on Linux, macOS and Windows; it is not a Windows or
// Node-API artifact.
//
// TO FIX THIS you must increase the bundled libmagic version in
// deps/libmagic (patching the vendored copy in place would be overwritten by
// the next vendor refresh). When you do, this test will fail -- that is the
// point. Replace the expectation with 'binary' at that time, and expect the
// JSON/CSV expectations above to need updating in the same change.
test('tar reports the correct type and combined MIME', async () => {
  assert.strictEqual(await detectFile('tar.tar', mmm.MAGIC_MIME_TYPE),
    'application/x-tar');
  // Both bits set is the well-behaved path, so the separator is present.
  assert.strictEqual(await detectFile('tar.tar', mmm.MAGIC_MIME),
    'application/x-tar; charset=binary');
});

test('KNOWN BUG (libmagic 5.32): MAGIC_MIME_ENCODING alone on tar leaks the type',
  async () => {
    // Expected once fixed: 'binary'. See the comment block above -- fixing
    // this requires bumping the bundled libmagic version.
    assert.strictEqual(await detectFile('tar.tar', mmm.MAGIC_MIME_ENCODING),
      'application/x-tarbinary');
  });
