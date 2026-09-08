/*
 * Minimal <unistd.h> for MSVC.
 *
 * libmagic 5.48 includes <unistd.h> unconditionally in several sources --
 * buffer.c is the clearest case -- where 5.32 guarded it with
 * `#ifdef HAVE_UNISTD_H`. The Microsoft C runtime has no such header, so the
 * Windows build cannot compile those files without this shim. It sits in
 * msvc/, which is on the include path only for OS=="win", exactly like the
 * dirent.h shim beside it.
 *
 * Deliberately minimal. It supplies the declarations libmagic actually reaches
 * for and nothing else -- it is not an attempt at POSIX emulation. Everything
 * is guarded so it cannot collide with a definition the toolchain already
 * provides.
 */

#ifndef MMMAGIC_MSVC_UNISTD_H
#define MMMAGIC_MSVC_UNISTD_H

/* MSVC keeps the POSIX-ish file descriptor calls (read, write, close, lseek,
 * isatty, dup) here, under underscore-prefixed names with unprefixed aliases. */
#include <io.h>
#include <process.h>
#include <stdlib.h>

/* ssize_t. MSVC spells it SSIZE_T in <BaseTsd.h> and never defines the
 * lowercase POSIX name. _SSIZE_T_DEFINED is the guard the Windows SDK and
 * most third-party shims agree on, so honour it in both directions. */
#ifndef _SSIZE_T_DEFINED
#define _SSIZE_T_DEFINED
#include <BaseTsd.h>
typedef SSIZE_T ssize_t;
#endif

/* Standard descriptor numbers. Fixed by POSIX; MSVC simply omits the names. */
#ifndef STDIN_FILENO
#define STDIN_FILENO  0
#endif
#ifndef STDOUT_FILENO
#define STDOUT_FILENO 1
#endif
#ifndef STDERR_FILENO
#define STDERR_FILENO 2
#endif

#endif /* MMMAGIC_MSVC_UNISTD_H */
