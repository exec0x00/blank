# Portable application releases

Cold startup previously repeated TypeScript checking, the Vite client build and the esbuild server bundle after every source deployment. Those outputs contain portable JavaScript and static assets. Arc now verifies and packages them before publication, while continuing to install dependencies and compile the native atomic-rename binding for the actual runtime host. Official Codex CLI installation and saved-state restoration keep their existing policies.

`scripts/release_build.py verify` runs the same `npm run verify` pipeline with Node 22.12 or newer in the Node 22 series. It records a receipt only after success, comparing source fingerprints before and after the operation. The receipt includes hashes of the emitted assets. A plain `dist` directory, a failed verification run, changed output, or an old receipt cannot authorize a new package.

The source fingerprint covers the application entry point, package manifest and lockfile, TypeScript/build configurations, client/server/shared source, public assets, native source, scripts and tests. It uses relative paths and SHA-256 hashes of bytes; absolute machine paths, timestamps, installed dependencies, generated native binaries, receipts and release files do not affect it. Local Vite environment files are rejected for release verification, and build children do not inherit private or `VITE_*` environment values. Both release and startup fallback builds use production mode.

For local publication after independently reviewing the changes:

```sh
python3 scripts/release_build.py verify
python3 -m unittest tests/test_release_build.py tests/test_space_bootstrap.py tests/test_space_maintenance.py
python3 scripts/deploy.py --source-only --skip-verify --parent-commit <current-space-commit>
```

The deployment command packages the receipt's exact assets and scans their uncompressed bytes for the externally supplied deployment secrets. Without `--skip-verify`, deployment performs verification first. Packaging failure stops publication with a visible error. To inspect the package without publishing:

```sh
python3 scripts/release_build.py package
python3 scripts/release_build.py check
```

The only published generated files are `release/workspace-build.json` and `release/workspace-build.zip`. The archive contains regular files under `dist/client`, plus the single `dist/server/index.js` bundle. It excludes dependency trees, native bindings, build receipts, host paths and executable binaries. GitHub's verification job transfers only this manifest/archive to the separate deployment job; deployment validates source and artifact integrity again before uploading.

The Python launcher first starts its constant `status: ok` listener, copies source into owned temporary storage and runs `npm ci`. It then checks the manifest schema, matching source/lock fingerprint, archive size/hash, exact file inventory, regular-file types and each decompressed file's size/hash. Archive and output sizes, entry counts and path lengths are bounded. Symlinks, duplicate members, path traversal, absolute paths, unexpected files and native executable signatures are rejected. Valid output is unpacked into a private staging directory and promoted only after all checks pass; existing `dist` paths are never overwritten by extraction.

A missing, stale, malformed or damaged package falls back to the ordinary `npm run build` in owned temporary storage. It cannot skip source validation or force a partial package into service. A valid package instead runs `npm run build:native`, preserving the runtime host's own binding and dependency installation. Neither path modifies user storage or changes the public socket handoff. Root liveness stays available while `/work` truthfully waits for application readiness.

The archive and manifest are integrity records inside the trusted application release, not an external code-loading API or a signature service. Changing source after packaging produces a cache miss and full build; the package never changes the meaning of workspace readiness. Dependency installation, native startup and persistent metadata restoration still take time, so skipping the repeated application build does not make a cold start instantaneous.
