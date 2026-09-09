{
  'targets': [
    {
      'target_name': 'libmagic',
      'type': 'static_library',
      'include_dirs': [ '.', 'src' ],
      'defines': [ 'HAVE_CONFIG_H', 'VERSION="5.48"' ],
      'conditions': [
        [ 'OS!="freebsd" and OS!="mac"', {
          'sources': [ 'src/fmtcheck.c' ],
        }],
        [ 'OS=="win"', {
          'sources': [
            'src/asctime_r.c',
            'src/asprintf.c',
            'src/ctime_r.c',
            'src/dprintf.c',
            'src/getline.c',
            'src/gmtime_r.c',
            'src/localtime_r.c',
            'src/pread.c',
            'src/strcasestr.c',
            'src/strlcat.c',
            'src/strlcpy.c',
            'src/vasprintf.c',
            # POSIX regex implementation
            'msvc/libgnurx-2.5/regex.c',
          ],
          'include_dirs': [ 'config/win', 'msvc', 'msvc/libgnurx-2.5' ],
          # Force config.h in ahead of everything. libmagic's public magic.h
          # declares `ssize_t magic_getmaxparam(int)` (new in 5.48) but only
          # includes <sys/types.h>, which does not define ssize_t on MSVC. Our
          # typedef lives in config/win/config.h, and nothing guarantees that
          # header is reached first otherwise.
          'msvs_settings': {
            'VCCLCompilerTool': {
              'ForcedIncludeFiles': [ 'config.h' ],
            },
          },
          'link_settings': {
            'libraries': [
              '-lshlwapi.lib',
            ]
          },
        }, { # POSIX
          'cflags': [ '-std=c99' ],
        }],
        [ 'OS=="linux"', {
          'sources': [
            'src/strlcat.c',
            'src/strlcpy.c',
          ],
          'include_dirs': [ 'config/linux' ],
        }],
        [ 'OS=="mac"', {
          'include_dirs': [ 'config/mac' ],
          # Must match binding.gyp exactly. If the two disagree the linker
          # emits a version-mismatch warning for every object file.
          'xcode_settings': {
            'MACOSX_DEPLOYMENT_TARGET': '11.0',
          },
        }],
        [ 'OS=="freebsd"', {
          'include_dirs': [ 'config/freebsd' ],
        }],
        [ 'OS=="openbsd"', {
          'include_dirs': [ 'config/openbsd' ],
        }],
        [ 'OS=="solaris"', {
          'include_dirs': [ 'config/sunos' ],
        }],
      ],
      'cflags!': [ '-O2' ],
      'cflags+': [ '-O3' ],
      'cflags_cc!': [ '-O2' ],
      'cflags_cc+': [ '-O3' ],
      'cflags_c!': [ '-O2' ],
      'cflags_c+': [ '-O3' ],
      'sources': [
        'src/apprentice.c',
        'src/apptype.c',
        'src/ascmagic.c',
        'src/buffer.c',
        'src/cdf.c',
        'src/cdf_time.c',
        'src/compress.c',
        'src/der.c',
        'src/encoding.c',
        'src/fsmagic.c',
        'src/funcs.c',
        'src/is_csv.c',
        'src/is_json.c',
        'src/is_simh.c',
        'src/is_tar.c',
        'src/magic.c',
        'src/print.c',
        'src/readcdf.c',
        'src/readelf.c',
        'src/softmagic.c',
        'src/swap.c',
      ],
    },
  ]
}
