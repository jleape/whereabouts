# Whereabouts r5py precompute pipeline

Produces the real travel-time matrices (replacing the synthetic data emitted
by `npm run sample-data`). Runs once per data drop; output goes to
`public/data/sf/m/*.bin.gz` and `public/data/sf/manifest.json`.

## What this does

1. Reads the H3 cell list and series definitions from
   `public/data/sf/manifest.json` (which `npm run sample-data` writes).
2. Builds a Conveyal R5 transport network from a Bay Area OSM extract plus the
   four GTFS feeds we care about (Muni, BART, Caltrain, Bay Ferry).
3. Computes seven travel-time matrices via r5py:
   - `walk`, `bike`, `car` (time-of-day invariant in R5)
   - `transit-bus-peak`, `transit-bus-offpeak` (all transit modes)
   - `transit-rail-peak`, `transit-rail-offpeak` (subway/rail/tram/ferry only — no bus)
   - Peak = Tue 8:00, off-peak = Tue 12:00, both 60-min windows, median percentile.
4. Writes per-destination `<h3>.bin.gz` files (uint16 seconds, 7 series concatenated).

## One-time setup

### 1. Install JDK 21+

R5 v7.5 requires Java 21 or newer. On macOS:

```sh
brew install openjdk@21
sudo ln -sfn /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk \
  /Library/Java/JavaVirtualMachines/openjdk-21.jdk
java --version    # should report 21.x.x
```

### 2. Install Python dependencies

This dir uses `uv` (or `pip`). With `uv`:

```sh
cd pipeline/python
uv sync
source .venv/bin/activate
```

Or with vanilla `pip` + `venv`:

```sh
cd pipeline/python
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .
```

### 3. Download input data

Create `pipeline/python/data/` and put these files inside:

**OSM extract** — Northern California from Geofabrik:
```sh
mkdir -p pipeline/python/data
curl -L -o pipeline/python/data/norcal-latest.osm.pbf \
  https://download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf
```
(~250 MB, covers SF and the rest of NorCal.)

**GTFS feeds** — into `pipeline/python/data/gtfs/`:

| Agency | Direct URL | Notes |
|---|---|---|
| SF Muni | https://www.sfmta.com/sites/default/files/reports-and-documents/google_transit.zip | Bus + light rail |
| BART | https://www.bart.gov/dev/schedules/google_transit.zip | Heavy rail |

```sh
mkdir -p pipeline/python/data/gtfs
cd pipeline/python/data/gtfs
curl -L -o muni.zip https://www.sfmta.com/sites/default/files/reports-and-documents/google_transit.zip
curl -L -o bart.zip https://www.bart.gov/dev/schedules/google_transit.zip
```

Caltrain and SF Bay Ferry are intentionally excluded from v1. Add them later by dropping their GTFS zips into the same dir and rerunning — the pipeline will pick them up automatically.

### 4. Generate the manifest

From the repo root:

```sh
npm run sample-data       # writes public/data/sf/manifest.json + synthetic matrices
```

(The Python pipeline overwrites the matrices but reuses the manifest — same cell list, same series.)

### 5. Preflight

```sh
python pipeline/python/preflight.py
```

Confirms Java, Python packages, OSM file, GTFS files, and manifest are all in place.

## Running the precompute

```sh
python pipeline/python/build_matrices.py
```

Expected runtime:
- Network build (OSM + GTFS): 2–5 min.
- Each transit matrix at res 9 (~1,000 cells): 30–90 s.
- Each transit matrix at res 10 (~6,800 cells): 5–15 min.
- Walk/bike/car much faster.
- Total at res 10: roughly 1–2 hours.

When it finishes, the matrices at `public/data/sf/m/*.bin.gz` are real
r5py output. Spin up the dev server (`npm run dev`) and the SPA will load
them transparently.

## Regenerating after GTFS updates

```sh
# refresh GTFS zips
cd pipeline/python/data/gtfs && curl -L -o muni.zip https://...
cd -

# re-run
python pipeline/python/build_matrices.py
```

The network is built fresh each run; no manual cache invalidation.
