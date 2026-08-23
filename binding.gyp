{
  'targets': [
    {
      # node.napi.node: the name prebuildify/node-gyp-build expect for an
      # ABI-stable Node-API addon. One binary serves every Node >= 22.
      'target_name': 'magic',
      'sources': [
        'src/binding.cc',
      ],
      'include_dirs': [
        'deps/libmagic/src',
        # include_dir is a relative path using the platform separator. On
        # Windows that separator is a backslash, which gyp consumes as an
        # escape sequence: the 'n' of 'node-addon-api' is eaten and the path
        # collapses to 'node_modulesnode-addon-api', so napi.h is never found.
        # Normalising to forward slashes fixes Windows and is a no-op on POSIX.
        "<!@(node -p \"require('node-addon-api').include_dir.split(require('path').sep).join('/')\")",
      ],
      'dependencies': [
        'deps/libmagic/libmagic.gyp:libmagic',
      ],
      'defines': [
        # Keep node-gyp's default -fno-exceptions: errors are surfaced with
        # ThrowAsJavaScriptException() + an early return instead.
        'NAPI_DISABLE_CPP_EXCEPTIONS',
        # Pin the Node-API surface we rely on. NAPI 8 is present in every
        # Node >= 12.22 / 14.17, far below our floor, so the prebuilt binary
        # stays loadable on anything current.
        'NAPI_VERSION=8',
      ],
      'cflags!': [ '-O2' ],
      'cflags+': [ '-O3' ],
      'cflags_cc!': [ '-O2' ],
      'cflags_cc+': [ '-O3' ],
      'cflags_c!': [ '-O2' ],
      'cflags_c+': [ '-O3' ],
      'conditions': [
        ['OS=="mac"', {
          'xcode_settings': {
            # MACOSX_DEPLOYMENT_TARGET is deliberately unset.
            # Setting it on this target only left deps/libmagic on node-gyp's
            # default and produced a link-time version-mismatch warning per
            # object file.
            #
            # node-addon-api requires C++17; Node 24+ V8 headers require C++20.
            # gnu++20 satisfies both. This must never be lowered.
            'CLANG_CXX_LANGUAGE_STANDARD': 'gnu++20',
            'CLANG_CXX_LIBRARY': 'libc++',
          },
        }],
        ['OS=="win"', {
          'msvs_settings': {
            'VCCLCompilerTool': {
              'AdditionalOptions': [ '/std:c++20' ],
            },
          },
        }],
      ],
    },
  ],
}
