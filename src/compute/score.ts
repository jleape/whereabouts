import type {
  ArcInfo,
  Chain,
  Destination,
  HexScore,
  TravelMode,
  PeakPeriod,
} from '../state/types';
import {
  fetchDestMatrix,
  getLoadedMatrix,
  readMinutes,
  seriesIdFor,
  type LoadedMatrix,
} from '../data/matrix';

// A destination group is scored as "nearest member". Travel settings
// (modes/peak/visitsPerWeek) come from the chain for chained destinations, or
// from the destination itself for standalone (non-chain) destinations.
interface GroupLocation {
  id: string;
  snappedH3: string;
  lng: number;
  lat: number;
}

export interface DestGroup {
  groupId: string;
  name: string;
  visitsPerWeek: number;
  modes: TravelMode[];
  peak: PeakPeriod;
  locations: GroupLocation[];
}

export function groupDestinations(
  destinations: Destination[],
  chains: Chain[],
): DestGroup[] {
  const byChain = new Map<string, Destination[]>();
  const singles: Destination[] = [];
  for (const d of destinations) {
    if (!d.snappedH3) continue; // unsaved / unsnapped
    if (d.chainId) {
      const arr = byChain.get(d.chainId) ?? [];
      arr.push(d);
      byChain.set(d.chainId, arr);
    } else {
      singles.push(d);
    }
  }
  const toLocation = (d: Destination): GroupLocation => ({
    id: d.id,
    snappedH3: d.snappedH3!,
    lng: d.snappedLng ?? d.lng,
    lat: d.snappedLat ?? d.lat,
  });
  const groups: DestGroup[] = [];
  for (const [chainId, dests] of byChain) {
    if (dests.length === 0) continue;
    const chain = chains.find((c) => c.id === chainId);
    if (!chain) continue;
    groups.push({
      groupId: `chain:${chainId}`,
      name: chain.name,
      visitsPerWeek: chain.visitsPerWeek,
      modes: chain.modes,
      peak: chain.peak,
      locations: dests.map(toLocation),
    });
  }
  for (const d of singles) {
    groups.push({
      groupId: `dest:${d.id}`,
      name: d.name,
      visitsPerWeek: d.visitsPerWeek,
      modes: d.modes,
      peak: d.peak,
      locations: [toLocation(d)],
    });
  }
  return groups;
}

// Precomputed lookup data for one group: for each location we keep its matrix
// data and the (mode, seriesIdx) pairs that location specifically allows.
interface PreparedLocation {
  matrix: Float32Array;
  modes: TravelMode[];
  seriesIdxByMode: number[];
}

interface PreparedGroup {
  group: DestGroup;
  locMatrices: PreparedLocation[];
}

async function prepareGroups(
  groups: DestGroup[],
  matrix: LoadedMatrix,
): Promise<PreparedGroup[]> {
  const prepared: PreparedGroup[] = [];
  for (const g of groups) {
    const seriesIdxByMode = g.modes.map((mode) => {
      const sid = seriesIdFor(mode, g.peak);
      return matrix.seriesIndex.get(sid)!;
    });
    const locMatrices: PreparedLocation[] = [];
    for (const loc of g.locations) {
      const m = await fetchDestMatrix(loc.snappedH3);
      locMatrices.push({ matrix: m, modes: g.modes, seriesIdxByMode });
    }
    prepared.push({ group: g, locMatrices });
  }
  return prepared;
}

// Score every origin cell in the grid against the prepared groups.
export function scoreGrid(
  matrix: LoadedMatrix,
  prepared: PreparedGroup[],
): HexScore[] {
  const cellCount = matrix.manifest.cells.length;
  const out: HexScore[] = new Array(cellCount);
  for (let originIdx = 0; originIdx < cellCount; originIdx++) {
    let total = 0;
    for (const pg of prepared) {
      let best = Infinity;
      for (const lm of pg.locMatrices) {
        for (const si of lm.seriesIdxByMode) {
          const m = readMinutes(lm.matrix, si, originIdx, cellCount);
          if (m < best) best = m;
        }
      }
      if (Number.isFinite(best)) {
        total += best * 2 * pg.group.visitsPerWeek;
      } else {
        // Unreachable for this group — penalize so the cell still ranks low.
        total += 999 * 2 * pg.group.visitsPerWeek;
      }
    }
    out[originIdx] = { h3: matrix.manifest.cells[originIdx], weeklyMinutes: total };
  }
  return out;
}

export async function computeScores(
  destinations: Destination[],
  chains: Chain[],
): Promise<HexScore[] | null> {
  const matrix = getLoadedMatrix();
  if (!matrix) return null;
  const groups = groupDestinations(destinations, chains);
  if (groups.length === 0) return [];
  const prepared = await prepareGroups(groups, matrix);
  return scoreGrid(matrix, prepared);
}

// For "Choose a hood": compute the winning arc per group from the hood cell.
export async function computeArcs(
  hood: { lng: number; lat: number; h3: string; index: number },
  destinations: Destination[],
  chains: Chain[],
): Promise<ArcInfo[]> {
  const matrix = getLoadedMatrix();
  if (!matrix) return [];
  const groups = groupDestinations(destinations, chains);
  const prepared = await prepareGroups(groups, matrix);
  const cellCount = matrix.manifest.cells.length;
  const arcs: ArcInfo[] = [];
  for (const pg of prepared) {
    let best: { minutes: number; locIdx: number; mode: TravelMode } | null = null;
    for (let li = 0; li < pg.locMatrices.length; li++) {
      const lm = pg.locMatrices[li];
      for (let mi = 0; mi < lm.modes.length; mi++) {
        const minutes = readMinutes(lm.matrix, lm.seriesIdxByMode[mi], hood.index, cellCount);
        if (Number.isFinite(minutes) && (!best || minutes < best.minutes)) {
          best = { minutes, locIdx: li, mode: lm.modes[mi] };
        }
      }
    }
    if (!best) continue;
    const loc = pg.group.locations[best.locIdx];
    arcs.push({
      fromLng: hood.lng,
      fromLat: hood.lat,
      toLng: loc.lng,
      toLat: loc.lat,
      destName: pg.group.name,
      minutes: best.minutes,
      mode: best.mode,
    });
  }
  return arcs;
}
