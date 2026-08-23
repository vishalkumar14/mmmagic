// Node-API (node-addon-api) port of mmmagic.
//
// Behavioural contract with the previous NAN implementation is intentionally
// exact. The differences are all fixes, not API changes.
//
// Keep this file pure ASCII: test/test.js uses it as its own fixture and
// asserts the detected encoding is us-ascii.
//
//  * Context-aware. State that used to be file-scope globals now lives in
//    per-addon-instance data, so the addon loads inside worker_threads. The old
//    NODE_MODULE registration made `new Worker()` fail with
//    "Module did not self-register".
//  * No per-instance leak. The old code called obj->Ref() in the constructor
//    with no matching Unref(), so every `new Magic()` was pinned for the life
//    of the process. Liveness during async work is now held by the AsyncWorker
//    for exactly as long as the work is in flight.
//  * ABI-stable. One binary per platform serves every Node >= 22 rather than
//    one per Node major.

#include <napi.h>

#include <stdlib.h>
#include <string.h>

#include <string>
#include <vector>

#ifdef _WIN32
# include <io.h>
# include <fcntl.h>
# include <wchar.h>
// _SH_DENYNO lives in <share.h>; older MSVC CRTs pulled it in transitively.
# include <share.h>
# include <windows.h>
#endif

#include "magic.h"

namespace {

// ---------------------------------------------------------------------------
// Per-addon-instance state.
//
// `fallbackPath` used to be a file-scope `const char*` mutated by setFallback()
// on every require(). Two threads requiring the module concurrently raced on
// free()/strdup(). Instance data is created once per addon instance per Agent,
// so each worker thread gets its own.
// ---------------------------------------------------------------------------
struct AddonData {
  std::string fallback_path;
};

// ---------------------------------------------------------------------------
// A snapshot of everything the worker thread needs. Execute() runs off the JS
// thread and must not touch any napi_value, so every input is copied into
// plain C++ up front.
// ---------------------------------------------------------------------------
struct DetectInput {
  // Where the magic database comes from.
  bool source_is_path = true;
  std::string source_path;      // when source_is_path
  const char* source_data = nullptr;  // when !source_is_path (owned by JS Buffer)
  size_t source_len = 0;
  std::string fallback_path;

  // What to inspect.
  bool target_is_path = true;
  std::string target_path;      // when target_is_path
  const char* target_data = nullptr;  // when !target_is_path (owned by JS Buffer)
  size_t target_len = 0;

  int flags = 0;
};

class DetectWorker : public Napi::AsyncWorker {
 public:
  DetectWorker(const Napi::Function& callback,
               DetectInput input,
               // Keeps the Magic instance, and any Buffer whose bytes we hold a
               // raw pointer to, alive for exactly the duration of the work.
               std::vector<Napi::ObjectReference> keep_alive)
      : Napi::AsyncWorker(callback),
        input_(std::move(input)),
        keep_alive_(std::move(keep_alive)) {}

  ~DetectWorker() override = default;

  void Execute() override {
    struct magic_set* magic = magic_open(input_.flags
                                        | MAGIC_NO_CHECK_COMPRESS
                                        | MAGIC_ERROR);
    if (magic == nullptr) {
      SetError("Failed to initialize libmagic");
      return;
    }

    if (input_.source_is_path) {
      // Mirrors the previous implementation: try the configured source, then
      // fall back. A null path makes libmagic search MAGIC / its default paths,
      // which is what an empty string here means.
      const char* primary =
          input_.source_path.empty() ? nullptr : input_.source_path.c_str();
      const char* fallback =
          input_.fallback_path.empty() ? nullptr : input_.fallback_path.c_str();
      if (magic_load(magic, primary) == -1
          && magic_load(magic, fallback) == -1) {
        SetError(MagicError(magic));
        magic_close(magic);
        return;
      }
    } else {
      // magic_load_buffers takes an array of buffers; we always pass one.
      void* buffers[1] = { const_cast<void*>(
          static_cast<const void*>(input_.source_data)) };
      size_t sizes[1] = { input_.source_len };
      if (magic_load_buffers(magic, buffers, sizes, 1) == -1) {
        SetError(MagicError(magic));
        magic_close(magic);
        return;
      }
    }

    const char* result = nullptr;
    if (input_.target_is_path) {
#ifdef _WIN32
      // magic_file() takes a narrow path, which the CRT interprets in the
      // ANSI code page -- that mangles non-ASCII names. For a pure-ASCII path
      // the two encodings coincide, so prefer magic_file() there: it applies
      // libmagic's stat-based layer (fsmagic) and so matches POSIX exactly,
      // classifying an empty file as inode/x-empty and a directory as
      // inode/directory.
      //
      // Only a non-ASCII path needs the wide-open + magic_descriptor()
      // fallback below. magic_descriptor() cannot stat a path, so it loses
      // that layer: an empty file comes back as application/x-empty and a
      // directory cannot be opened at all. That residual difference is
      // limited to non-ASCII paths.
      bool ascii_only = true;
      for (std::string::const_iterator it = input_.target_path.begin();
           it != input_.target_path.end(); ++it) {
        if (static_cast<unsigned char>(*it) >= 0x80) {
          ascii_only = false;
          break;
        }
      }

      if (ascii_only) {
        result = magic_file(magic, input_.target_path.c_str());
      } else {
        // Open the file ourselves so that non-ASCII paths work.
        int fd = -1;
        const int wlen = MultiByteToWideChar(CP_UTF8, 0,
                                             input_.target_path.c_str(),
                                             -1, nullptr, 0);
        if (wlen > 0) {
          std::vector<wchar_t> wpath(static_cast<size_t>(wlen));
          if (MultiByteToWideChar(CP_UTF8, 0, input_.target_path.c_str(), -1,
                                  wpath.data(), wlen) != 0) {
            _wsopen_s(&fd, wpath.data(), O_RDONLY | O_BINARY, _SH_DENYNO,
                      _S_IREAD);
          }
        }
        if (fd == -1) {
          SetError("Error while opening file");
          magic_close(magic);
          return;
        }
        result = magic_descriptor(magic, fd);
        // magic_descriptor may leave the offset moved; we own the fd anyway.
        _close(fd);
      }
#else
      result = magic_file(magic, input_.target_path.c_str());
#endif
    } else {
      result = magic_buffer(magic,
                            static_cast<const void*>(input_.target_data),
                            input_.target_len);
    }

    if (result == nullptr) {
      // magic_error() may legitimately be null; fall through to an empty
      // result in that case, matching the previous implementation.
      const char* err = magic_error(magic);
      if (err != nullptr)
        SetError(err);
    } else {
      result_.assign(result);
      have_result_ = true;
    }

    magic_close(magic);
  }

  // Success path. Callback receives (null, result).
  void OnOK() override {
    Napi::Env env = Env();
    Napi::HandleScope scope(env);

    Napi::Value payload;
    if ((input_.flags & (MAGIC_CONTINUE | MAGIC_RAW))
        == (MAGIC_CONTINUE | MAGIC_RAW)) {
      payload = SplitMatches(env);
    } else if (have_result_) {
      payload = Napi::String::New(env, result_);
    } else {
      payload = Napi::String::New(env, "");
    }

    keep_alive_.clear();
    Callback().Call({ env.Null(), payload });
  }

  // Failure path. Callback receives (Error).
  void OnError(const Napi::Error& e) override {
    Napi::Env env = Env();
    Napi::HandleScope scope(env);
    keep_alive_.clear();
    Callback().Call({ e.Value() });
  }

 private:
  static const char* MagicError(struct magic_set* magic) {
    const char* err = magic_error(magic);
    return err != nullptr ? err : "unknown libmagic error";
  }

  // With MAGIC_CONTINUE|MAGIC_RAW libmagic returns all matches in one string,
  // separated by "\n- ". Split it back into an array, preserving the previous
  // implementation's exact semantics (including that a missing result yields an
  // empty array).
  Napi::Array SplitMatches(Napi::Env env) {
    Napi::Array out = Napi::Array::New(env);
    if (!have_result_)
      return out;

    uint32_t i = 0;
    const char* const begin = result_.c_str();
    const char* const end = begin + result_.size();
    const char* last = begin;
    for (;;) {
      const char* next = strstr(last, "\n- ");
      if (next == nullptr) {
        if (last < end)
          out.Set(i, Napi::String::New(env, last));
        break;
      }
      out.Set(i++, Napi::String::New(env, last,
                                     static_cast<size_t>(next - last)));
      last = next + 3;
    }
    return out;
  }

  DetectInput input_;
  std::vector<Napi::ObjectReference> keep_alive_;
  std::string result_;
  bool have_result_ = false;
};

}  // namespace

// ---------------------------------------------------------------------------
// The Magic class.
// ---------------------------------------------------------------------------
class Magic : public Napi::ObjectWrap<Magic> {
 public:
  static void Init(Napi::Env env, Napi::Object exports) {
    // No persistent handle on the constructor: the previous implementation kept
    // one in a file-scope Nan::Persistent that was never read. Storing it would
    // also mean destroying a FunctionReference during env teardown for no gain.
    exports.Set("Magic", DefineClass(env, "Magic", {
      InstanceMethod<&Magic::DetectFile>("detectFile"),
      InstanceMethod<&Magic::Detect>("detect"),
    }));
  }

  explicit Magic(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<Magic>(info) {
    Napi::Env env = info.Env();

#ifndef _WIN32
    int magic_flags = MAGIC_SYMLINK;
#else
    int magic_flags = MAGIC_NONE;
#endif

    if (info.Length() > 1) {
      if (!info[1].IsNumber()) {
        Napi::TypeError::New(env, "Second argument must be an integer")
            .ThrowAsJavaScriptException();
        return;
      }
      magic_flags = info[1].As<Napi::Number>().Int32Value();
    }

    if (info.Length() > 0) {
      const Napi::Value arg = info[0];
      if (arg.IsString()) {
        source_is_path_ = true;
        source_path_ = arg.As<Napi::String>().Utf8Value();
      } else if (arg.IsBuffer()) {
        source_is_path_ = false;
        Napi::Buffer<char> buf = arg.As<Napi::Buffer<char>>();
        source_data_ = buf.Data();
        source_len_ = buf.Length();
        // Hold the Buffer so source_data_ stays valid for this object's life.
        source_buffer_ = Napi::Persistent(arg.As<Napi::Object>());
      } else if (arg.IsNumber()) {
        magic_flags = arg.As<Napi::Number>().Int32Value();
        source_is_path_ = true;
        // No explicit source: use the bundled database, exactly as the previous
        // implementation did (it strdup'd fallbackPath into msource here).
        source_path_ = env.GetInstanceData<AddonData>()->fallback_path;
      } else if (arg.IsBoolean() && !arg.As<Napi::Boolean>().Value()) {
        // `false` means: let libmagic search MAGIC / the usual paths.
        source_is_path_ = true;
        const char* p = magic_getpath(nullptr, 0 /* FILE_LOAD */);
        // Windows blows up looking up the literal path "(null)".
        if (p != nullptr && strncmp(p, "(null)", 6) != 0)
          source_path_.assign(p);
      } else {
        Napi::TypeError::New(env,
            "First argument must be a string, Buffer, or integer")
            .ThrowAsJavaScriptException();
        return;
      }
    } else {
      // No arguments at all: bundled database, same as above.
      source_path_ = env.GetInstanceData<AddonData>()->fallback_path;
    }

    // When returning multiple matches, MAGIC_RAW makes the output parseable
    // into an array.
    if (magic_flags & MAGIC_CONTINUE)
      magic_flags |= MAGIC_RAW;

    flags_ = magic_flags;
  }

  // detectFile(path, callback) -> undefined
  Napi::Value DetectFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "First argument must be a string")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (info.Length() < 2 || !info[1].IsFunction()) {
      Napi::TypeError::New(env, "Second argument must be a callback function")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }

    DetectInput input = BaseInput(env);
    input.target_is_path = true;
    input.target_path = info[0].As<Napi::String>().Utf8Value();

    Queue(info, std::move(input), Napi::Value());
    return env.Undefined();
  }

  // detect(buffer, callback) -> this
  //
  // Returning `this` rather than undefined is a quirk of the original
  // implementation; preserved deliberately.
  Napi::Value Detect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
      Napi::TypeError::New(env, "Expecting 2 arguments")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (!info[0].IsBuffer()) {
      Napi::TypeError::New(env, "First argument must be a Buffer")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (!info[1].IsFunction()) {
      Napi::TypeError::New(env, "Second argument must be a callback function")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }

    Napi::Buffer<char> buf = info[0].As<Napi::Buffer<char>>();

    DetectInput input = BaseInput(env);
    input.target_is_path = false;
    input.target_data = buf.Data();
    input.target_len = buf.Length();

    Queue(info, std::move(input), info[0]);
    return info.This();
  }

 private:
  DetectInput BaseInput(Napi::Env env) {
    DetectInput input;
    input.source_is_path = source_is_path_;
    input.source_path = source_path_;
    input.source_data = source_data_;
    input.source_len = source_len_;
    input.fallback_path = env.GetInstanceData<AddonData>()->fallback_path;
    input.flags = flags_;
    return input;
  }

  // Hold strong references to the Magic instance (its std::strings back
  // source_path_) and to any Buffer we kept a raw pointer into, so neither can
  // be collected while the worker thread is running. Released in
  // OnOK/OnError. This replaces the old obj->Ref() that was never undone.
  void Queue(const Napi::CallbackInfo& info,
             DetectInput input,
             Napi::Value data_buffer) {
    std::vector<Napi::ObjectReference> keep_alive;
    keep_alive.push_back(Napi::Persistent(info.This().As<Napi::Object>()));
    if (!source_buffer_.IsEmpty())
      keep_alive.push_back(Napi::Persistent(source_buffer_.Value()));
    if (!data_buffer.IsEmpty() && data_buffer.IsObject())
      keep_alive.push_back(Napi::Persistent(data_buffer.As<Napi::Object>()));

    Napi::Function cb = info[1].As<Napi::Function>();
    auto* worker = new DetectWorker(cb, std::move(input), std::move(keep_alive));
    worker->Queue();
  }

  bool source_is_path_ = true;
  std::string source_path_;
  const char* source_data_ = nullptr;
  size_t source_len_ = 0;
  Napi::ObjectReference source_buffer_;
  int flags_ = 0;
};

// ---------------------------------------------------------------------------
// Module init.
// ---------------------------------------------------------------------------
namespace {

Napi::Value SetFallback(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto* data = env.GetInstanceData<AddonData>();
  data->fallback_path.clear();
  if (info.Length() > 0 && info[0].IsString())
    data->fallback_path = info[0].As<Napi::String>().Utf8Value();
  return info.This();
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  auto* data = new AddonData();
  // Node destroys this when the addon instance (this Agent) tears down, which
  // is what makes the addon safe to load in more than one thread.
  env.SetInstanceData(data);

  Magic::Init(env, exports);
  exports.Set("setFallback", Napi::Function::New(env, SetFallback));
  return exports;
}

}  // namespace

// NODE_API_MODULE is context-aware, unlike the NODE_MODULE it replaces.
NODE_API_MODULE(magic, InitAll)
