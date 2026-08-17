> **Internal fork.** Modernised for Node.js 22 / 24 / 26.
> the Docker build matrix, and the tested-platform status.
> The public JavaScript API below is unchanged.


Description
===========

An async libmagic binding for [node.js](http://nodejs.org/) for detecting content types by data inspection.

[![Build Status](https://travis-ci.org/the original project.svg?branch=master)](https://travis-ci.org/the original project)
[![Build status](https://ci.appveyor.com/api/projects/status/mva462lka1ap5a3t)](https://ci.appveyor.com/project/the original project)


Requirements
============

**Minimum: Node.js 18.0.0** (`engines.node: ">=18.0.0"`).

Because the addon is Node-API, one prebuilt binary per platform serves every
Node version — there is no per-Node-major binary, and upgrading Node does not
require a rebuild.

| Node | Status | Notes |
|---|---|---|
| 26 | **Supported** | in CI |
| 24 | **Supported** | in CI |
| 22 | **Supported** | in CI |
| 20 | Works | verified by hand; EOL April 2026, not in CI |
| 18 | Works | verified by hand; EOL April 2025, not in CI |
| 16, 14 | Prebuilt binary loads | EOL since 2023. Source builds do **not** work — `node-addon-api` requires Node 18+. Do not rely on this. |

"Supported" means it is in the CI matrix *and* still maintained upstream by the
Node.js project. `engines` is set to `>=18.0.0` because that is the floor for the
*guaranteed* path: if no prebuilt binary matches your platform, the install
falls back to compiling from source, and that needs Node 18+.

Verified with a single set of prebuilt binaries, installed from the packed
tarball into containers with **no compiler, no Python and no make**:

| Image | glibc | Node | Result |
|---|---|---|---|
| `node:14-slim` | 2.28 | v14.21.3 | install + detect OK |
| `node:16-slim` | 2.28 | v16.20.2 | install + detect OK |
| `node:18-bullseye` | 2.31 | v18.20.8 | install + detect OK |
| `node:20-bullseye` | 2.31 | v20.20.2 | install + detect OK |
| `node:22-bullseye` | 2.31 | v22.23.2 | install + detect OK |
| `node:22-bookworm` | 2.36 | v22.23.2 | install + detect OK |
| `node:24-slim` | 2.36 | v24.19.0 | install + detect OK |
| `node:26-slim` | 2.41 | v26.7.0 | install + detect OK |
| `node:24-alpine` | musl | v24.19.0 | install + detect OK |
| `node:26-alpine` | musl | v26.7.0 | install + detect OK |

## glibc floor (Linux)

The Linux glibc binaries are built on Debian bullseye on purpose and require no
symbol newer than **`GLIBC_2.28`**, which covers Debian 10+, Ubuntu 18.04+,
RHEL 8+ and Amazon Linux 2023.

This matters more than it looks. A glibc binary carries a floor equal to the
newest versioned symbol it references. Built on Debian bookworm it needed
`GLIBC_2.33` and would not load on Debian 11, Ubuntu 20.04, RHEL 9 or any
`node:*-bullseye` image — **including on fully supported Node versions**. The
failure is quiet: `node-gyp-build` finds the prebuild, `dlopen` fails, and it
falls back to a source build, so it surfaces as "needs a compiler" and never
mentions glibc. CI asserts the floor stays at or below `GLIBC_2.28`.

**Building from source** — contributors, or any platform without a prebuilt
binary — needs Node 18+, Python 3, `make`, and a C++17-capable compiler (C++20
for Node 24 and later). On Windows that means Visual Studio Build Tools with the


Install
=======

    npm install mmmagic


Examples
========

* Get general description of a file:
```javascript
  var Magic = require('mmmagic').Magic;

  var magic = new Magic();
  magic.detectFile('node_modules/mmmagic/build/Release/magic.node', function(err, result) {
      if (err) throw err;
      console.log(result);
      // output on Windows with 32-bit node:
      //    PE32 executable (DLL) (GUI) Intel 80386, for MS Windows
  });
```
* Get mime type for a file:
```javascript
  var mmm = require('mmmagic'),
      Magic = mmm.Magic;

  var magic = new Magic(mmm.MAGIC_MIME_TYPE);
  magic.detectFile('node_modules/mmmagic/build/Release/magic.node', function(err, result) {
      if (err) throw err;
      console.log(result);
      // output on Windows with 32-bit node:
      //    application/x-dosexec
  });
```
* Get mime type and mime encoding for a file:
```javascript
  var mmm = require('mmmagic'),
      Magic = mmm.Magic;

  var magic = new Magic(mmm.MAGIC_MIME_TYPE | mmm.MAGIC_MIME_ENCODING);
  // the above flags can also be shortened down to just: mmm.MAGIC_MIME
  magic.detectFile('node_modules/mmmagic/build/Release/magic.node', function(err, result) {
      if (err) throw err;
      console.log(result);
      // output on Windows with 32-bit node:
      //    application/x-dosexec; charset=binary
  });
```
* Get general description of the contents of a Buffer:
```javascript
  var Magic = require('mmmagic').Magic;

  var magic = new Magic(),
        buf = new Buffer('import Options\nfrom os import unlink, symlink');
  
  magic.detect(buf, function(err, result) {
      if (err) throw err;
      console.log(result);
      // output: Python script, ASCII text executable
  });
```

API
===

Magic methods
-------------

* **(constructor)**([< _mixed_ >magicSource][, < _Integer_ >flags]) - Creates and returns a new Magic instance. `magicSource` (if specified) can either be a path string that points to a (compatible) magic file to use *or* it can be a _Buffer_ containing the contents of a (compatible) magic file. If `magicSource` is not a string and not `false`, the bundled magic file will be used. If `magicSource` is `false`, mmmagic will default to searching for a magic file to use (order of magic file searching: `MAGIC` env var -> various file system paths (see `man file`)). flags is a bitmask with the following valid values (available as constants on `require('mmmagic')`):

    * **MAGIC\_NONE** - No flags set
    * **MAGIC\_DEBUG** - Turn on debugging
    * **MAGIC\_SYMLINK** - Follow symlinks **(default for non-Windows)**
    * **MAGIC\_DEVICES** - Look at the contents of devices
    * **MAGIC\_MIME_TYPE** - Return the MIME type
    * **MAGIC\_CONTINUE** - Return all matches (returned as an array of strings)
    * **MAGIC\_CHECK** - Print warnings to stderr
    * **MAGIC\_PRESERVE\_ATIME** - Restore access time on exit
    * **MAGIC\_RAW** - Don't translate unprintable chars
    * **MAGIC\_MIME\_ENCODING** - Return the MIME encoding
    * **MAGIC\_MIME** - (**MAGIC\_MIME\_TYPE** | **MAGIC\_MIME\_ENCODING**)
    * **MAGIC\_APPLE** - Return the Apple creator and type
    * **MAGIC\_NO\_CHECK\_TAR** - Don't check for tar files
    * **MAGIC\_NO\_CHECK\_SOFT** - Don't check magic entries
    * **MAGIC\_NO\_CHECK\_APPTYPE** - Don't check application type
    * **MAGIC\_NO\_CHECK\_ELF** - Don't check for elf details
    * **MAGIC\_NO\_CHECK\_TEXT** - Don't check for text files
    * **MAGIC\_NO\_CHECK\_CDF** - Don't check for cdf files
    * **MAGIC\_NO\_CHECK\_TOKENS** - Don't check tokens
    * **MAGIC\_NO\_CHECK\_ENCODING** - Don't check text encodings

* **detectFile**(< _String_ >path, < _Function_ >callback) - _(void)_ - Inspects the file pointed at by path. The callback receives two arguments: an < _Error_ > object in case of error (null otherwise), and a < _String_ > containing the result of the inspection.

* **detect**(< _Buffer_ >data, < _Function_ >callback) - _(void)_ - Inspects the contents of data. The callback receives two arguments: an < _Error_ > object in case of error (null otherwise), and a < _String_ > containing the result of the inspection.
