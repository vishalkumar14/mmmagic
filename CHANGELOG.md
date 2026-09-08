# Changelog

All notable changes to this package are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] — 2026-09-09

Upgrades the bundled libmagic from **5.32 (2018) to 5.48**, sixteen releases
ahead. **This changes what some files are detected as**, so it is a major
version. No JavaScript function changed — `detectFile` and `detect` work
exactly as before.

### Why

libmagic 5.32 has no CSV parser. A `.csv` file fell through to the generic
text heuristics and came back `text/plain`, which meant **any text file passed
as CSV** — rename `notes.txt` to `data.csv` and it was accepted. 5.48 adds a
real CSV parser, so the answer means something.

### Changed — detection results

If your code compares the result against a fixed string, check this table.

| File | Before (5.32) | After (5.48) |
|---|---|---|
| CSV files | `text/plain` | **`text/csv`** |
| JSON files | `text/plain` | **`application/json`** |
| BMP images | `image/x-ms-bmp` | **`image/bmp`** |
| ICO icons | `image/x-icon` | **`image/vnd.microsoft.icon`** |
| gzip archives | `application/x-gzip` | **`application/gzip`** |
| tar, encoding only | `application/x-tarbinary` | **`binary`** |

Everything else is unchanged — PNG, JPEG, GIF, TIFF, WebP, PDF, ZIP, XML,
HTML, SVG, the Office formats and OpenDocument all report what they did
before. MIME **encodings** (`us-ascii`, `utf-8`, `utf-16le`, `binary`) are
unchanged throughout.

Two things worth knowing:

- **Semicolon-delimited CSV is still `text/plain`.** 5.48 does not recognise
  it either. If you accept European-style CSV, you still need to handle that.
- **The tar change is a bug fix.** Asking for only the encoding used to leak
  the type into the answer, producing the run-together `application/x-tarbinary`.
  It now correctly returns `binary`.

### Migration

If you compare against `'text/plain'` for CSV uploads, you have two options.

**Accept the new value** — recommended, since this is the behaviour you
actually wanted:

```javascript
const type = await magic.detectFile(path);
if (type !== 'text/csv') throw new Error('not a CSV');
```

**Or keep the old behaviour** while you migrate. libmagic has a flag for
exactly this, so no code of ours has to translate anything:

```javascript
const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE | mmm.MAGIC_NO_CHECK_CSV);
await magic.detectFile('data.csv');   // 'text/plain', as in 1.x
```

`MAGIC_NO_CHECK_JSON` does the same for JSON.

### Added

- `MAGIC_NO_CHECK_CSV` — skip the CSV parser
- `MAGIC_NO_CHECK_JSON` — skip the JSON parser
- `MAGIC_NO_CHECK_SIMH` — skip SIMH tape detection

### Other

- The compiled magic database is rebuilt for 5.48's format (`VERSIONNO` 14 → 21;
  the old one cannot be loaded at all). It grows from 4.9 MB to 10.8 MB, about
  **216 KB more on the wire** once compressed.
- `seccomp.c` and `landlock.c` are not vendored. They install Linux sandbox
  policies, which an addon loaded into someone else's process should not do.
- FreeBSD, OpenBSD and SunOS build configs are updated on a best-effort basis
  and are unverified — this package ships binaries for macOS, Linux and Windows
  only.

---

## [1.0.1] — 2026-09-08

Documentation only. No code, binary, or behaviour change.

### Fixed

- Disclosed the vendored third-party licences. `LICENSE` and the README now
  state that `deps/libmagic` is BSD-2-Clause and that
  `deps/libmagic/msvc/libgnurx-2.5` is **LGPL-2.1-or-later**, where previously
  only MIT was declared.

  The LGPL component supplies POSIX regex, which the Microsoft C runtime
  lacks, so it is compiled **only into the Windows binaries**. The macOS and
  Linux binaries contain no LGPL code. The complete source ships in the
  tarball, so the Windows binary can be relinked with `npm rebuild`, which is
  what LGPL-2.1 §6 requires.

---

## [1.0.0] — 2026-09-08

First public release.

### Added

- **Prebuilt binaries for 9 platforms**, so installing needs no C++ compiler,
  Python, or `node-gyp`:

  | Platform | Architectures |
  |---|---|
  | macOS | arm64, x64 |
  | Linux | x64, arm64 — glibc and musl each |
  | Windows | x64, arm64, ia32 |

- **Promise support.** `detectFile()` and `detect()` return a Promise when no
  callback is given, and still accept callbacks.
- **`worker_threads` support.** The addon loads and runs inside workers.

### Changed

- **Ported from NAN to Node-API.** One binary per platform now serves every
  Node version from 18 onward, so upgrading Node needs no rebuild and no
  reinstall. Previously a new Node major broke installs until new binaries
  shipped.
- Requires Node 18 or newer.

### Notes

- Bundles libmagic 5.32.
- Platforms without a prebuilt binary still work — they compile from source at
  install time, which needs Python 3 and a C++ compiler.

[2.0.0]: https://github.com/vishalkumar14/mmmagic/releases/tag/v2.0.0
[1.0.1]: https://github.com/vishalkumar14/mmmagic/releases/tag/v1.0.1
[1.0.0]: https://github.com/vishalkumar14/mmmagic/releases/tag/v1.0.0
