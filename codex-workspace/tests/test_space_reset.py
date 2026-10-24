"""Run with: python -m unittest discover -s tests -p 'test_space_*.py'."""

from __future__ import annotations

import copy
from email.message import Message
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import MethodType
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("space_reset", Path(__file__).resolve().parents[1] / "scripts/reset-space-data.py")
reset = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reset)


def response_headers(xet_hash=None):
    headers = Message()
    if xet_hash is not None:
        headers["x-xet-hash"] = xet_hash
    return headers


class DownloadResponse(io.BytesIO):
    def __init__(self, value, xet_hash, address):
        super().__init__(value)
        self.headers = response_headers(xet_hash)
        self.status = 200
        self.address = address

    def geturl(self):
        return self.address


def download_opener(value, final_hash=None, redirects=()):
    """Keep real redirect validation; replace only the external HTTP transport."""
    def build(*handlers):
        identity = next(handler for handler in handlers if isinstance(handler, reset.ReviewedXetRedirectHandler))

        class Opener:
            def open(self, request, timeout):
                for address, xet_hash in redirects:
                    with io.BytesIO(b"redirect body") as response:
                        request = identity.redirect_request(request, response, 302, "Found", response_headers(xet_hash), address)
                return DownloadResponse(value, final_hash, request.full_url)

        return Opener()
    return build


class FakeBuckets:
    def __init__(self, files):
        self.files = copy.deepcopy(files)
        self.deletions = []
        self.fail_partial = False
        self.after_delete = None
        self.corrupt_download = False

    def metadata(self, path, value):
        return {"type": "file", "path": path, "size": len(value), "xet_hash": hashlib.sha256(value).hexdigest()}

    def inventory(self):
        return {bucket: [self.metadata(path, value) for path, value in files.items()] for bucket, files in self.files.items()}

    def info(self, bucket, paths):
        return [self.metadata(path, self.files[bucket][path]) for path in paths if path in self.files[bucket]]

    def download(self, entry, target):
        value = self.files[entry["bucket"]][entry["path"]]
        with target.open("xb") as stream:
            stream.write(value if not self.corrupt_download else b"x" * len(value))
        return hashlib.sha256(value).hexdigest(), len(value)

    def delete(self, bucket, paths):
        self.deletions.append((bucket, paths.copy()))
        for index, path in enumerate(paths):
            del self.files[bucket][path]
            if index == 0 and self.fail_partial:
                self.fail_partial = False
                raise RuntimeError("Simulated non-transactional API interruption")
        if self.after_delete:
            self.after_delete()


class ResetWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="space-reset-test-")
        self.root = Path(self.temporary.name)
        self.marker = {
            "version": 1, "purpose": reset.PURPOSE, "space": reset.SPACE,
            "nonce": "1" * 32, "entrypoint_sha256": "2" * 64,
        }
        self.receipt = {
            **self.marker, "state": "waiting", "node_started": False,
            "boot_id": "3" * 32, "process_id": 123,
        }
        thread_id = "thr_" + "a" * 32
        uuid = "12345678-abcd-abcd-abcd-123456789012"
        self.files = {
            reset.DATA_BUCKET: {
                "codex-final/app.py": b"preserved application source",
                "codex-final/.github/workflows/deploy.yml": b"preserved workflow",
                reset.MARKER_PATH: reset.canonical(self.marker),
                "codex-workspace/state/settings.json": b'{"preserve":"settings"}',
                "codex-workspace/state/extensions.json": b'{"preserve":"plugins"}',
                "codex-workspace/state/model-registry-v1.json": b'{"preserve":"profiles"}',
                "codex-workspace/state/github-accounts.json": b'{"preserve":"accounts"}',
                "codex-workspace/state/secrets.json": b"preserved ciphertext",
                "codex-workspace/state/auth-sessions-v2/session.json": b"preserved login",
                "codex-workspace/state/unknown-personal.json": b"preserved unrelated state",
                "codex-workspace/state/workspace-credentials.json": b"preserved unrelated credentials",
                "codex-workspace/state/ui-state.json": b"old open files and thread selections",
                "codex-workspace/state/filesystem-metadata.json": b"old filesystem records",
                f"codex-workspace/state/thread-{thread_id}.json": b"old legacy conversation",
                f"codex-workspace/state/codex-thread-{uuid}.json": b"old native binding",
                f"codex-workspace/state/workspace-record-{uuid}.json": b"old project",
                f"codex-workspace/state/.state-cas-thread-{thread_id}-{'b' * 32}/source.json": b"old recovery data",
                "codex-workspace/state/codex-cli-inputs-v1/pending.json": b"old queued message",
                "codex-workspace/state/conversation-files-v1/attachment.file": b"old attachment",
                "codex-workspace/state/memories/history.json": b"derived memory",
                "codex-workspace/state/git-checkpoints-v1/before.json": b"old project checkpoint",
                "codex-workspace/native-codex/config.toml": b"preserved native configuration",
                "codex-workspace/native-codex/skills/custom/SKILL.md": b"preserved custom skill",
                "codex-workspace/native-codex/rules/custom.rules": b"preserved custom rules",
                "codex-workspace/native-codex/workflows/reusable.md": b"preserved reusable workflow",
                "codex-workspace/native-codex/auth.json": b"preserved credentials",
                "codex-workspace/native-codex/state_5.sqlite": b"old database",
                "codex-workspace/native-codex/state_5.sqlite-wal": b"old WAL",
                "codex-workspace/native-codex/state_5.sqlite-shm": b"old shared memory",
                "codex-workspace/native-codex/goals_1.sqlite": b"old goals",
                "codex-workspace/native-codex/queue_1.sqlite": b"old queued messages",
                "codex-workspace/native-codex/thread_history_1.sqlite": b"old transcript",
                "codex-workspace/native-codex/memories_1.sqlite": b"old derived memory",
                "codex-workspace/native-codex/logs_2.sqlite": b"old diagnostic messages",
                "codex-workspace/native-codex/thread-writer-locks/old.lock": b"old writer",
                "codex-workspace/native-codex/sessions/session.jsonl": b"old messages",
                "codex-workspace/native-codex/archived_sessions/archive.jsonl": b"old archive",
                "codex-workspace/native-codex/.tmp/plugins/.git/config": b"reproducible cache",
                "codex-workspace/native-codex/.tmp/plugins.sha": b"cache revision",
                "codex-workspace/native-codex/.tmp/unrelated/custom.txt": b"preserved unknown scratch",
                "home/.codex/auth.json": b"preserved legacy credentials",
                "home/.codex/skills/custom/SKILL.md": b"preserved legacy custom skill",
                "home/.codex/state_5.sqlite": b"old legacy database",
                "home/.codex/state_5.sqlite-shm": b"old legacy shared memory",
                "home/.codex/history.jsonl": b"old legacy input history",
                "home/.codex/.tmp/plugins/.git/HEAD": b"reproducible old cache",
                "home/.bashrc": b"preserved shell config",
                "home/.local/state/terminal-history/old.history": b"old terminal commands",
                "home/.python_history": b"old Python input",
                "home/.ssh/config": b"preserved unrelated access",
                "workspaces/project/README.md": b"old project content",
                "workspaces/.trash/deleted/README.md": b"old deleted project content",
                "generated-images-v1/image.png": b"old generated image",
                "unrelated/research.txt": b"preserved unrelated data",
            },
            reset.TRANSFER_BUCKET: {
                "imports/old/file.pdf": b"old file staging",
                "exports/old/file.txt": b"old download staging",
                "downloads/keep.txt": b"preserved unrecognized namespace",
                "verification/keep.txt": b"preserved unrelated bucket object",
            },
        }
        self.client = FakeBuckets(self.files)
        self.plan = reset.make_plan(self.client.inventory(), self.marker)
        self.backup_path = self.root / "backup"
        self.journal_path = self.root / "journal.json"

    def tearDown(self):
        if (self.backup_path / "objects").exists():
            (self.backup_path / "objects").chmod(0o700)
        self.temporary.cleanup()

    def fetch(self):
        return self.receipt.copy()

    def backup(self):
        return reset.make_backup(self.plan, self.client, self.backup_path, self.fetch)

    def apply(self, **kwargs):
        return reset.apply_plan(self.plan, self.client, self.backup_path, self.journal_path,
                                self.plan["plan_sha256"], self.fetch, **kwargs)

    def test_plan_covers_database_sidecars_legacy_history_and_preserves_configuration(self):
        chosen = {(entry["bucket"], entry["path"]): entry for entry in self.plan["entries"]}
        for path in ["codex-workspace/native-codex/state_5.sqlite-wal", "home/.codex/state_5.sqlite-shm",
                     "home/.python_history", "workspaces/.trash/deleted/README.md"]:
            self.assertEqual(chosen[(reset.DATA_BUCKET, path)]["action"], "delete")
        for path in ["codex-final/app.py", "codex-workspace/state/github-accounts.json",
                     "codex-workspace/state/workspace-credentials.json", "home/.codex/auth.json",
                     "codex-workspace/native-codex/skills/custom/SKILL.md", "unrelated/research.txt"]:
            self.assertEqual(chosen[(reset.DATA_BUCKET, path)]["action"], "preserve")
        cache = chosen[(reset.DATA_BUCKET, "codex-workspace/native-codex/.tmp/plugins/.git/config")]
        self.assertEqual(cache["action"], "delete")
        self.assertFalse(cache["backup_required"])
        self.assertEqual(self.client.files, self.files)
        self.assertFalse(self.client.deletions)

    def test_invalid_inventory_paths_and_hashes_cannot_enter_plan(self):
        for path in ["/workspaces/a", "workspaces/../codex-final/app.py", "workspaces//a", "workspaces/a\\b", "workspaces/./a"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                reset.classify(reset.DATA_BUCKET, path)
        with self.assertRaises(ValueError):
            reset.normalize_inventory(reset.DATA_BUCKET, [{"path": "workspaces/a", "size": 2, "xet_hash": "no-hash"}])

    def test_recomputed_manifest_cannot_select_preserved_source(self):
        altered = copy.deepcopy(self.plan)
        source = next(entry for entry in altered["entries"] if entry["path"] == "codex-final/app.py")
        source.update(action="delete", category="projects-and-trash", backup_required=True)
        altered["plan_sha256"] = reset.digest({key: value for key, value in altered.items() if key != "plan_sha256"})
        with self.assertRaisesRegex(ValueError, "allowlist"):
            reset.validate_plan(altered)

    def test_backup_apply_verify_remove_exact_objects_and_keep_preserved_bytes(self):
        backup = self.backup()
        self.assertEqual(len(backup["objects"]), sum(entry["backup_required"] for entry in self.plan["entries"]))
        self.assertFalse(self.client.deletions)
        result = self.apply(batch_size=7)
        self.assertEqual(result["status"], "complete")
        for entry in self.plan["entries"]:
            actual = self.client.files[entry["bucket"]].get(entry["path"])
            if entry["action"] == "delete":
                self.assertIsNone(actual)
            else:
                self.assertEqual(actual, self.files[entry["bucket"]][entry["path"]])
        deletion_count = len(self.client.deletions)
        self.assertEqual(self.apply()["status"], "complete")
        self.assertEqual(len(self.client.deletions), deletion_count)
        self.assertEqual(reset.verify_backup(self.plan, self.backup_path)["backup_sha256"], backup["backup_sha256"])

    def test_tampered_backup_stops_before_any_deletion(self):
        backup = self.backup()
        target = self.backup_path / backup["objects"][0]["filename"]
        target.chmod(0o600)
        target.write_bytes(b"corrupted")
        target.chmod(0o400)
        with self.assertRaisesRegex(ValueError, "backup object"):
            self.apply()
        self.assertFalse(self.client.deletions)

    def test_same_size_stale_download_cannot_seal_backup_or_authorize_deletion(self):
        entry = next(entry for entry in self.plan["entries"] if entry["backup_required"])
        wrong_bytes = b"x" * entry["size"]
        self.assertNotEqual(wrong_bytes, self.client.files[entry["bucket"]][entry["path"]])
        self.client.download = MethodType(reset.BucketClient.download, self.client)
        with patch.object(reset, "build_opener", side_effect=download_opener(wrong_bytes, "f" * 64)):
            with self.assertRaisesRegex(ValueError, "reviewed Xet hash"):
                self.backup()
        self.assertFalse((self.backup_path / "backup.json").exists())
        self.assertFalse(list((self.backup_path / "objects").iterdir()))
        with self.assertRaises(OSError):
            self.apply()
        self.assertFalse(self.client.deletions)
        self.assertEqual(self.client.files, self.files)

    def test_download_requires_a_matching_hash_even_when_all_bytes_and_sizes_match(self):
        entry = next(entry for entry in self.plan["entries"] if entry["backup_required"])
        value = self.client.files[entry["bucket"]][entry["path"]]
        target = self.root / "missing-identity"
        with patch.object(reset, "build_opener", side_effect=download_opener(value)):
            with self.assertRaisesRegex(ValueError, "did not attest"):
                reset.BucketClient.download(self.client, entry, target)
        self.assertFalse(target.exists())

    def test_download_accepts_reviewed_hash_on_redirect_and_checks_final_size_and_sha256(self):
        entry = next(entry for entry in self.plan["entries"] if entry["backup_required"])
        value = self.client.files[entry["bucket"]][entry["path"]]
        target = self.root / "verified-download"
        redirects = [("https://cas-bridge.xethub.hf.co/signed-object", entry["xet_hash"])]
        with patch.object(reset, "build_opener", side_effect=download_opener(value, redirects=redirects)):
            actual = reset.BucketClient.download(self.client, entry, target)
        self.assertEqual(actual, (hashlib.sha256(value).hexdigest(), len(value)))
        self.assertEqual(target.read_bytes(), value)
        with patch.object(reset, "build_opener", side_effect=download_opener(value[:-1], redirects=redirects)):
            with self.assertRaisesRegex(ValueError, "reviewed size"):
                reset.BucketClient.download(self.client, entry, self.root / "truncated-download")

    def test_conflicting_hash_on_any_redirect_or_final_response_is_rejected(self):
        entry = next(entry for entry in self.plan["entries"] if entry["backup_required"])
        value = self.client.files[entry["bucket"]][entry["path"]]
        reviewed = entry["xet_hash"]
        cas = "https://cas-bridge.xethub.hf.co/signed-object"
        for index, (redirects, final_hash) in enumerate([
            ([(cas, "f" * 64)], reviewed),
            ([(cas, reviewed), (cas + "-next", "f" * 64)], reviewed),
            ([(cas, reviewed)], "f" * 64),
        ]):
            target = self.root / f"conflicting-download-{index}"
            with self.subTest(index=index), patch.object(reset, "build_opener", side_effect=download_opener(value, final_hash, redirects)):
                with self.assertRaisesRegex(ValueError, "reviewed Xet hash"):
                    reset.BucketClient.download(self.client, entry, target)
            self.assertFalse(target.exists())

    def test_download_rejects_redirect_to_untrusted_or_plain_http_host(self):
        entry = next(entry for entry in self.plan["entries"] if entry["backup_required"])
        value = self.client.files[entry["bucket"]][entry["path"]]
        for address in ["http://cas-bridge.xethub.hf.co/object", "https://huggingface.co.example.org/object", "https://user:password@huggingface.co/object"]:
            with self.subTest(address=address), patch.object(reset, "build_opener", side_effect=download_opener(value, redirects=[(address, entry["xet_hash"])])):
                with self.assertRaisesRegex(ValueError, "allowed HTTPS"):
                    reset.BucketClient.download(self.client, entry, self.root / "unsafe-download")

    def test_incomplete_or_reused_backup_is_never_accepted(self):
        self.client.corrupt_download = True
        with self.assertRaisesRegex(ValueError, "reread"):
            self.backup()
        self.assertFalse((self.backup_path / "backup.json").exists())
        with self.assertRaises(OSError):
            self.backup()
        self.assertFalse(self.client.deletions)

    def test_missing_review_digest_and_gate_nonce_block_apply(self):
        self.backup()
        with self.assertRaisesRegex(ValueError, "reviewed plan"):
            reset.apply_plan(self.plan, self.client, self.backup_path, self.journal_path, "0" * 64, self.fetch)
        for field, value in [("nonce", "4" * 32), ("entrypoint_sha256", "4" * 64),
                             ("boot_id", "4" * 32), ("node_started", True), ("state", "releasing")]:
            previous = self.receipt[field]
            self.receipt[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "maintenance receipt"):
                self.apply()
            self.receipt[field] = previous
        self.assertFalse(self.client.deletions)

    def test_selected_or_preserved_change_or_new_file_blocks_apply(self):
        self.backup()
        for path in ["workspaces/project/README.md", "codex-workspace/native-codex/config.toml", "workspaces/new-project/new.txt"]:
            old = self.client.files[reset.DATA_BUCKET].get(path)
            self.client.files[reset.DATA_BUCKET][path] = b"unexpected later write"
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.apply()
            if old is None:
                del self.client.files[reset.DATA_BUCKET][path]
            else:
                self.client.files[reset.DATA_BUCKET][path] = old
        self.assertFalse(self.client.deletions)

    def test_partial_api_batch_resumes_only_recorded_attempts(self):
        self.backup()
        self.client.fail_partial = True
        with self.assertRaisesRegex(RuntimeError, "interruption"):
            self.apply(batch_size=4)
        journal = json.loads(self.journal_path.read_text())
        self.assertEqual(len(journal["attempted"]), 4)
        self.assertFalse(journal["deleted"])
        self.assertEqual(self.apply(batch_size=4)["status"], "complete")
        reset.verify_removed(self.plan, self.client)

    def test_gate_loss_stops_remaining_batches(self):
        self.backup()
        self.client.after_delete = lambda: self.receipt.update(state="releasing")
        with self.assertRaisesRegex(ValueError, "maintenance receipt"):
            self.apply(batch_size=2)
        self.assertEqual(len(self.client.deletions), 1)
        self.assertEqual(len(self.client.deletions[0][1]), 2)
        self.assertTrue(any(path.startswith("workspaces/") for path in self.client.files[reset.DATA_BUCKET]))

    def test_verify_detects_preserved_hash_changes_and_reappearing_history(self):
        self.backup()
        self.apply()
        path = "codex-final/app.py"
        self.client.files[reset.DATA_BUCKET][path] = b"unexpected changed source"
        with self.assertRaisesRegex(ValueError, "snapshot changed"):
            reset.verify_removed(self.plan, self.client)
        self.client.files[reset.DATA_BUCKET][path] = self.files[reset.DATA_BUCKET][path]
        path = "home/.codex/history.jsonl"
        self.client.files[reset.DATA_BUCKET][path] = self.files[reset.DATA_BUCKET][path]
        with self.assertRaisesRegex(ValueError, "remain"):
            reset.verify_removed(self.plan, self.client)

    def test_backup_refuses_symlinks_and_data_or_source_destinations(self):
        real = self.root / "real"
        real.mkdir()
        link = self.root / "link"
        link.symlink_to(real, target_is_directory=True)
        for path in [link / "backup", reset.SOURCE / "reset-backup", Path("/data/reset-backup"), Path("/home/user/.codex/reset-backup")]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                reset.backup_root(path)
        self.assertFalse(self.client.deletions)


if __name__ == "__main__":
    unittest.main()
