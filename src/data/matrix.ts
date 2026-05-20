// Travel-time matrix data layout (precomputed offline by r5py).
//
// Manifest at:   /data/{city}/manifest.json
// Matrix files:  /data/{city}/m/{h3id}.bin
//
// Each .bin holds a contiguous Float32Array of shape (seriesCount × cellCount).
// Cell `i` for series `s` lives at offset `(s * cellCount + i) * 4` bytes.
// The cell ordering matches manifest.cells[]. Unreachable pairs are encoded
// as Infinity (the file actually stores Float32 +Inf, which JS reads back as Infinity).

export type SeriesId =
  | 'walk'
  | 'bike'
  | 'car'
  | 'transit-bus-peak'
  | 'transit-bus-offpeak'
  | 'transit-rail-peak'
  | 'transit-rail-offpeak';

export interface SeriesMeta {
  id: SeriesId;
  mode: 'walk' | 'bike' | 'car' | 'transit';
  peak?: 'peak' | 'offpeak';
  allowBus?: boolean;
}

export interface Manifest {
  city: string;
  resolution: number;
  cells: string[]; // ordered list of H3 cell IDs
  series: SeriesMeta[]; // ordered list defining row layout in each .bin
  bbox: [number, number, number, number]; // [west, south, east, north]
  compression?: 'gzip' | 'none'; // matrix files are .bin.gz when 'gzip'
  generatedAt: string; // ISO timestamp
  notes?: string;
}

// Travel times are decoded into a Float32Array of minutes for ergonomic
// downstream arithmetic. Unreachable pairs are Infinity.
export interface LoadedMatrix {
  manifest: Manifest;
  cellIndex: Map<string, number>; // h3 → index into cells[]
  seriesIndex: Map<SeriesId, number>;
  destCache: Map<string, Promise<Float32Array>>;
}

const UNREACHABLE_SECONDS = 0xffff;

// Fixed overhead added to every trip (minutes) — building access + egress
// (lock up, walk to elevator/stairs, exit lobby, reverse at destination).
const BUILDING_ACCESS_MIN = 4;

let loaded: LoadedMatrix | null = null;
let loadingPromise: Promise<LoadedMatrix> | null = null;

export function getLoadedMatrix(): LoadedMatrix | null {
  return loaded;
}

export async function loadManifest(baseUrl = '/data/sf'): Promise<LoadedMatrix> {
  if (loaded) return loaded;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const res = await fetch(`${baseUrl}/manifest.json`);
    if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
    const manifest = (await res.json()) as Manifest;
    const cellIndex = new Map<string, number>();
    manifest.cells.forEach((c, i) => cellIndex.set(c, i));
    const seriesIndex = new Map<SeriesId, number>();
    manifest.series.forEach((s, i) => seriesIndex.set(s.id, i));
    loaded = {
      manifest,
      cellIndex,
      seriesIndex,
      destCache: new Map(),
    };
    (loaded as LoadedMatrix & { baseUrl: string }).baseUrl = baseUrl;
    return loaded;
  })();
  return loadingPromise;
}

// Fetch (or return cached) the matrix row for a destination cell.
// On-disk format: uint16 little-endian seconds, gzip-compressed. Files use the
// `.bin` extension (not `.bin.gz`) so web servers don't auto-set
// `Content-Encoding: gzip` and silently decompress for us — we always
// decompress manually here. Decoded to Float32Array of minutes (Infinity = unreachable).
export function fetchDestMatrix(destH3: string): Promise<Float32Array> {
  if (!loaded) throw new Error('matrix not loaded');
  const cached = loaded.destCache.get(destH3);
  if (cached) return cached;
  const baseUrl = (loaded as LoadedMatrix & { baseUrl: string }).baseUrl;
  const isGzipped = loaded.manifest.compression !== 'none';
  const p = (async () => {
    const res = await fetch(`${baseUrl}/m/${destH3}.bin`);
    if (!res.ok) throw new Error(`matrix file for ${destH3}: ${res.status}`);
    let bytes: ArrayBuffer;
    if (isGzipped) {
      const decompressed = res.body!.pipeThrough(new DecompressionStream('gzip'));
      bytes = await new Response(decompressed).arrayBuffer();
    } else {
      bytes = await res.arrayBuffer();
    }
    const u16 = new Uint16Array(bytes);
    const minutes = new Float32Array(u16.length);
    for (let i = 0; i < u16.length; i++) {
      const s = u16[i];
      minutes[i] = s === UNREACHABLE_SECONDS ? Infinity : s / 60 + BUILDING_ACCESS_MIN;
    }
    return minutes;
  })();
  loaded.destCache.set(destH3, p);
  return p;
}

// Read travel time (minutes) from origin cell index → destination, for one series.
export function readMinutes(
  matrix: Float32Array,
  seriesIdx: number,
  originIdx: number,
  cellCount: number,
): number {
  return matrix[seriesIdx * cellCount + originIdx];
}

// Convenience: pick the series id for a given (mode, peak) combo.
// 'rail' → rail-only transit series; 'bus' → bus-inclusive transit series
// (since the bus-inclusive matrix is a superset of the rail-only one, anyone
// who's willing to take the bus is also willing to take rail — picking the
// bus-inclusive series gets the fastest of either).
export function seriesIdFor(
  mode: 'walk' | 'bike' | 'car' | 'rail' | 'bus',
  peak: 'peak' | 'offpeak',
): SeriesId {
  if (mode === 'walk') return 'walk';
  if (mode === 'bike') return 'bike';
  if (mode === 'car') return 'car';
  if (mode === 'bus') return peak === 'peak' ? 'transit-bus-peak' : 'transit-bus-offpeak';
  return peak === 'peak' ? 'transit-rail-peak' : 'transit-rail-offpeak';
}
