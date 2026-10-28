#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo 'Usage: sudo bash update-app.sh CURRENT_COMMIT [APP_ORIGIN]' >&2
  exit 1
fi
exec python3 - "$@" <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys

release = json.loads(Path('release.json').read_text())
command = ['python3', 'update-selfhost-accounts.py',
           '--app-dir', os.environ.get('BUTLER_APP_DIR', '/home/mattermost-admin/robot-butler-direct-20261026'),
           '--archive', 'release.tar.gz', '--sha256', release['sha256'],
           '--release', release['commit'], '--expected-current', sys.argv[1]]
if len(sys.argv) == 3:
    command += ['--origin', sys.argv[2]]
sys.exit(subprocess.call(command))
PY
