import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ArcInfo, Chain, Destination, HexScore } from './types';

export type Mode =
  | 'idle'
  | 'adding-destination'
  | 'choosing-hood'
  | 'batch-deleting';

export interface Hood {
  lng: number;
  lat: number;
  h3: string;
  index: number;
}

export interface BatchDeleteState {
  chainId: string;
  selectedIds: string[];
}

export interface AppState {
  destinations: Destination[];
  chains: Chain[];
  mode: Mode;
  hexScores: HexScore[];
  computing: boolean;
  hood: Hood | null;
  arcs: ArcInfo[];
  matrixReady: boolean;
  matrixError: string | null;
  // Upper bound for the choropleth color scale (in weekly minutes). Hexes
  // above this value are clamped to the worst color. Reset to the data max
  // whenever new scores arrive.
  weeklyCap: number | null;
  batchDelete: BatchDeleteState | null;

  setMode: (mode: Mode) => void;
  startBatchDelete: (chainId: string) => void;
  addToBatchSelection: (ids: string[]) => void;
  toggleBatchSelection: (id: string) => void;
  endBatchDelete: () => void;
  addDestination: (d: Destination) => void;
  updateDestination: (id: string, patch: Partial<Destination>) => void;
  removeDestination: (id: string) => void;
  addChain: (chain: Omit<Chain, 'id'>) => Chain;
  updateChain: (id: string, patch: Partial<Omit<Chain, 'id'>>) => void;
  removeChain: (id: string) => void;
  setHexScores: (scores: HexScore[]) => void;
  setComputing: (b: boolean) => void;
  setHood: (h: Hood | null) => void;
  setArcs: (a: ArcInfo[]) => void;
  setMatrixReady: (b: boolean) => void;
  setMatrixError: (e: string | null) => void;
  setWeeklyCap: (cap: number) => void;
  resetResults: () => void;
}

export const store = createStore<AppState>()(
  persist(
    (set, get) => ({
      destinations: [],
      chains: [],
      mode: 'idle',
      hexScores: [],
      computing: false,
      hood: null,
      arcs: [],
      matrixReady: false,
      matrixError: null,
      weeklyCap: null,
      batchDelete: null,

      setMode: (mode) => set({ mode }),
      // Each destination owns its settings independently. Chain membership
      // affects scoring only (nearest-of-the-chain semantics); edits to one
      // chain destination do NOT propagate to siblings.
      addDestination: (d) => set({ destinations: [...get().destinations, d] }),
      updateDestination: (id, patch) =>
        set({
          destinations: get().destinations.map((d) =>
            d.id === id ? { ...d, ...patch } : d,
          ),
        }),
      removeDestination: (id) =>
        set({ destinations: get().destinations.filter((d) => d.id !== id) }),
      addChain: (chain) => {
        const existing = get().chains.find(
          (c) => c.name.toLowerCase() === chain.name.toLowerCase(),
        );
        if (existing) return existing;
        const created: Chain = { id: crypto.randomUUID(), ...chain };
        set({ chains: [...get().chains, created] });
        return created;
      },
      updateChain: (id, patch) =>
        set({
          chains: get().chains.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        }),
      removeChain: (id) =>
        set({
          chains: get().chains.filter((c) => c.id !== id),
          destinations: get().destinations.filter((d) => d.chainId !== id),
        }),
      setHexScores: (hexScores) => {
        set({ hexScores, weeklyCap: defaultCap(hexScores) });
      },
      setComputing: (computing) => set({ computing }),
      setHood: (hood) => set({ hood }),
      setArcs: (arcs) => set({ arcs }),
      setMatrixReady: (matrixReady) => set({ matrixReady }),
      setMatrixError: (matrixError) => set({ matrixError }),
      setWeeklyCap: (weeklyCap) => set({ weeklyCap }),
      startBatchDelete: (chainId) =>
        set({ mode: 'batch-deleting', batchDelete: { chainId, selectedIds: [] } }),
      addToBatchSelection: (ids) => {
        const cur = get().batchDelete;
        if (!cur) return;
        const merged = Array.from(new Set([...cur.selectedIds, ...ids]));
        set({ batchDelete: { ...cur, selectedIds: merged } });
      },
      toggleBatchSelection: (id) => {
        const cur = get().batchDelete;
        if (!cur) return;
        const next = cur.selectedIds.includes(id)
          ? cur.selectedIds.filter((x) => x !== id)
          : [...cur.selectedIds, id];
        set({ batchDelete: { ...cur, selectedIds: next } });
      },
      endBatchDelete: () => set({ mode: 'idle', batchDelete: null }),
      resetResults: () =>
        set({ hexScores: [], hood: null, arcs: [], mode: 'idle', weeklyCap: null, batchDelete: null }),
    }),
    {
      name: 'whereabouts-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        destinations: s.destinations,
        chains: s.chains,
      }),
      // v2: legacy "transit" mode + allowBus → explicit "rail" / "bus".
      // v3: chains gained emoji + modes/peak/visitsPerWeek settings.
      version: 3,
      migrate: (persisted, fromVersion) => {
        const s = persisted as { destinations?: any[]; chains?: any[] };
        if (fromVersion < 2 && Array.isArray(s.destinations)) {
          s.destinations = s.destinations.map((d) => {
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
          s.chains = s.chains.map((c) => {
            if (c.modes && c.peak && c.visitsPerWeek != null) return c;
            // Inherit settings from the chain's first destination.
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
