# @vishalkumar14/mmmagic

Detect what a file **actually is** by looking at its contents, not its name.

It wraps **libmagic** — the same library behind the Unix `file` command — as a
native Node addon, built for current Node.js.

```javascript
const mmm = require('@vishalkumar14/mmmagic');

const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);
const type  = await magic.detectFile('/tmp/upload.csv');
// 'text/csv'
```

**Why content and not the extension?** Because a user can rename `virus.exe` to
`invoice.csv` and your extension check will believe them. mmmagic reads the bytes.

**Why not `file-type` or `isbinaryfile`?** They match magic-byte signatures. A
plain text or CSV file has no signature at all, so they cannot classify it.
libmagic parses the content instead — a CSV comes back `text/csv` only if it
really parses as CSV, so a `.txt` renamed to `.csv` does not slip through.

---

## Contents

- [Install](#install) · [Do I need a compiler?](#do-i-need-a-compiler)
- [Quick start](#quick-start) · [Examples](#examples)
- [What gets detected](#what-gets-detected)
- [API](#api) · [Flags](#flags)
- [Compatibility](#compatibility): [Node](#node-versions) · [Platforms](#platforms)
- [Requirements](#requirements-for-building-from-source)
- [Versions](#whats-inside)
- [Limitations](#limitations--known-issues)

---

## Install

```bash
npm install @vishalkumar14/mmmagic
```

### Do I need a compiler?

**Usually no.** The package ships prebuilt binaries for common platforms. On
those, install just copies a file into place.

| Situation | Compiler needed? |
|---|---|
| Installing on a platform we ship a binary for | **No** |
| Installing on any other platform | Yes — it builds from source |
| Working from a git clone of this repo | Yes — `prebuilds/` is not committed |

Prebuilt binaries are shipped for:

```
macOS      arm64 (Apple Silicon), x64 (Intel)
Linux      x64, arm64   — both glibc and musl (Alpine)
Windows    x64, arm64, x86 (32-bit)
```

Because this is a **Node-API** addon, *one binary per platform works on every
Node version.* Upgrading Node does not require a reinstall or rebuild.

If you do need to build, see [Requirements](#requirements-for-building-from-source).

---

## Quick start

```javascript
const mmm = require('@vishalkumar14/mmmagic');

// Create a detector. The flag decides what kind of answer you get back.
const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);

// Promise style
const type = await magic.detectFile('/tmp/photo.png');   // 'image/png'

// Callback style — still fully supported
magic.detectFile('/tmp/photo.png', (err, type) => {
  if (err) throw err;
  console.log(type);                                     // 'image/png'
});
```

One detector can be reused for many files. Create a new one when you want
different flags.

---

## Examples

### 1. MIME type of a file

```javascript
const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);
await magic.detectFile('/tmp/report.pdf');    // 'application/pdf'
```

### 2. Text encoding instead of type

```javascript
const magic = new mmm.Magic(mmm.MAGIC_MIME_ENCODING);
await magic.detectFile('/tmp/data.csv');      // 'us-ascii'
await magic.detectFile('/tmp/utf16.csv');     // 'utf-16le'
```

### 3. Both at once

```javascript
const magic = new mmm.Magic(mmm.MAGIC_MIME);  // TYPE | ENCODING
await magic.detectFile('/tmp/data.csv');      // 'text/csv; charset=us-ascii'
```

### 4. Human-readable description (the default)

```javascript
const magic = new mmm.Magic();                // no flags
await magic.detectFile('/tmp/photo.png');
// 'PNG image data, 1 x 1, 8-bit/color RGBA, non-interlaced'
```

### 5. Detect from a Buffer instead of a path

```javascript
const buf = fs.readFileSync('/tmp/photo.png');
const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);
await magic.detect(buf);                      // 'image/png'
```

> Prefer `detectFile` for files on disk — see
> [large files](#large-files-are-cheap).

### 6. All matches, not just the best one

```javascript
const magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE | mmm.MAGIC_CONTINUE);
await magic.detectFile('/tmp/archive.zip');
// ['application/zip', ...]      <- an Array, not a String
```

### 7. Many files at once

Detection runs on Node's threadpool, so these genuinely overlap:

```javascript
const types = await Promise.all(
  files.map((f) => new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(f)));
```

### 8. Handling errors

```javascript
// Promise style — rejects
try {
  await magic.detectFile('/no/such/file');
} catch (err) {
  // Error: cannot stat `/no/such/file' (No such file or directory)
}

// Callback style — error is the first argument
magic.detectFile('/no/such/file', (err, type) => {
  if (err) { /* handle */ }
});
```

Passing the wrong argument type also rejects rather than throwing:

```javascript
await magic.detectFile(12345);   // rejects: First argument must be a string
```

### 9. Validating an upload

```javascript
const ALLOWED = ['image/png', 'image/jpeg'];

async function isAllowed(filePath) {
  const type = await new mmm.Magic(mmm.MAGIC_MIME_TYPE).detectFile(filePath);
  return ALLOWED.includes(type);
}
```

A `.png` renamed to `.jpg` is still reported as `image/png` — the extension is
never consulted.

---

## What gets detected

Every row below is asserted by the test suite against the bundled libmagic
**5.48**.

### Text

| File | `MAGIC_MIME_TYPE` | `MAGIC_MIME_ENCODING` |
|---|---|---|
| `.txt` plain text | `text/plain` | `us-ascii` |
| `.csv` comma-separated | `text/csv` | `us-ascii` |
| `.csv` with CRLF | `text/csv` | `us-ascii` |
| `.csv` UTF-8 with BOM | `text/csv` | `utf-8` |
| `.csv` UTF-16 | `text/csv` | `utf-16le` |
| `.json` | `application/json` | `us-ascii` |
| `.xml` | `text/xml` | `us-ascii` |
| `.html` | `text/html` | `us-ascii` |
| `.svg` | `image/svg+xml` | `us-ascii` |

> **Semicolon-delimited CSV is still `text/plain`.** libmagic parses
> comma-separated files, but not the European semicolon convention. If you
> accept those, handle them yourself.
>
> Upgrading from 1.x? CSV and JSON used to come back as `text/plain`. See
> [CHANGELOG.md](CHANGELOG.md) for the full list and the opt-out flag.

### Images

| File | Type |
|---|---|
| `.png` | `image/png` |
| `.jpg` | `image/jpeg` |
| `.gif` (87a and 89a) | `image/gif` |
| `.tif` | `image/tiff` |
| `.webp` | `image/webp` |
| `.bmp` | `image/bmp` |
| `.ico` | `image/vnd.microsoft.icon` |

### Documents and archives

| File | Type |
|---|---|
| `.pdf` | `application/pdf` |
| `.zip` | `application/zip` |
| `.tar` | `application/x-tar` |
| `.gz` | `application/gzip` |
| `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| `.ods` | `application/vnd.oasis.opendocument.spreadsheet` |
| `.odt` | `application/vnd.oasis.opendocument.text` |

### Special cases

| Input | Result |
|---|---|
| Empty **file** | `inode/x-empty` |
| Empty **Buffer** | `application/x-empty` |
| Directory | `inode/directory` |
| Missing path | rejects with an `Error` |

The empty file/Buffer difference is not a bug: `inode/*` answers come from
libmagic stat-ing a path, and a Buffer has no path.

---

## API

### `new Magic([source][, flags])`

| Argument | Meaning |
|---|---|
| *(omitted)* | Use the bundled magic database |
| `flags` (number) | Bundled database, with these flags |
| `path` (string) | Use the magic database at this path |
| `buffer` (Buffer) | Use a magic database held in memory |
| `false` | Let libmagic search for a database (`MAGIC` env var, then system paths) |

`flags` may be passed as the second argument in every form.

### `magic.detectFile(path[, callback])`

Inspects the file at `path`.

- With a callback: calls `callback(err, result)`, returns `undefined`.
- Without: returns a `Promise`.

### `magic.detect(buffer[, callback])`

Inspects the contents of `buffer`.

- With a callback: calls `callback(err, result)`, returns the `Magic` instance.
- Without: returns a `Promise`.

`result` is a `String`, or an `Array` of strings when `MAGIC_CONTINUE` is set.

---

## Flags

Combine with `|`.

| Flag | Effect |
|---|---|
| `MAGIC_NONE` | Human-readable description (default) |
| `MAGIC_MIME_TYPE` | Return the MIME type |
| `MAGIC_MIME_ENCODING` | Return the character encoding |
| `MAGIC_MIME` | Both: `type; charset=encoding` |
| `MAGIC_CONTINUE` | Return **all** matches as an Array |
| `MAGIC_SYMLINK` | Follow symlinks (**default on non-Windows**) |
| `MAGIC_DEVICES` | Read the contents of device files |
| `MAGIC_PRESERVE_ATIME` | Restore access time after reading |
| `MAGIC_RAW` | Do not translate unprintable characters |
| `MAGIC_APPLE` | Return the Apple creator/type code |
| `MAGIC_DEBUG` | Print debug output |
| `MAGIC_CHECK` | Print warnings to stderr |
| `MAGIC_NO_CHECK_TAR` | Skip tar detection |
| `MAGIC_NO_CHECK_SOFT` | Skip the magic database |
| `MAGIC_NO_CHECK_APPTYPE` | Skip application-type detection |
| `MAGIC_NO_CHECK_ELF` | Skip ELF detail parsing |
| `MAGIC_NO_CHECK_TEXT` | Skip text detection |
| `MAGIC_NO_CHECK_CDF` | Skip CDF (legacy Office) detection |
| `MAGIC_NO_CHECK_TOKENS` | Skip token detection |
| `MAGIC_NO_CHECK_ENCODING` | Skip encoding detection |

20 constants, unchanged from upstream.

---

## Compatibility

### Node versions

| Node | Status | Notes |
|---|---|---|
| **26** | **Supported** | in CI |
| **24** | **Supported** | in CI |
| **22** | **Supported** | in CI |
| 20 | Works | verified by hand; EOL April 2026 — not in CI |
| 18 | Works | verified by hand; EOL April 2025 — not in CI |
| 16, 14 | Works via prebuilt binary only | EOL since 2023. **Not supported.** Building from source fails — `node-addon-api` needs Node 18+. |
| ≤ 12 | Not supported | — |

`engines.node` is `>=18.0.0`: the floor for the *guaranteed* path, since a
platform with no matching prebuild must compile, and that needs Node 18+.

**"Supported"** means it is in CI *and* still maintained by the Node.js project.
18 and 20 genuinely work — the same binary loads and the whole suite passes —
but they are past end-of-life, so we do not test them on every commit.

### Platforms

| Platform | Status | How it was verified |
|---|---|---|
| macOS arm64 (Apple Silicon) | **Confirmed** | built + full suite, Node 22/24/26 |
| macOS x64 (Intel) | **Confirmed** | built + full suite, Node 22/24/26 (x86_64 binary under Rosetta) |
| Linux x64 (glibc) | **Confirmed** | built + full suite in Docker, Node 22/24/26 |
| Linux arm64 (glibc) | **Confirmed** | built + full suite in Docker, Node 22/24/26 |
| Linux x64/arm64 (musl / Alpine) | **Confirmed** | install + detection on `node:24-alpine`, `node:26-alpine` |
| Windows x64 | **Confirmed** | built with MSVC on Windows 11, Node 16/18/20/22/24/26 |
| Windows arm64 | **Not tested** | prebuild job exists (`continue-on-error`) |
| Windows x86 (32-bit) | **Not tested** | prebuild job exists. Node only ships 32-bit Windows for **Node 22** — 24 and 26 dropped it |
| Linux ppc64le, s390x | **Not tested** | no prebuild; would build from source |
| FreeBSD, OpenBSD, SunOS | **Not tested** | config headers are vendored but unexercised for years |

### What does *not* exist

Worth stating because it gets asked for:

| Target | Reality |
|---|---|
| 32-bit macOS | Never existed — Apple removed 32-bit support |
| 32-bit Linux | Node stopped shipping it after Node 10 |
| 32-bit ARM Linux (armv7l) | Node 22 only; dropped in 24 and 26 |

### Linux glibc floor

The Linux glibc binaries need **no symbol newer than `GLIBC_2.28`**, covering
Debian 10+, Ubuntu 18.04+, RHEL 8+, and Amazon Linux 2023. CI fails the build if
that floor rises.

This matters: a binary built on a newer distro silently refuses to load on older
ones, and the fallback is a source build — so it surfaces as "needs a compiler"
and never mentions glibc.

---

## Requirements for building from source

Only needed if there is no prebuilt binary for your platform, or you are working
from a git clone.

### All platforms

| Tool | Version |
|---|---|
| Node.js | 18 or newer |
| Python | 3.8 or newer (for `node-gyp`) |
| A C++ compiler | C++17 minimum; **C++20 required for Node 24+** |

**CMake is not used.** This is `node-gyp`, which comes with npm.

### macOS

```bash
xcode-select --install     # Xcode Command Line Tools
```

That is all — it provides clang and `make`. Full Xcode is not required.

### Linux (Debian / Ubuntu)

```bash
sudo apt-get install -y python3 make g++
```

Alpine:

```bash
apk add --no-cache python3 make g++
```

### Windows

You need **Visual Studio Build Tools 2022** with the **"Desktop development
with C++"** workload. Build Tools installed *without* that workload is the
single most common cause of install failure.

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override `
  "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Python.Python.3.12
```

VS 2019 (16.11+) also works. Keep the checkout path short — MSVC still hits the
260-character path limit; `C:\dev\...` is safe.

---

## What's inside

| Component | Version | Notes |
|---|---|---|
| **libmagic** | **5.48** | Vendored in `deps/libmagic` — see below |
| Magic database | `magic/magic.mgc`, 10.8 MB, format v21 | Must match the libmagic version |
| `node-addon-api` | `^8.9.2` | C++ wrapper over Node-API |
| `node-gyp-build` | `^4.8.4` | Picks prebuilt binary, else local build |
| Node-API level | `NAPI_VERSION=8` | Keeps the binary loadable on a wide Node range |
| `prebuildify` | `^6.0.1` | dev only — builds the shipped binaries |
| `node-gyp` | `^11.4.2` | dev only |

No runtime dependency on `nan` — this fork was ported from NAN to Node-API.

### Why libmagic 5.48

5.32 had no CSV or JSON parser, so those files fell through to the generic text
heuristics and came back `text/plain` — meaning any text file passed as a CSV.
5.48 parses the content, so the answer means something.

That changed eight results, which is why 2.0.0 is a major version.
[CHANGELOG.md](CHANGELOG.md) lists every one, and
`MAGIC_NO_CHECK_CSV` restores the old answer if you need to migrate gradually.

---

## Limitations / known issues

### Large files are cheap

`detectFile` reads **at most 1 MiB** regardless of file size — libmagic's
`FILE_BYTES_MAX`. A 120 MB CSV costs about the same as a 1 KB one:

```
120.5 MB CSV  ->  RSS +0.2 MB, 12 ms, 'text/plain'
```

`detect(buffer)` necessarily holds whatever you put in the Buffer, so for files
on disk **prefer `detectFile`**. Reading the same file into a Buffer first costs
the full 120 MB.

### `tar` + `MAGIC_MIME_ENCODING` alone is wrong

```javascript
await new mmm.Magic(mmm.MAGIC_MIME_ENCODING).detectFile('x.tar');
// 'binary'
```

Fixed as of 2.0.0. Up to 5.32 this returned the run-together
`application/x-tarbinary`, because `is_tar.c` tested both MIME bits instead of
the type bit and leaked the type into the encoding. A test pins the correct
answer so it cannot regress.

### Office files are detected by entry order

`.xlsx` / `.docx` / `.pptx` are zip containers. libmagic only reports the
specific Office type because `[Content_Types].xml` happens to be the **first**
zip entry. A generator that orders entries differently is only detectable as
`application/zip`. Real Office writes it first; not every tool does — so do not
rely on this alone to validate a spreadsheet upload.

### Semicolon-delimited CSV

`a;b;c` comes back `text/plain`, not `text/csv`. libmagic's CSV parser only
recognises the comma-delimited form, so the European semicolon convention still
falls through to the text heuristics. If you accept those files, check for them
yourself — a `text/csv` test alone will reject them.

### Non-ASCII filenames on Windows

Paths containing non-ASCII characters take a different code path
(`magic_descriptor` rather than `magic_file`), which cannot stat the path. On
such paths an empty file reports `application/x-empty` instead of
`inode/x-empty`, and directories cannot be opened. ASCII paths match POSIX
exactly.

### Not thread-safe by libmagic design

Each `Magic` instance opens its own libmagic handle per detection, so concurrent
use is safe. The addon is context-aware and works inside `worker_threads`.

---

## Testing

```bash
npm test              # all suites (35 assertions)

npm run test:upstream   # original upstream suite
npm run test:mime       # MIME coverage across all fixtures
npm run test:promise    # promise/async-await + callback compatibility
npm run test:largefile  # proves large files are not read into memory
npm run test:worker     # worker_threads support
npm run test:legacy     # 28 checks without node:test, for Node 14/16
```

Reproducible builds across Node versions:

```bash
docker build -f docker/Dockerfile --build-arg NODE_VERSION=26 -t mmmagic:node26 .
docker run --rm mmmagic:node26

PLATFORMS="linux/amd64 linux/arm64" ./scripts/matrix.sh
```

---

## Credits

Derived from **mmmagic 0.5.5** by Brian White (mscdex), by way of the
`@picturae/mmmagic` fork. The C++ addon and the JavaScript surface started as
theirs; this package carries the port to Node-API, prebuilt binaries, Promise
support and the Windows fixes on top.

## License

This package is **MIT**, and the original copyright is retained in
[LICENSE](LICENSE) as that licence requires.

It vendors two third-party components, both with their full licence text
included:

| Component | Licence | Applies to |
|---|---|---|
| libmagic (`deps/libmagic`) | BSD-2-Clause | every platform |
| libgnurx (`deps/libmagic/msvc/libgnurx-2.5`) | **LGPL-2.1-or-later** | **Windows binaries only** |

libgnurx supplies POSIX regex, which the Microsoft C runtime lacks, so it is
compiled only into `win32-x64`, `win32-ia32` and `win32-arm64`. **The macOS and
Linux binaries contain no LGPL code.**

If your organisation restricts copyleft dependencies, that distinction is
usually the one that matters. The complete libgnurx source ships in the tarball
unmodified, so the Windows binary can be relinked against a modified copy with
`npm rebuild @vishalkumar14/mmmagic`, satisfying LGPL-2.1 §6. Full details in
[LICENSE](LICENSE).
