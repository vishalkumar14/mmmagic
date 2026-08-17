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
| 26 | **Supported** | verified, in CI |
| 24 | **Supported** | verified, in CI |
| 22 | **Supported** | verified, in CI |
| 20 | Works, not supported | verified by hand; EOL April 2026, not in CI |
| 18 | Works, not supported | verified by hand; EOL April 2025, not in CI |
| ≤ 16 | **Not supported** | see below |

"Supported" means it is in the CI matrix *and* still maintained upstream by the
Node.js project. 18 and 20 genuinely work — the same prebuilt binary loads and
the full test suite passes — but both are past end-of-life, so they are not
tested on every commit.

Verified with a single binary built on Node 22, installed from the packed
tarball into containers with no compiler, no Python and no make:

```
node v18.20.8  ->  OK   detect -> text/plain
node v20.20.2  ->  OK   detect -> text/plain
node v22.23.2  ->  OK   detect -> text/plain
node v24.19.0  ->  OK   detect -> text/plain
node v26.7.0   ->  OK   detect -> text/plain
```

**Why 16 is the cut-off.** The binary itself would load — it targets Node-API 8,
present since Node 12.22 / 14.17, and `node-gyp-build` resolves it correctly on
Node 16. The blocker is npm: npm 8, which ships with Node 16, runs
`node-gyp rebuild` for any package containing a `binding.gyp` instead of
honouring the `install` script. So installing on Node 16 demands a full C++
toolchain even though a usable prebuilt binary is sitting right there. Node 16
reached end-of-life in September 2023.

**Building from source** — contributors, or any platform without a prebuilt
binary — additionally needs Python 3, `make`, and a C++17-capable compiler
(C++20 for Node 24 and later). On Windows that means Visual Studio Build Tools


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
