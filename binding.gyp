{
  'targets': [
    {
      'target_name': 'magic',
      'sources': [
        'src/binding.cc',
      ],
      'include_dirs': [
        'deps/libmagic/src',
        "<!(node -e \"require('nan')\")"
      ],
      'cflags!': [ '-O2' ],
      'cflags+': [ '-O3' ],
      'cflags_cc!': [ '-O2' ],
      'cflags_cc+': [ '-O3' ],
      'cflags_c!': [ '-O2' ],
      'cflags_c+': [ '-O3' ],
      'dependencies': [
        'deps/libmagic/libmagic.gyp:libmagic',
      ],
      'conditions': [
        ['OS=="mac"', {
          'xcode_settings': {
            # MACOSX_DEPLOYMENT_TARGET is deliberately NOT set here. It used to
            # be pinned to 10.15, which (a) predates Apple Silicon and Node 24's
            # macOS floor, and (b) applied only to this target — deps/libmagic
            # inherited node-gyp's default instead, so every link emitted
            #   ld: warning: object file ... was built for newer 'macOS'
            #   version (13.5) than being linked (10.15)
            # Leaving it unset lets node-gyp's common.gypi pick one value for
            # both targets, which tracks the Node version being built against.
            #
            # MUST stay >= C++20. Node 24+ ships a v8config.h containing
            #   #error "C++20 or later required."
            # and V8's headers use concepts/requires. On Linux node-gyp's own
            # common.gypi already passes -std=gnu++20, which is why Linux builds
            # kept working; on macOS this key overrides it, so pinning c++17
            # here broke every macOS build from Node 24 onwards.
            'CLANG_CXX_LANGUAGE_STANDARD': 'gnu++20',
            'CLANG_CXX_LIBRARY': 'libc++',
          }
        }],
      ],
    },
  ],
}
