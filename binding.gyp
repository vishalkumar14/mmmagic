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
            # Pin the deployment target rather than inheriting the build
            # machine's default. Left unset, the shipped binary took the CI
            # runner's SDK -- macos-14 produced minos 13.5, which refuses to
            # load on Monterey or Big Sur for no reason we actually need.
            #
            # 11.0 is the right floor: it is the first release supporting
            # Apple Silicon, so no arm64 Mac is excluded, and it reaches Intel
            # Macs back to 2020. It is also set on deps/libmagic's target --
            # setting it on only one is what produced the link-time
            # version-mismatch warning per object file noted here before.
            'MACOSX_DEPLOYMENT_TARGET': '11.0',
            #
            # node-addon-api requires C++17; Node 24+ V8 headers require C++20.
            # gnu++20 satisfies both. This must never be lowered.
            'CLANG_CXX_LANGUAGE_STANDARD': 'gnu++20',
            'CLANG_CXX_LIBRARY': 'libc++',
          },
        }],
        ['OS=="win"', {
          # binding.cc includes libmagic's magic.h, which declares ssize_t in
          # its API. MSVC has no such type by default, so this target needs the
          # same forced config.h and include path the libmagic target uses.
          'include_dirs': [ 'deps/libmagic/config/win' ],
          'msvs_settings': {
            'VCCLCompilerTool': {
              'AdditionalOptions': [ '/std:c++20' ],
              'ForcedIncludeFiles': [ 'config.h' ],
            },
          },
        }],
      ],
    },
  ],
}
