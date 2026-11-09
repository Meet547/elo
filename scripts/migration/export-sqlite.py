"""Make a consistent local backup through a read-only source connection."""
import argparse
import os
from pathlib import Path
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
source = Path(args.source).resolve(strict=True)
output = Path(args.output).resolve()
if source == output:
    raise SystemExit('Source and backup must differ.')
# O_EXCL prevents overwriting another backup; permissions protect private history.
fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.close(fd)
try:
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as original:
        original.execute('PRAGMA query_only=ON')
        with sqlite3.connect(output) as backup:
            original.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup integrity check failed.')
    print('Created consistent read-only-source SQLite backup. Keep it private.')
except BaseException:
    output.unlink(missing_ok=True)
    raise
