#define _GNU_SOURCE
#include <node_api.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Linux renameat2 flag. Do not substitute rename(), link(), or a copy. */
#define CODEX_RENAME_NOREPLACE 1U
#define CODEX_LEAF_BYTES 255

typedef struct {
  napi_deferred deferred;
  napi_async_work work;
  int from_fd;
  int to_fd;
  char from_leaf[CODEX_LEAF_BYTES + 1];
  char to_leaf[CODEX_LEAF_BYTES + 1];
  int error_number;
  const char *syscall_name;
} rename_request;

static bool read_fd(napi_env env, napi_value value, int *out) {
  napi_valuetype type;
  double number;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_number ||
      napi_get_value_double(env, value, &number) != napi_ok ||
      !isfinite(number) || number < 0 || number > INT_MAX ||
      number != (double)(int)number) {
    napi_throw_type_error(env, "ERR_INVALID_ARG_VALUE", "Directory descriptors must be nonnegative integers.");
    return false;
  }
  *out = (int)number;
  return true;
}

static bool read_leaf(napi_env env, napi_value value, char *out) {
  napi_valuetype type;
  size_t length = 0;
  size_t written = 0;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok ||
      length == 0 || length > CODEX_LEAF_BYTES ||
      napi_get_value_string_utf8(env, value, out, CODEX_LEAF_BYTES + 1, &written) != napi_ok ||
      written != length || memchr(out, '\0', length) != NULL ||
      memchr(out, '/', length) != NULL || strcmp(out, ".") == 0 || strcmp(out, "..") == 0) {
    napi_throw_type_error(env, "ERR_INVALID_ARG_VALUE", "Names must be single, nonempty basenames of at most 255 UTF-8 bytes.");
    return false;
  }
  return true;
}

static void close_descriptors(rename_request *request) {
  /* Never retry close(EINTR): on Linux the descriptor has already been released. */
  if (request->from_fd >= 0) close(request->from_fd);
  if (request->to_fd >= 0) close(request->to_fd);
  request->from_fd = request->to_fd = -1;
}

static napi_value operation_error(napi_env env, const rename_request *request) {
  napi_value message, error, number, syscall_name;
  if (napi_create_string_utf8(env, "Atomic no-replace rename failed.", NAPI_AUTO_LENGTH, &message) != napi_ok ||
      napi_create_error(env, NULL, message, &error) != napi_ok ||
      napi_create_int32(env, -request->error_number, &number) != napi_ok ||
      napi_create_string_utf8(env, request->syscall_name, NAPI_AUTO_LENGTH, &syscall_name) != napi_ok ||
      napi_set_named_property(env, error, "errno", number) != napi_ok ||
      napi_set_named_property(env, error, "syscall", syscall_name) != napi_ok) return NULL;
  return error;
}

static void execute_rename(napi_env env, void *data) {
  (void)env;
  rename_request *request = data;
  struct stat from_stat, to_stat;
  request->syscall_name = "fstat";
  if (fstat(request->from_fd, &from_stat) < 0 || fstat(request->to_fd, &to_stat) < 0) {
    request->error_number = errno;
    return;
  }
  if (!S_ISDIR(from_stat.st_mode) || !S_ISDIR(to_stat.st_mode)) {
    request->error_number = ENOTDIR;
    return;
  }
  request->syscall_name = "renameat2";
#if defined(__linux__) && defined(SYS_renameat2)
  /* Do not retry a mutation after an ambiguous filesystem failure. */
  if (syscall(SYS_renameat2, request->from_fd, request->from_leaf,
              request->to_fd, request->to_leaf, CODEX_RENAME_NOREPLACE) < 0) request->error_number = errno;
#else
  request->error_number = ENOSYS;
#endif
}

static void complete_rename(napi_env env, napi_status status, void *data) {
  rename_request *request = data;
  close_descriptors(request);
  if (status != napi_ok && request->error_number == 0) request->error_number = ECANCELED;
  if (request->error_number != 0) {
    napi_value error = operation_error(env, request);
    if (error != NULL) napi_reject_deferred(env, request->deferred, error);
  } else {
    napi_value undefined;
    if (napi_get_undefined(env, &undefined) == napi_ok) napi_resolve_deferred(env, request->deferred, undefined);
  }
  napi_delete_async_work(env, request->work);
  free(request);
}

static napi_value rename_no_replace(napi_env env, napi_callback_info info) {
  napi_value args[5], promise, name;
  size_t argc = 5;
  int from_fd, to_fd;
  rename_request parsed = { .from_fd = -1, .to_fd = -1 };
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok) return NULL;
  if (argc != 4) {
    napi_throw_type_error(env, "ERR_INVALID_ARG_VALUE", "Expected two directory descriptors and two basenames.");
    return NULL;
  }
  if (!read_fd(env, args[0], &from_fd) || !read_leaf(env, args[1], parsed.from_leaf) ||
      !read_fd(env, args[2], &to_fd) || !read_leaf(env, args[3], parsed.to_leaf)) return NULL;
  rename_request *request = calloc(1, sizeof(*request));
  if (request == NULL) {
    napi_throw_error(env, "ENOMEM", "Could not allocate an atomic rename request.");
    return NULL;
  }
  *request = parsed;
  request->syscall_name = "fcntl";
  if (napi_create_promise(env, &request->deferred, &promise) != napi_ok) { free(request); return NULL; }
  /* Duplicate synchronously, before returning to JS. FileHandle.close() or fd
     reuse by the caller cannot redirect the queued operation. Slow directory
     checks and the FUSE rename itself run only on the worker pool. */
  request->from_fd = fcntl(from_fd, F_DUPFD_CLOEXEC, 0);
  if (request->from_fd < 0) request->error_number = errno;
  /* A stale destination fd may be the first free slot. Do not let our own
     source duplicate turn that invalid argument into a valid destination. */
  else if (request->from_fd == to_fd && from_fd != to_fd) request->error_number = EBADF;
  else {
    request->to_fd = fcntl(to_fd, F_DUPFD_CLOEXEC, 0);
    if (request->to_fd < 0) request->error_number = errno;
  }
  if (request->error_number != 0) {
    close_descriptors(request);
    napi_value error = operation_error(env, request);
    if (error != NULL) napi_reject_deferred(env, request->deferred, error);
    free(request);
    return promise;
  }
  request->syscall_name = "renameat2";
  if (napi_create_string_utf8(env, "codex:renameNoReplace", NAPI_AUTO_LENGTH, &name) != napi_ok ||
      napi_create_async_work(env, NULL, name, execute_rename, complete_rename, request, &request->work) != napi_ok) {
    close_descriptors(request);
    free(request);
    napi_throw_error(env, "ERR_NAPI_FAILURE", "Could not prepare an atomic rename worker.");
    return NULL;
  }
  if (napi_queue_async_work(env, request->work) != napi_ok) {
    close_descriptors(request);
    napi_delete_async_work(env, request->work);
    free(request);
    napi_throw_error(env, "ERR_NAPI_FAILURE", "Could not queue an atomic rename worker.");
    return NULL;
  }
  return promise;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value version;
  if (napi_create_int32(env, 1, &version) != napi_ok) return NULL;
  napi_property_descriptor properties[] = {
    { "renameNoReplace", NULL, rename_no_replace, NULL, NULL, NULL, napi_default, NULL },
    { "interfaceVersion", NULL, NULL, NULL, NULL, version, napi_default, NULL },
  };
  if (napi_define_properties(env, exports, 2, properties) != napi_ok) return NULL;
  return exports;
}

NAPI_MODULE(atomic_rename, initialize)
