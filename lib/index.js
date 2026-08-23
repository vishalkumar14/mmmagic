'use strict';

// node-gyp-build resolves, in order:
//   1. prebuilds/<platform>-<arch>/node.napi.node   (shipped in the tarball)
//   2. build/Release/magic.node                     (locally compiled)
//   3. build/Debug/magic.node
//
// So a consumer on a supported platform never needs a compiler, and a
// contributor on any platform can still `npm run rebuild` and have that win.
const native = require('node-gyp-build')(require('path').join(__dirname, '..'));

const fbpath = require('path').join(__dirname, '..', 'magic', 'magic');
native.setFallback(fbpath);

// Promise support.
//
// Note what this does NOT change: both methods were already non-blocking. The
// detection runs on libuv's threadpool via Napi::AsyncWorker, never on the main
// thread. This only changes how the result is delivered, not when it happens or
// what it costs.
//
// Pass a callback and behaviour is byte-for-byte what it always was, return
// values included (detectFile -> undefined, detect -> this). Omit the callback
// and you get a Promise.
//
// Implemented as a subclass rather than a prototype patch because
// Napi::ObjectWrap defines its instance methods non-writable, so
// `Magic.prototype.detectFile = ...` throws in strict mode.
//
// Deliberately no C++ change: this works with every already-published prebuilt
// binary, on every platform and every supported Node version, with no rebuild.
class Magic extends native.Magic {
  detectFile(path, callback) {
    if (typeof callback === 'function') {
      return super.detectFile(path, callback);
    }
    return new Promise((resolve, reject) => {
      // A synchronous throw from the addon -- bad argument types -- happens
      // inside the executor, so the Promise constructor turns it into a
      // rejection. A promise-returning function should never throw
      // synchronously.
      super.detectFile(path, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  detect(data, callback) {
    if (typeof callback === 'function') {
      return super.detect(data, callback);
    }
    return new Promise((resolve, reject) => {
      super.detect(data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }
}

module.exports = {
  Magic,
  MAGIC_NONE: 0x000000, /* No flags (default for Windows) */
  MAGIC_DEBUG: 0x000001, /* Turn on debugging */
  MAGIC_SYMLINK: 0x000002, /* Follow symlinks (default for *nix) */
  MAGIC_DEVICES: 0x000008, /* Look at the contents of devices */
  MAGIC_MIME_TYPE: 0x000010, /* Return the MIME type */
  MAGIC_CONTINUE: 0x000020, /* Return all matches */
  MAGIC_CHECK: 0x000040, /* Print warnings to stderr */
  MAGIC_PRESERVE_ATIME: 0x000080, /* Restore access time on exit */
  MAGIC_RAW: 0x000100, /* Don't translate unprintable chars */
  MAGIC_MIME_ENCODING: 0x000400, /* Return the MIME encoding */
  MAGIC_MIME: (0x000010|0x000400), /*(MAGIC_MIME_TYPE|MAGIC_MIME_ENCODING)*/
  MAGIC_APPLE: 0x000800, /* Return the Apple creator and type */

  MAGIC_NO_CHECK_TAR: 0x002000, /* Don't check for tar files */
  MAGIC_NO_CHECK_SOFT: 0x004000, /* Don't check magic entries */
  MAGIC_NO_CHECK_APPTYPE: 0x008000, /* Don't check application type */
  MAGIC_NO_CHECK_ELF: 0x010000, /* Don't check for elf details */
  MAGIC_NO_CHECK_TEXT: 0x020000, /* Don't check for text files */
  MAGIC_NO_CHECK_CDF: 0x040000, /* Don't check for cdf files */
  MAGIC_NO_CHECK_TOKENS: 0x100000, /* Don't check tokens */
  MAGIC_NO_CHECK_ENCODING: 0x200000 /* Don't check text encodings */
};
