"""Restore a consistent SQLite backup while the web server is stopped."""
import argparse
import sqlite3
from pathlib import Path
from .db import DB_PATH

def restore(backup: Path, target: Path):
    backup=backup.resolve(); target=target.resolve()
    if not backup.is_file(): raise SystemExit(f"No existe la copia: {backup}")
    if backup == target: raise SystemExit("La copia y el destino deben ser distintos")
    with sqlite3.connect(backup) as source:
        if source.execute("PRAGMA integrity_check").fetchone()[0] != "ok": raise SystemExit("La copia no supera la comprobación de integridad")
        with sqlite3.connect(target, timeout=3) as destination:
            source.backup(destination)
    print(f"Restaurado: {target}")

if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup",type=Path)
    parser.add_argument("--target",type=Path,default=DB_PATH)
    args=parser.parse_args()
    restore(args.backup,args.target)
