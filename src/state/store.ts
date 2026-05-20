import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ArcInfo, Group, Destination, HexScore } from './types';

export type Mode = 'idle' | 'adding-destination' | 'choosing-abode';

export interface Abode {
  lng: number;
  lat: number;
  h3: string;
  index: number;
}

export interface AppState {
  destinations: Destination[];
  groups: Group[];
  mode: Mode;
  hexScores: HexScore[];
  computing: boolean;
  abode: Abode | null;
  arcs: ArcInfo[];
  matrixReady: boolean;
  matrixError: string | null;
  // Upper bound for the choropleth color scale (in weekly minutes). Hexes
  // above this value are clamped to the worst color. Reset to the data max
  // whenever new scores arrive.
  weeklyCap: number | null;

  setMode: (mode: Mode) => void;
  addDestination: (d: Destination) => void;
  updateDestination: (id: string, patch: Partial<Destination>) => void;
  removeDestination: (id: string) => void;
  addGroup: (group: Omit<Group, 'id'>) => Group;
  updateGroup: (id: string, patch: Partial<Omit<Group, 'id'>>) => void;
  removeGroup: (id: string) => void;
  setHexScores: (scores: HexScore[]) => void;
  setComputing: (b: boolean) => void;
  setAbode: (h: Abode | null) => void;
  setArcs: (a: ArcInfo[]) => void;
  setMatrixReady: (b: boolean) => void;
  setMatrixError: (e: string | null) => void;
  setWeeklyCap: (cap: number) => void;
  importData: (destinations: Destination[], groups: Group[]) => void;
  resetResults: () => void;
}

export const store = createStore<AppState>()(
  persist(
    (set, get) => ({
      destinations: [],
      groups: [],
      mode: 'idle',
      hexScores: [],
      computing: false,
      abode: null,
      arcs: [],
      matrixReady: false,
      matrixError: null,
      weeklyCap: null,

      setMode: (mode) => set({ mode }),
      // Each destination owns its settings independently. Group membership
      // affects scoring only (nearest-of-the-group semantics); edits to one
      // group destination do NOT propagate to siblings.
      addDestination: (d) => set({ destinations: [...get().destinations, d] }),
      updateDestination: (id, patch) =>
        set({
          destinations: get().destinations.map((d) =>
            d.id === id ? { ...d, ...patch } : d,
          ),
        }),
      removeDestination: (id) =>
        set({ destinations: get().destinations.filter((d) => d.id !== id) }),
      addGroup: (group) => {
        const existing = get().groups.find(
          (c) => c.name.toLowerCase() === group.name.toLowerCase(),
        );
        if (existing) return existing;
        const created: Group = { id: crypto.randomUUID(), ...group };
        set({ groups: [...get().groups, created] });
        return created;
      },
      updateGroup: (id, patch) =>
        set({
          groups: get().groups.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        }),
      removeGroup: (id) =>
        set({
          groups: get().groups.filter((c) => c.id !== id),
          destinations: get().destinations.filter((d) => d.groupId !== id),
        }),
      setHexScores: (hexScores) => {
        set({ hexScores, weeklyCap: defaultCap(hexScores) });
      },
      setComputing: (computing) => set({ computing }),
      setAbode: (abode) => set({ abode }),
      setArcs: (arcs) => set({ arcs }),
      setMatrixReady: (matrixReady) => set({ matrixReady }),
      setMatrixError: (matrixError) => set({ matrixError }),
      setWeeklyCap: (weeklyCap) => set({ weeklyCap }),
      // Replace destinations + groups wholesale (load-from-file). Clears any
      // stale results.
      importData: (destinations, groups) =>
        set({
          destinations,
          groups,
          hexScores: [],
          abode: null,
          arcs: [],
          weeklyCap: null,
          mode: 'idle',
        }),
      resetResults: () =>
        set({ hexScores: [], abode: null, arcs: [], mode: 'idle', weeklyCap: null }),
    }),
    {
      name: 'whereabouts-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        destinations: s.destinations,
        groups: s.groups,
      }),
      // v2: legacy "transit" mode + allowBus → explicit "rail" / "bus".
      // v3: chains gained emoji + modes/peak/visitsPerWeek settings.
      // v4: "chain" → "group" rename (chains→groups, chainId→groupId).
      // Migration reads the OLD persisted shape, so it references the old
      // `chains` / `chainId` keys explicitly.
      version: 4,
      migrate: (persisted, fromVersion) => {
        const s = persisted as Record<string, any>;
        if (fromVersion < 2 && Array.isArray(s.destinations)) {
          s.destinations = s.destinations.map((d: any) => {
            if (!Array.isArray(d.modes)) return d;
            if (!d.modes.includes('transit')) {
              delete d.allowBus;
              return d;
            }
            const others = d.modes.filter((m: string) => m !== 'transit');
            const allowBus = d.allowBus !== false;
            const replaced = allowBus ? [...others, 'rail', 'bus'] : [...others, 'rail'];
            return { ...d, modes: replaced, allowBus: undefined };
          });
        }
        if (fromVersion < 3 && Array.isArray(s.chains)) {
          s.chains = s.chains.map((c: any) => {
            if (c.modes && c.peak && c.visitsPerWeek != null) return c;
            const head = (s.destinations ?? []).find(
              (d: any) => d.chainId === c.id,
            );
            return {
              ...c,
              emoji: c.emoji ?? '📍',
              modes: c.modes ?? head?.modes ?? ['walk'],
              peak: c.peak ?? head?.peak ?? 'offpeak',
              visitsPerWeek: c.visitsPerWeek ?? head?.visitsPerWeek ?? 1,
            };
          });
        }
        if (fromVersion < 4) {
          if (Array.isArray(s.chains)) {
            s.groups = s.chains;
            delete s.chains;
          }
          if (Array.isArray(s.destinations)) {
            s.destinations = s.destinations.map((d: any) => {
              if ('chainId' in d) {
                d.groupId = d.chainId;
                delete d.chainId;
              }
              if (d.emoji == null) d.emoji = '📍';
              return d;
            });
          }
        }
        return s;
      },
    },
  ),
);

export function getState() {
  return store.getState();
}

// Default cap for the choropleth: pick the value that puts exactly the 10
// lowest-travel-time hexes in the first (best) color bin of the 7-bin linear
// scale. That gives users an immediately useful "best 10 neighborhoods" view
// without having to drag the slider.
const NUM_COLOR_BINS = 7;
const TARGET_FIRST_BIN_COUNT = 10;

function defaultCap(hexScores: HexScore[]): number | null {
  const reachable = hexScores
    .map((h) => h.weeklyMinutes)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (reachable.length === 0) return null;
  const dataMin = reachable[0];
  const dataMax = reachable[reachable.length - 1];
  if (reachable.length <= TARGET_FIRST_BIN_COUNT) return dataMax;
  const threshold = reachable[TARGET_FIRST_BIN_COUNT];
  // First-bin upper edge = dataMin + (cap - dataMin) / NUM_COLOR_BINS
  // Place that edge at `threshold` so the 10 hexes below it land in bin 0.
  const cap = dataMin + NUM_COLOR_BINS * (threshold - dataMin);
  return Math.max(dataMin, Math.min(dataMax, cap));
}
