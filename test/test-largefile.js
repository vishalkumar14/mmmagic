'use strict';

// Phase 6: large-file behaviour.
//
// detectFile() must not pull the whole file into memory. libmagic caps itself
// at FILE_BYTES_MAX (deps/libmagic/src/file.h -> 1 MiB): magic_file() mallocs
// bytes_max + SLOP and read()s at most that much from the descriptor, so a
// 100 MB CSV costs the same as a 1 KB one.
//
// This test proves that empirically by watching RSS across the call, and
// contrasts it with the detect(Buffer) path which necessarily does hold the
// whole payload.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const mmm = require('../lib/index');

// Overridable so CI can trade fidelity for speed.
const SIZE_MB = Number(process.env.MMMAGIC_LARGE_FIXTURE_MB || 120);
// libmagic reads <= 1 MiB; allow generous headroom for V8/GC noise while
// staying far below the file size.
const RSS_BUDGET_MB = 32;

const tmpFile = path.join(os.tmpdir(), `mmmagic-large-${process.pid}.csv`);

function writeLargeCsv(file, sizeMb) {
  const target = sizeMb * 1024 * 1024;
  const fd = fs.openSync(file, 'w');
  try {
    fs.writeSync(fd, 'order_id,outlet,item,qty,amount\n');
    // ~1 MiB chunk of ordinary CSV rows, written repeatedly.
    const rows = [];
    for (let i = 0; i < 16384; i++) {
      rows.push(`ORD${String(i).padStart(8, '0')},Koramangala,Masala Dosa,${i % 4 + 1},${i * 60}.00`);
    }
    const chunk = Buffer.from(rows.join('\n') + '\n');
    let written = 0;
    while (written < target) {
      fs.writeSync(fd, chunk);
      written += chunk.length;
    }
  } finally {
    fs.closeSync(fd);
  }
}

const rssMb = () => process.memoryUsage().rss / (1024 * 1024);

const detectFile = (file, flags) =>
  new Promise((resolve, reject) => {
    new mmm.Magic(flags).detectFile(file, (err, res) =>
      err ? reject(err) : resolve(res));
  });

test(`detectFile on a ${SIZE_MB} MB CSV stays under ${RSS_BUDGET_MB} MB RSS growth`,
  { timeout: 300000 }, async (t) => {
    writeLargeCsv(tmpFile, SIZE_MB);
    t.after(() => { try { fs.unlinkSync(tmpFile); } catch { /* already gone */ } });

    const actualMb = fs.statSync(tmpFile).size / (1024 * 1024);
    assert.ok(actualMb >= SIZE_MB, `fixture should be >= ${SIZE_MB} MB`);

    // Warm the addon so first-load allocations are not counted below.
    await detectFile(tmpFile, mmm.MAGIC_MIME_TYPE);

    const before = rssMb();
    const started = Date.now();
    const result = await detectFile(tmpFile, mmm.MAGIC_MIME_TYPE);
    const elapsed = Date.now() - started;
    const grew = rssMb() - before;

    console.log(`    fixture ${actualMb.toFixed(1)} MB | RSS +${grew.toFixed(1)} MB | ${elapsed} ms | ${result}`);

    // The whole point: a signature-free 100 MB+ CSV is still text/plain.
    assert.strictEqual(result, 'text/plain');
    assert.ok(grew < RSS_BUDGET_MB,
      `detectFile grew RSS by ${grew.toFixed(1)} MB (budget ${RSS_BUDGET_MB} MB) — ` +
      'it looks like the whole file is being read into memory');
  });

test('detect(Buffer) is the path that does hold the whole payload',
  { timeout: 300000 }, async (t) => {
    // Contrast case, and a sensitivity check on the RSS measurement above:
    // if this did not grow, the previous assertion would prove nothing.
    writeLargeCsv(tmpFile, SIZE_MB);
    t.after(() => { try { fs.unlinkSync(tmpFile); } catch { /* already gone */ } });

    const before = rssMb();
    const buf = fs.readFileSync(tmpFile);
    const grew = rssMb() - before;

    console.log(`    readFileSync(${SIZE_MB} MB) | RSS +${grew.toFixed(1)} MB`);
    assert.ok(grew > RSS_BUDGET_MB,
      'reading the file into a Buffer should visibly grow RSS; if it does not, ' +
      'the RSS-based assertion in the previous test is not measuring anything');

    const result = await new Promise((resolve, reject) => {
      new mmm.Magic(mmm.MAGIC_MIME_TYPE).detect(buf, (e, r) => e ? reject(e) : resolve(r));
    });
    assert.strictEqual(result, 'text/plain');
  });
