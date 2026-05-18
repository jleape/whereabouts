import type {
  ArcInfo,
  Chain,
  Destination,
  HexScore,
  TravelMode,
} from '../state/types';
import { estimateMinutes } from './travel';
import type { HexCell } from './grid';

// Group destinations by chainId. Single (non-chain) destinations form their own group.
export interface DestGroup {
  groupId: string;
  name: string;
  visitsPerWeek: number;
  modes: TravelMode[];
  peak: 'peak' | 'offpeak';
  locations: { id: string; lng: number; lat: number }[];
}

export function groupDestinations(
  destinations: Destination[],
  chains: Chain[],
): DestGroup[] {
  const byChain = new Map<string, Destination[]>();
  const singles: Destination[] = [];
  for (const d of destinations) {
    if (d.chainId) {
      const arr = byChain.get(d.chainId) ?? [];
      arr.push(d);
      byChain.set(d.chainId, arr);
    } else {
      singles.push(d);
    }
  }
  const groups: DestGroup[] = [];
  for (const [chainId, dests] of byChain) {
    if (dests.length === 0) continue;
    const chain = chains.find((c) => c.id === chainId);
    // For chain groups, use the union of allowed modes and the
    // visits/peak/name from the first destination as canonical (they should
    // really be edited per-chain, but we take the first as the chain's policy).
    const head = dests[0];
    const modesUnion = Array.from(new Set(dests.flatMap((d) => d.modes))) as TravelMode[];
    groups.push({
      groupId: `chain:${chainId}`,
      name: chain?.name ?? head.name,
      visitsPerWeek: head.visitsPerWeek,
      modes: modesUnion.length ? modesUnion : head.modes,
      peak: head.peak,
      locations: dests.map((d) => ({ id: d.id, lng: d.lng, lat: d.lat })),
    });
  }
  for (const d of singles) {
    groups.push({
      groupId: `dest:${d.id}`,
      name: d.name,
      visitsPerWeek: d.visitsPerWeek,
      modes: d.modes,
      peak: d.peak,
      locations: [{ id: d.id, lng: d.lng, lat: d.lat }],
    });
  }
  return groups;
}

// For one origin and one group, find the minimum travel time minutes across
// (location × allowed mode), and return that plus the winning (locationId, mode).
export function bestForGroup(
  originLng: number,
  originLat: number,
  group: DestGroup,
  overrideMatrix?: Map<string, number>, // key: `${locId}|${mode}` → minutes, when refined
): { minutes: number; locId: string; mode: TravelMode } | null {
  if (group.modes.length === 0 || group.locations.length === 0) return null;
  let best: { minutes: number; locId: string; mode: TravelMode } | null = null;
  for (const loc of group.locations) {
    for (const mode of group.modes) {
      let m = overrideMatrix?.get(`${loc.id}|${mode}`);
      if (m === undefined) {
        m = estimateMinutes(originLng, originLat, loc.lng, loc.lat, mode, group.peak);
      }
      if (!best || m < best.minutes) {
        best = { minutes: m, locId: loc.id, mode };
      }
    }
  }
  return best;
}

export function scoreHex(
  cell: HexCell,
  groups: DestGroup[],
): HexScore {
  let total = 0;
  for (const g of groups) {
    const best = bestForGroup(cell.lng, cell.lat, g);
    if (best) {
      // Round trip × visits per week
      total += best.minutes * 2 * g.visitsPerWeek;
    }
  }
  return { h3: cell.h3, weeklyMinutes: total };
}

export function scoreAll(cells: HexCell[], groups: DestGroup[]): HexScore[] {
  return cells.map((c) => scoreHex(c, groups));
}

// For "Choose a hood", compute the winning arc per group.
export function computeArcs(
  hood: { lng: number; lat: number },
  destinations: Destination[],
  chains: Chain[],
): ArcInfo[] {
  const groups = groupDestinations(destinations, chains);
  const arcs: ArcInfo[] = [];
  for (const g of groups) {
    const best = bestForGroup(hood.lng, hood.lat, g);
    if (!best) continue;
    const loc = g.locations.find((l) => l.id === best.locId);
    if (!loc) continue;
    arcs.push({
      fromLng: hood.lng,
      fromLat: hood.lat,
      toLng: loc.lng,
      toLat: loc.lat,
      destName: g.name,
      minutes: best.minutes,
      mode: best.mode,
    });
  }
  return arcs;
}
