'use strict';

// Guards the one deliberate edit inside the vendored libmagic sources.
//
// deps/libmagic/src/apprentice.c:apprentice_load() upstream does:
//
//     ms->flags |= MAGIC_CHECK;   /* Enable checks for parsed files */
//
// and never clears it. That is right for the `file` command -- you asked it to
// read your magic file, so you want to hear about mistakes in it. It is wrong
// for a library loaded into someone else's process: libmagic starts writing
// parse warnings to the host's stderr, and funcs.c:768 promotes a regex that
// fails to compile from a skipped entry to a hard error.
//
// The line has been commented out since the original 0.5.5 import. It cannot
// live in config/win/config.h or a shim like the other local changes, so it is
// the single edit that a wholesale `deps/libmagic/src` refresh will silently
// undo -- which is exactly what happened during the 5.32 -> 5.48 upgrade, and
// why this test exists. If it fails after a libmagic bump, re-apply the patch
// rather than adjusting the expectation.
//
// Only reachable when a caller supplies their own *text* magic file. The
// bundled magic.mgc takes the mmap path and never enters apprentice_load().

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENTRY = path.join(__dirname, '..', 'lib', 'index.js');

// Two bad entries. The first is reported through a MAGIC_CHECK-gated call site
// and must stay silent; the second goes through file_magwarn(), which writes to
// stderr unconditionally in both 5.32 and 5.48, so it is expected either way and
// is what keeps this test honest about what the patch does and does not cover.
const MAGIC_FILE_BODY =
  '0\tnosuchtype\tx\tbogus\n' +
  '0\tbelong\tnotanumber\talso bogus\n' +
  '0\tstring\tPK\x03\x04\tZip archive\n';

test('a caller-supplied magic file does not enable MAGIC_CHECK', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-magiccheck-'));
  const magicFile = path.join(dir, 'custom-magic');
  const target = path.join(dir, 'target.txt');
  fs.writeFileSync(magicFile, MAGIC_FILE_BODY);
  fs.writeFileSync(target, 'hello world\n');

  const script = `
    const mmm = require(${JSON.stringify(ENTRY)});
    new mmm.Magic(${JSON.stringify(magicFile)}, mmm.MAGIC_MIME_TYPE)
      .detectFile(${JSON.stringify(target)}, (e, r) => {
        if (e) { console.error('DETECT_ERROR: ' + e.message); process.exit(1); }
        process.stdout.write(String(r));
      });
  `;

  let stdout = '';
  let stderr = '';
  try {
    const res = spawnSync(
      process.execPath, ['-e', script], { encoding: 'utf8' });
    stdout = res.stdout || '';
    stderr = res.stderr || '';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // Detection itself must still work.
  assert.strictEqual(stdout, 'text/plain',
    'detection should succeed with a caller-supplied magic file');

  // The MAGIC_CHECK-gated warning must NOT appear. Its presence means the
  // apprentice.c patch was lost -- most likely by a libmagic vendor refresh.
  assert.ok(!/type .*invalid/.test(stderr),
    'MAGIC_CHECK appears to be enabled: libmagic reported an invalid type on ' +
    'stderr. Re-apply the commented-out `ms->flags |= MAGIC_CHECK;` patch in ' +
    'deps/libmagic/src/apprentice.c:apprentice_load().\nstderr was:\n' + stderr);

  // A regex that fails to compile must stay a skipped entry, not a hard error.
  assert.ok(!/regex error/.test(stderr),
    'MAGIC_CHECK turned a regex compile failure into a hard error.\nstderr was:\n'
    + stderr);
});
