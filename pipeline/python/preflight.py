"""Verify the environment is ready to run build_matrices.py.

Checks:
  - Python version
  - Java is on PATH and is JDK >= 21 (R5 v7.5 requirement)
  - Required Python packages import cleanly
  - OSM PBF and GTFS files are present at the configured paths
  - manifest.json exists at public/data/sf/manifest.json
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OSM_PBF = PROJECT_ROOT / "pipeline" / "python" / "data" / "norcal-latest.osm.pbf"
DEFAULT_GTFS_DIR = PROJECT_ROOT / "pipeline" / "python" / "data" / "gtfs"
DEFAULT_MANIFEST = PROJECT_ROOT / "public" / "data" / "sf" / "manifest.json"


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def fail(msg: str) -> None:
    print(f"  ✗ {msg}")


def check_python() -> bool:
    if sys.version_info < (3, 10):
        fail(f"Python 3.10+ required, found {sys.version}")
        return False
    ok(f"Python {sys.version.split()[0]}")
    return True


def check_java() -> bool:
    java = shutil.which("java")
    if not java:
        fail("`java` not on PATH. Install JDK 21+ (brew install openjdk@21).")
        return False
    try:
        out = subprocess.run(
            ["java", "-version"], capture_output=True, text=True, timeout=10
        )
    except Exception as e:
        fail(f"java -version failed: {e}")
        return False
    text = out.stderr or out.stdout
    first = text.splitlines()[0] if text else ""
    # Format: "openjdk version "21.0.4" 2024-07-16"
    try:
        version_str = first.split('"')[1]
        major = int(version_str.split(".")[0])
    except (IndexError, ValueError):
        fail(f"Couldn't parse Java version from: {first!r}")
        return False
    if major < 21:
        fail(f"Java {major} found, R5 v7.5 needs JDK 21+. Install openjdk@21.")
        return False
    ok(f"Java {version_str}")
    return True


def check_packages() -> bool:
    needed = [
        ("r5py", "r5py"),
        ("h3", "h3"),
        ("geopandas", "geopandas"),
        ("shapely", "shapely"),
        ("numpy", "numpy"),
        ("pandas", "pandas"),
    ]
    all_ok = True
    for import_name, pkg_name in needed:
        try:
            mod = __import__(import_name)
            version = getattr(mod, "__version__", "?")
            ok(f"{pkg_name} {version}")
        except ImportError:
            fail(f"missing {pkg_name} — run `uv sync` or `pip install -e .`")
            all_ok = False
    return all_ok


def check_manifest() -> bool:
    if not DEFAULT_MANIFEST.exists():
        fail(
            f"manifest.json not found at {DEFAULT_MANIFEST}.\n"
            f"        Run `npm run sample-data` from the repo root first."
        )
        return False
    try:
        data = json.loads(DEFAULT_MANIFEST.read_text())
        ok(
            f"manifest: {len(data['cells'])} cells at H3 res {data['resolution']}, "
            f"{len(data['series'])} series"
        )
    except Exception as e:
        fail(f"could not read manifest: {e}")
        return False
    return True


def check_osm() -> bool:
    if not DEFAULT_OSM_PBF.exists():
        fail(
            f"OSM PBF not found at {DEFAULT_OSM_PBF}.\n"
            f"        Download from https://download.geofabrik.de/north-america/us/california/norcal.html"
        )
        return False
    size_mb = DEFAULT_OSM_PBF.stat().st_size / 1024 / 1024
    ok(f"OSM PBF {DEFAULT_OSM_PBF.name} ({size_mb:.1f} MB)")
    return True


def check_gtfs() -> bool:
    if not DEFAULT_GTFS_DIR.exists():
        fail(f"GTFS dir not found at {DEFAULT_GTFS_DIR}")
        return False
    feeds = list(DEFAULT_GTFS_DIR.glob("*.zip"))
    if not feeds:
        fail(f"no .zip files in {DEFAULT_GTFS_DIR}")
        return False
    for f in feeds:
        size_mb = f.stat().st_size / 1024 / 1024
        ok(f"GTFS {f.name} ({size_mb:.1f} MB)")
    return True


def main() -> int:
    print("Preflight check…")
    checks = [
        ("Python", check_python),
        ("Java", check_java),
        ("Python packages", check_packages),
        ("Manifest", check_manifest),
        ("OSM PBF", check_osm),
        ("GTFS feeds", check_gtfs),
    ]
    failed = []
    for label, fn in checks:
        print(f"[{label}]")
        if not fn():
            failed.append(label)
    print()
    if failed:
        print(f"FAIL — {len(failed)} check(s) failed: {', '.join(failed)}")
        return 1
    print("OK — ready to run build_matrices.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
