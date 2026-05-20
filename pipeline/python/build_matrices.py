"""Precompute travel-time matrices for Whereabouts using r5py.

Reads `public/data/sf/manifest.json` to get the H3 cell list and series
definitions, then runs r5py once per series to produce a travel-time matrix.
Writes one gzipped uint16 file per destination cell at
`public/data/sf/m/<h3>.bin.gz`, matching the format the SPA expects.

Run preflight.py first to verify environment + inputs.
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import h3
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point

from r5py import TransportNetwork, TravelTimeMatrix, TransportMode


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "pipeline" / "python" / "data"
OSM_PBF = DATA_DIR / "norcal-latest.osm.pbf"
GTFS_DIR = DATA_DIR / "gtfs"
MANIFEST_PATH = PROJECT_ROOT / "public" / "data" / "sf" / "manifest.json"
MATRIX_DIR = PROJECT_ROOT / "public" / "data" / "sf" / "m"

# Departure windows for peak / offpeak. r5py samples every minute within the
# window and returns the chosen percentile (median by default).
PEAK_DEPARTURE = dt.datetime(2026, 6, 2, 8, 0)       # Tuesday 8:00 am
OFFPEAK_DEPARTURE = dt.datetime(2026, 6, 2, 12, 0)   # Tuesday 12:00 pm
DEPARTURE_WINDOW_TRANSIT = dt.timedelta(minutes=60)
DEPARTURE_WINDOW_NONTRANSIT = dt.timedelta(minutes=1)  # r5py requires >0
PERCENTILE = 50

MAX_TRIP = dt.timedelta(hours=2)

# uint16 sentinel for unreachable (matches the TS reader)
UNREACHABLE_SECONDS = 0xFFFF


@dataclass
class SeriesSpec:
    id: str
    mode: str            # 'walk' | 'bike' | 'car' | 'transit'
    peak: str | None     # 'peak' | 'offpeak' | None
    allow_bus: bool | None


def load_manifest() -> dict:
    with MANIFEST_PATH.open() as f:
        return json.load(f)


def cells_to_geo(cells: list[str]) -> gpd.GeoDataFrame:
    rows = []
    for cell in cells:
        lat, lng = h3.cell_to_latlng(cell)
        rows.append({"id": cell, "geometry": Point(lng, lat)})
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def transport_modes_for(spec: SeriesSpec) -> list[TransportMode]:
    """Main transport modes — for transit, only the transit submodes (WALK is
    used implicitly as access_mode)."""
    if spec.mode == "walk":
        return [TransportMode.WALK]
    if spec.mode == "bike":
        return [TransportMode.BICYCLE]
    if spec.mode == "car":
        return [TransportMode.CAR]
    if spec.mode == "transit":
        modes = [
            TransportMode.SUBWAY,
            TransportMode.RAIL,
            TransportMode.TRAM,
            TransportMode.FERRY,
            TransportMode.CABLE_CAR,
            TransportMode.FUNICULAR,
            TransportMode.GONDOLA,
        ]
        if spec.allow_bus:
            modes.append(TransportMode.BUS)
        return modes
    raise ValueError(f"unknown mode: {spec.mode}")


def departure_for(spec: SeriesSpec) -> dt.datetime:
    if spec.peak == "offpeak":
        return OFFPEAK_DEPARTURE
    return PEAK_DEPARTURE


def compute_series_matrix(
    network: TransportNetwork,
    spec: SeriesSpec,
    points: gpd.GeoDataFrame,
) -> np.ndarray:
    """Return an (n_origins x n_destinations) uint16 ndarray of seconds.
    Unreachable → UNREACHABLE_SECONDS.
    """
    n = len(points)
    modes = transport_modes_for(spec)
    is_transit = spec.mode == "transit"
    departure = departure_for(spec)
    window = DEPARTURE_WINDOW_TRANSIT if is_transit else DEPARTURE_WINDOW_NONTRANSIT
    print(
        f"  [{spec.id}] {n}x{n}  modes={[m.name for m in modes]}  "
        f"departure={departure.isoformat()}  window={window}"
    )
    long_df = TravelTimeMatrix(
        transport_network=network,
        origins=points,
        destinations=points,
        departure=departure,
        departure_time_window=window,
        percentiles=[PERCENTILE],
        transport_modes=modes,
        max_time=MAX_TRIP,
        snap_to_network=True,
    )
    # Result is a pandas DataFrame with columns: from_id, to_id, travel_time
    # (or travel_time_p50 when percentiles!=default).
    time_col = None
    for cand in ("travel_time", f"travel_time_p{PERCENTILE}", "travel_time_p50"):
        if cand in long_df.columns:
            time_col = cand
            break
    if time_col is None:
        raise RuntimeError(f"no travel-time column in {list(long_df.columns)}")

    id_index = {pid: i for i, pid in enumerate(points["id"])}
    mat = np.full((n, n), UNREACHABLE_SECONDS, dtype=np.uint16)
    for from_id, to_id, minutes in zip(
        long_df["from_id"], long_df["to_id"], long_df[time_col]
    ):
        if pd.isna(minutes):
            continue
        oi = id_index.get(from_id)
        di = id_index.get(to_id)
        if oi is None or di is None:
            continue
        seconds = int(round(float(minutes) * 60))
        if seconds < 0:
            continue
        if seconds >= UNREACHABLE_SECONDS:
            seconds = UNREACHABLE_SECONDS - 1
        mat[oi, di] = seconds
    reachable = int((mat != UNREACHABLE_SECONDS).sum())
    print(f"    reachable pairs: {reachable} / {n * n}")
    return mat


def write_destination_files(
    cells: list[str],
    series_specs: list[SeriesSpec],
    series_matrices: dict[str, np.ndarray],
) -> int:
    MATRIX_DIR.mkdir(parents=True, exist_ok=True)
    n = len(cells)
    s = len(series_specs)
    total_bytes = 0
    for di, dest in enumerate(cells):
        buf = np.empty(s * n, dtype=np.uint16)
        for si, spec in enumerate(series_specs):
            buf[si * n : (si + 1) * n] = series_matrices[spec.id][:, di]
        raw = buf.tobytes()
        gz = gzip.compress(raw, compresslevel=9)
        (MATRIX_DIR / f"{dest}.bin").write_bytes(gz)
        total_bytes += len(gz)
        if (di + 1) % 200 == 0 or di == n - 1:
            avg_kb = total_bytes / 1024 / (di + 1)
            print(
                f"\r  wrote {di + 1}/{n}, avg {avg_kb:.1f} KB/file, "
                f"total {total_bytes / 1024 / 1024:.1f} MB",
                end="",
                flush=True,
            )
    print()
    return total_bytes


def main() -> int:
    print("Loading manifest…")
    manifest = load_manifest()
    cells = manifest["cells"]
    series_specs = [
        SeriesSpec(
            id=s["id"],
            mode=s["mode"],
            peak=s.get("peak"),
            allow_bus=s.get("allowBus"),
        )
        for s in manifest["series"]
    ]
    print(f"  {len(cells)} cells at H3 res {manifest['resolution']}")
    print(f"  {len(series_specs)} series: {[s.id for s in series_specs]}")

    print("Building point GeoDataFrame…")
    points = cells_to_geo(cells)

    print("Loading transport network (OSM + GTFS)…")
    gtfs_paths = [str(p) for p in sorted(GTFS_DIR.glob("*.zip"))]
    print(f"  OSM: {OSM_PBF}")
    print(f"  GTFS: {gtfs_paths}")
    network = TransportNetwork(osm_pbf=str(OSM_PBF), gtfs=gtfs_paths)
    print("  network ready")

    matrices: dict[str, np.ndarray] = {}
    for spec in series_specs:
        matrices[spec.id] = compute_series_matrix(network, spec, points)

    print("Writing destination files…")
    total = write_destination_files(cells, series_specs, matrices)

    manifest["notes"] = "Generated by r5py build_matrices.py"
    manifest["compression"] = "gzip"
    manifest["generatedAt"] = dt.datetime.now(dt.UTC).isoformat()
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))

    print(
        f"Done. Total matrix data: {total / 1024 / 1024:.1f} MB across "
        f"{len(cells)} files."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
