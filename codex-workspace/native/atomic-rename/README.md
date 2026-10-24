# Atomic no-replace rename

This dependency-free Node-API binding calls Linux `renameat2(RENAME_NOREPLACE)`
on duplicated directory descriptors. Directory validation and the filesystem
operation run in the Node worker pool; JavaScript never blocks on the FUSE
rename. It accepts only single UTF-8 basenames of at most 255 bytes. An existing
destination, including a symlink, is never replaced. There is no copy, link,
ordinary rename, or subprocess fallback.

Run `node scripts/build-native.mjs` with the existing Node headers and C compiler.
The artifact is `dist/native/atomic-rename.node`, outside the static client
directory. A source/build-script/Node/header/compiler fingerprint and binary
hash allow repeated build hooks to reuse only the matching artifact. The server
loads this fixed artifact in both TS development and bundled production.

`server/native-atomic-rename.ts` exports `renameNoReplace(fromDirFd, fromLeaf,
toDirFd, toLeaf): Promise<void>` and `atomicRenameAvailability()`. Availability
reports the platform/addon, not a filesystem capability. Before moving existing
state aside, callers must use the real operation to prepare a private inode on
that filesystem. Preserve errors and recovery bytes: a filesystem failure may
be ambiguous. Callers own file flushes, directory durability, source validation,
and post-operation verification. Unsupported platforms, unavailable bindings,
unsupported operations, and cross-device renames all fail closed.
