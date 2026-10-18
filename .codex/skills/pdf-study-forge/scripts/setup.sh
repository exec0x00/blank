#!/usr/bin/env bash
set -euo pipefail
FORGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -m venv "$FORGE_ROOT/.venv"
"$FORGE_ROOT/.venv/bin/python" -m pip install --disable-pip-version-check -r "$FORGE_ROOT/requirements.txt"
"$FORGE_ROOT/.venv/bin/python" "$FORGE_ROOT/scripts/forge.py" doctor
