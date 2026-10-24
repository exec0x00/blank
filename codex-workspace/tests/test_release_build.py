"""Portable release provenance, bounded extraction and real startup liveness."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock
from urllib.error import HTTPError
from urllib.request import urlopen
import warnings
import zipfile

from scripts import release_build as release


SOURCE_ROOT = Path(__file__).resolve().parents[1]


class PortableReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="arc-portable-build-test-")
        self.scratch = Path(self.temporary.name)
        self.source = self.scratch / "source"
        self.source.mkdir()
        for name in release.INPUT_ROOTS:
            (self.source / name).mkdir()
        for name, contents in {
            "app.py": "# fixture bootstrap\n", "package.json": '{"scripts":{"verify":"fixture"}}\n',
            "package-lock.json": '{"lockfileVersion":3,"packages":{}}\n', "index.html": "<html>source</html>\n",
            "tsconfig.json": '{"include":["client","server","tests"]}\n', "vite.config.ts": "export default {};\n",
            "client/App.tsx": "export const app = 'Arc fixture';\n", "server/index.ts": "export const server = 'fixture';\n",
            "shared/types.ts": "export type Label = string;\n", "public/arc-mark.svg": "<svg/>\n",
            "native/binding.c": "/* Host-specific native binding source. */\n",
            "scripts/build-native.mjs": "// Native compilation remains on the host.\n", "tests/source.test.ts": "// Verified source.\n",
        }.items():
            (self.source / name).write_text(contents)
        self.calls = []

    def tearDown(self):
        self.temporary.cleanup()

    def output_assets(self, marker="Arc fixture"):
        for name, data in {
            "dist/client/index.html": b"<!doctype html><html>Arc Workspace</html>",
            "dist/client/assets/app.js": ("console.log(" + json.dumps(marker) + ");\n").encode(),
            "dist/client/arc-mark.svg": b"<svg xmlns='http://www.w3.org/2000/svg'/>",
            "dist/server/index.js": b"import http from 'node:http';\n// Fixture server.\n",
            "dist/native/binding.node": b"\x7fELFhost-specific-binary-must-not-be-packaged",
            "node_modules/fixture/index.js": b"// Installed only on the runtime host.\n",
        }.items():
            destination = self.source / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)

    def process(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if command == ["node", "--version"]:
            return subprocess.CompletedProcess(command, 0, stdout="v22.23.2\n")
        self.assertEqual(command, ["npm", "run", "verify"])
        self.output_assets()
        return subprocess.CompletedProcess(command, 0)

    def verified(self):
        with mock.patch.object(release.subprocess, "run", side_effect=self.process):
            return release.verify_build(self.source)

    def packaged(self):
        self.verified()
        return release.package_release(self.source)

    def runtime_copy(self, name="runtime"):
        working = self.scratch / name
        shutil.copytree(self.source, working, ignore=shutil.ignore_patterns("dist", "node_modules", "__pycache__"))
        return working

    def replace_archive(self, members, *, records=None):
        """Recompute outer integrity so malformed-member defenses are exercised."""
        archive_path = self.source / release.ARCHIVE
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name, content, mode in members:
                    info = zipfile.ZipInfo(name)
                    info.create_system = 3
                    info.external_attr = mode << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, content)
        content = archive_path.read_bytes()
        manifest = json.loads((self.source / release.MANIFEST).read_text())
        manifest.update(archiveSha256=hashlib.sha256(content).hexdigest(), archiveSize=len(content))
        if records is not None:
            manifest["files"] = sorted(records, key=lambda value: value["path"])
        (self.source / release.MANIFEST).write_text(json.dumps(manifest))

    def original_members(self):
        with zipfile.ZipFile(self.source / release.ARCHIVE) as archive:
            return [(entry.filename, archive.read(entry), entry.external_attr >> 16) for entry in archive.infolist()]

    def assert_runtime_rejects(self):
        working = self.runtime_copy()
        self.assertFalse(release.restore_release_build(working))
        self.assertFalse((working / "dist").exists())
        self.assertEqual(list(working.glob(".release-extract-*")), [])
        return working

    def test_verified_portable_assets_restore_without_dependencies_native_code_or_receipts(self):
        manifest = self.packaged()
        names = {entry["path"] for entry in manifest["files"]}
        self.assertEqual(names, {"dist/client/index.html", "dist/client/assets/app.js", "dist/client/arc-mark.svg", "dist/server/index.js"})
        with zipfile.ZipFile(self.source / release.ARCHIVE) as archive:
            self.assertEqual(set(archive.namelist()), names)
        working = self.runtime_copy()
        self.assertTrue(release.restore_release_build(working))
        for name in names:
            self.assertEqual((working / name).read_bytes(), (self.source / name).read_bytes())
            self.assertEqual(stat.S_IMODE((working / name).stat().st_mode), 0o644)
        self.assertFalse((working / "dist/native").exists())
        self.assertFalse((working / "node_modules").exists())
        self.assertFalse((working / release.RECEIPT).exists())
        self.assertEqual(list(working.glob(".release-extract-*")), [])

    def test_fingerprint_uses_source_bytes_and_names_independently_of_machine_paths_or_timestamps(self):
        original = release.source_fingerprint(self.source)
        self.packaged()
        copy = self.runtime_copy()
        for directory, _names, files in os.walk(copy):
            for name in files:
                os.utime(Path(directory) / name, ns=(1_000_000_000, 2_000_000_000))
        (copy / "client/App.tsx").chmod(0o755)
        self.assertEqual(original, release.source_fingerprint(copy))
        self.assertEqual(original, release.source_fingerprint(self.source))
        (copy / "client/App.tsx").rename(copy / "client/Renamed.tsx")
        self.assertNotEqual(original, release.source_fingerprint(copy))

    def test_changes_to_source_lock_native_source_public_assets_or_build_config_reject_old_receipts(self):
        self.packaged()
        for name in ["client/App.tsx", "server/index.ts", "shared/types.ts", "public/arc-mark.svg", "native/binding.c",
                     "scripts/build-native.mjs", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"]:
            with self.subTest(name=name):
                path = self.source / name
                before = path.read_bytes()
                path.write_bytes(before + b"\n// changed\n")
                try:
                    with self.assertRaisesRegex(release.ReleaseBuildError, "stale"):
                        release.package_release(self.source)
                    with self.assertRaisesRegex(release.ReleaseBuildError, "does not match"):
                        release.validate_release(self.source)
                finally:
                    path.write_bytes(before)
        (self.source / "postcss.config.js").write_text("export default {};\n")
        with self.assertRaises(release.ReleaseBuildError):
            release.package_release(self.source)

    def test_skipping_verification_requires_a_receipt_or_a_matching_verified_ci_package(self):
        self.output_assets()
        with self.assertRaisesRegex(release.ReleaseBuildError, "No matching verified build"):
            release.prepare_release(self.source, skip_verify=True)
        self.packaged()
        ci_checkout = self.runtime_copy()
        # Separate CI publication jobs do not carry any build output/Node install.
        self.assertFalse((ci_checkout / "dist").exists())
        release.prepare_release(ci_checkout, skip_verify=True)
        (ci_checkout / "package-lock.json").write_text('{"changed":"dependency"}')
        with self.assertRaisesRegex(release.ReleaseBuildError, "No matching verified build"):
            release.prepare_release(ci_checkout, skip_verify=True)

    def test_regular_preparation_runs_verification_and_packages_without_external_state(self):
        with mock.patch.object(release.subprocess, "run", side_effect=self.process):
            manifest = release.prepare_release(self.source, skip_verify=False)
        self.assertEqual([command for command, _kwargs in self.calls], [["node", "--version"], ["npm", "run", "verify"]])
        self.assertEqual(release.validate_release(self.source), manifest)

    def test_changed_outputs_cannot_be_packaged_using_a_valid_source_receipt(self):
        self.verified()
        (self.source / "dist/client/assets/app.js").write_text("unverified output")
        with self.assertRaisesRegex(release.ReleaseBuildError, "stale"):
            release.package_release(self.source)
        self.assertFalse((self.source / release.ARCHIVE).exists())

    def test_source_edits_during_verification_never_issue_a_new_receipt(self):
        self.verified()
        def concurrent_edit(command, **kwargs):
            result = self.process(command, **kwargs)
            if command[0] == "npm":
                (self.source / "client/App.tsx").write_text("changed while npm was building")
            return result
        with mock.patch.object(release.subprocess, "run", side_effect=concurrent_edit):
            with self.assertRaisesRegex(release.ReleaseBuildError, "Source changed during verification"):
                release.verify_build(self.source)
        self.assertFalse((self.source / release.RECEIPT).exists())

    def test_failed_verification_and_wrong_node_version_invalidate_previous_receipts(self):
        self.verified()
        def fail_build(command, **kwargs):
            if command[0] == "npm":
                raise subprocess.CalledProcessError(1, command)
            return self.process(command, **kwargs)
        with mock.patch.object(release.subprocess, "run", side_effect=fail_build):
            with self.assertRaises(subprocess.CalledProcessError):
                release.verify_build(self.source)
        self.assertFalse((self.source / release.RECEIPT).exists())
        self.verified()
        with mock.patch.object(release.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout="v20.20.2\n")):
            with self.assertRaisesRegex(release.ReleaseBuildError, "Node 22"):
                release.verify_build(self.source)
        self.assertFalse((self.source / release.RECEIPT).exists())

    def test_build_environment_and_decompressed_asset_secret_scanning_remain_active(self):
        private = "owned-fixture-secret-473638-not-a-real-credential"
        with mock.patch.dict(os.environ, {"HF_TOKEN": private, "WORKSPACE_PASSWORD": private,
                                         "CUSTOM_ACCESS_TOKEN": private, "VITE_PUBLIC_SETTING": "unstamped override", "NODE_ENV": "development"}):
            self.verified()
        for _command, kwargs in self.calls:
            self.assertNotIn("NODE_ENV", kwargs["env"])
            self.assertFalse(any(name in kwargs["env"] for name in ["HF_TOKEN", "WORKSPACE_PASSWORD", "CUSTOM_ACCESS_TOKEN", "VITE_PUBLIC_SETTING"]))
        def private_output(command, **kwargs):
            result = self.process(command, **kwargs)
            if command[0] == "npm":
                self.output_assets(private)
            return result
        with mock.patch.object(release.subprocess, "run", side_effect=private_output):
            release.verify_build(self.source)
        with self.assertRaisesRegex(release.ReleaseBuildError, "secret occurs"):
            release.package_release(self.source, (private.encode(),))
        release.package_release(self.source)
        with self.assertRaisesRegex(release.ReleaseBuildError, "secret occurs"):
            release.validate_release(self.source, (private.encode(),))

    def test_local_vite_environment_files_cannot_be_recorded_as_portable_source(self):
        for name in [".env", ".env.local", ".env.production", ".env.production.local", ".env.staging"]:
            with self.subTest(name=name):
                (self.source / name).write_text("VITE_SOMETHING=private-local-only")
                try:
                    with self.assertRaisesRegex(release.ReleaseBuildError, "Vite environment"):
                        release.verify_build(self.source)
                finally:
                    (self.source / name).unlink()

    def test_outer_archive_corruption_falls_back_without_creating_dist(self):
        self.packaged()
        path = self.source / release.ARCHIVE
        data = bytearray(path.read_bytes())
        data[len(data) // 2] ^= 0x5A
        path.write_bytes(data)
        self.assert_runtime_rejects()

    def test_inner_asset_corruption_fails_even_if_outer_archive_digest_is_recomputed(self):
        self.packaged()
        members = self.original_members()
        name, content, mode = members[0]
        members[0] = (name, b"x" * len(content), mode)
        self.replace_archive(members)
        self.assert_runtime_rejects()

    def test_path_escapes_absolute_paths_and_backslashes_are_never_extracted(self):
        self.packaged()
        original_archive = (self.source / release.ARCHIVE).read_bytes()
        original_manifest = (self.source / release.MANIFEST).read_bytes()
        original_members = self.original_members()
        outside = self.scratch / "outside.txt"
        outside.write_text("Retain this file")
        for index, attack in enumerate(["../../outside.txt", "/tmp/arc-unowned-file", "dist/client/../../../outside.txt",
                                        "dist/client/../server/index.js", "dist\\client\\index.html", "C:/dist/client/index.html"]):
            with self.subTest(attack=attack):
                members = list(original_members)
                members[0] = (attack, b"must not write", stat.S_IFREG | 0o644)
                self.replace_archive(members)
                working = self.runtime_copy("runtime-" + str(index))
                self.assertFalse(release.restore_release_build(working))
                self.assertFalse((working / "dist").exists())
                self.assertEqual(outside.read_text(), "Retain this file")
                (self.source / release.ARCHIVE).write_bytes(original_archive)
                (self.source / release.MANIFEST).write_bytes(original_manifest)

    def test_archive_symlinks_and_duplicate_names_are_rejected(self):
        self.packaged()
        members = self.original_members()
        name, data, _mode = members[0]
        members[0] = (name, data, stat.S_IFLNK | 0o777)
        self.replace_archive(members)
        self.assert_runtime_rejects()
        shutil.rmtree(self.scratch / "runtime")
        members[0] = (name, data, stat.S_IFREG | 0o644)
        members[-1] = members[0]
        self.replace_archive(members)
        self.assert_runtime_rejects()

    def test_oversized_archive_and_declared_output_limits_are_checked_before_extraction(self):
        self.packaged()
        original_archive = (self.source / release.ARCHIVE).read_bytes()
        with (self.source / release.ARCHIVE).open("r+b") as stream:
            stream.truncate(release.MAX_ARCHIVE_BYTES + 1)
        self.assert_runtime_rejects()
        shutil.rmtree(self.scratch / "runtime")
        (self.source / release.ARCHIVE).write_bytes(original_archive)
        manifest = json.loads((self.source / release.MANIFEST).read_text())
        manifest["files"][0]["size"] = release.MAX_FILE_BYTES + 1
        (self.source / release.MANIFEST).write_text(json.dumps(manifest))
        self.assert_runtime_rejects()

    def test_archive_directory_count_is_bounded_before_allocating_zip_members(self):
        self.packaged()
        archive_path = self.source / release.ARCHIVE
        content = bytearray(archive_path.read_bytes())
        content[-12:-10] = struct.pack("<H", release.MAX_ASSET_FILES + 1)
        archive_path.write_bytes(content)
        manifest_path = self.source / release.MANIFEST
        manifest = json.loads(manifest_path.read_text())
        manifest["archiveSha256"] = hashlib.sha256(content).hexdigest()
        manifest_path.write_text(json.dumps(manifest))
        with mock.patch.object(release.zipfile, "ZipFile") as opener:
            self.assert_runtime_rejects()
            opener.assert_not_called()

    def test_source_output_and_release_directory_symlinks_cannot_supply_a_release(self):
        self.verified()
        source_link = self.source / "client/link.ts"
        source_link.symlink_to(self.source / "server/index.ts")
        with self.assertRaises(release.ReleaseBuildError):
            release.package_release(self.source)
        source_link.unlink()
        asset = self.source / "dist/client/assets/app.js"
        asset.unlink()
        asset.symlink_to(self.source / "server/index.ts")
        with self.assertRaises(release.ReleaseBuildError):
            release.package_release(self.source)
        asset.unlink()
        self.packaged()
        (self.source / "release").rename(self.scratch / "unowned-release")
        (self.source / "release").symlink_to(self.scratch / "unowned-release", target_is_directory=True)
        with self.assertRaises(release.ReleaseBuildError):
            release.validate_release(self.source)

    def test_native_binary_disguised_as_javascript_and_extra_server_files_are_rejected(self):
        self.output_assets()
        (self.source / "dist/client/assets/disguised.js").write_bytes(b"\x7fELFfake-host-binary")
        with self.assertRaisesRegex(release.ReleaseBuildError, "Host executable"):
            release.asset_inventory(self.source)
        (self.source / "dist/client/assets/disguised.js").unlink()
        (self.source / "dist/server/private.json").write_text('{"private":"not an application bundle"}')
        with self.assertRaisesRegex(release.ReleaseBuildError, "Only the application"):
            release.asset_inventory(self.source)

    def test_extraction_never_overwrites_an_existing_dist_directory_or_symlink(self):
        self.packaged()
        for kind in ["directory", "symlink"]:
            with self.subTest(kind=kind):
                working = self.runtime_copy("runtime-" + kind)
                preserved = working / "existing"
                preserved.mkdir()
                (preserved / "keep.txt").write_text("Existing output")
                if kind == "directory":
                    preserved.rename(working / "dist")
                    preserved = working / "dist"
                else:
                    (working / "dist").symlink_to(preserved, target_is_directory=True)
                self.assertFalse(release.restore_release_build(working))
                self.assertEqual((preserved / "keep.txt").read_text(), "Existing output")

    def test_manifest_duplicate_keys_and_non_verification_records_are_rejected(self):
        self.packaged()
        manifest_path = self.source / release.MANIFEST
        original = manifest_path.read_text()
        manifest_path.write_text(original[:-2] + ',"schema":1}\n')
        self.assert_runtime_rejects()
        shutil.rmtree(self.scratch / "runtime")
        manifest = json.loads(original)
        manifest["verification"] = "dist existed"
        manifest_path.write_text(json.dumps(manifest))
        self.assert_runtime_rejects()

    def test_full_build_fallback_and_cache_reuse_both_keep_the_real_root_listener_healthy(self):
        self.packaged()
        spaces = types.ModuleType("spaces")
        spaces.GPU = lambda **_kwargs: lambda function: function
        spec = importlib.util.spec_from_file_location("arc_release_bootstrap_test", SOURCE_ROOT / "app.py")
        app = importlib.util.module_from_spec(spec)
        with mock.patch.dict(sys.modules, {"spaces": spaces}):
            spec.loader.exec_module(app)
        for case in ["valid", "missing", "stale", "corrupt"]:
            with self.subTest(case=case):
                working = self.runtime_copy("runtime-" + case)
                if case == "missing":
                    (working / release.ARCHIVE).unlink()
                elif case == "stale":
                    (working / "package-lock.json").write_text('{"new":"lock"}')
                elif case == "corrupt":
                    (working / release.ARCHIVE).write_bytes(b"not a zip archive")
                server = app.BootstrapServer("127.0.0.1", 0)
                base = "http://127.0.0.1:" + str(server.server.server_address[1])
                entered = [threading.Event(), threading.Event()]
                proceed = [threading.Event(), threading.Event()]
                commands, result = [], []
                def child(command, _directory, _environment):
                    index = len(commands)
                    commands.append(command)
                    entered[index].set()
                    if not proceed[index].wait(timeout=5):
                        raise AssertionError("The owned build fixture was not released.")
                    return 0
                runner = threading.Thread(target=lambda: result.append(app.prepare_application(working, "fixture-npm", {}, server)))
                try:
                    with mock.patch.object(app, "run_child", side_effect=child):
                        runner.start()
                        for index in range(2):
                            self.assertTrue(entered[index].wait(timeout=5))
                            for _ in range(3):
                                with urlopen(base + "/?during=preparation", timeout=2) as response:
                                    self.assertEqual((response.status, response.read()), (200, b"status: ok"))
                            with self.assertRaises(HTTPError) as unavailable:
                                urlopen(base + "/work", timeout=2)
                            self.assertEqual(unavailable.exception.code, 503)
                            unavailable.exception.close()
                            proceed[index].set()
                        runner.join(timeout=5)
                    self.assertFalse(runner.is_alive())
                    self.assertEqual(result, [0])
                    self.assertEqual(commands, [["fixture-npm", "ci", "--include=dev", "--no-audit", "--no-fund"],
                                                ["fixture-npm", "run", "build:native" if case == "valid" else "build"]])
                    self.assertEqual((working / "dist/client/index.html").exists(), case == "valid")
                finally:
                    for event in proceed:
                        event.set()
                    if runner.is_alive():
                        runner.join(timeout=5)
                    server.close()


if __name__ == "__main__":
    unittest.main()
