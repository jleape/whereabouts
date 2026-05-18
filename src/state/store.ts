import { createStore } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { City, Chain, Destination, HexScore } from './types';

export type Mode = 'idle' | 'adding-destination' | 'framing' | 'choosing-hood';

export interface ViewInfo {
  bbox: [number, number, number, number];
  areaKm2: number;
  resolution: number;
  estimatedHexes: number;
}

export interface AppState {
  city: City | null;
  destinations: Destination[];
  chains: Chain[];
  mode: Mode;
  hexScores: HexScore[];
  computing: boolean;
  hood: { lng: number; lat: number } | null;
  viewInfo: ViewInfo | null;
  lastResolution: number | null;

  setCity: (city: City | null) => void;
  setMode: (mode: Mode) => void;
  addDestination: (d: Destination) => void;
  updateDestination: (id: string, patch: Partial<Destination>) => void;
  removeDestination: (id: string) => void;
  addChain: (name: string) => Chain;
  setHexScores: (scores: HexScore[], resolution: number) => void;
  setComputing: (b: boolean) => void;
  setHood: (h: { lng: number; lat: number } | null) => void;
  setViewInfo: (v: ViewInfo | null) => void;
  resetResults: () => void;
}

export const store = createStore<AppState>()(
  persist(
    (set, get) => ({
      city: null,
      destinations: [],
      chains: [],
      mode: 'idle',
      hexScores: [],
      computing: false,
      hood: null,
      viewInfo: null,
      lastResolution: null,

      setCity: (city) => set({ city, hexScores: [], hood: null }),
      setMode: (mode) => set({ mode }),
      addDestination: (d) =>
        set({ destinations: syncChainSiblings([...get().destinations, d], d) }),
      updateDestination: (id, patch) => {
        const merged = get().destinations.map((d) =>
          d.id === id ? { ...d, ...patch } : d,
        );
        const target = merged.find((x) => x.id === id);
        set({
          destinations: target ? syncChainSiblings(merged, target) : merged,
        });
      },
      removeDestination: (id) =>
        set({ destinations: get().destinations.filter((d) => d.id !== id) }),
      addChain: (name) => {
        const existing = get().chains.find(
          (c) => c.name.toLowerCase() === name.toLowerCase(),
        );
        if (existing) return existing;
        const chain: Chain = { id: crypto.randomUUID(), name };
        set({ chains: [...get().chains, chain] });
        return chain;
      },
      setHexScores: (hexScores, resolution) =>
        set({ hexScores, lastResolution: resolution }),
      setComputing: (computing) => set({ computing }),
      setHood: (hood) => set({ hood }),
      setViewInfo: (viewInfo) => set({ viewInfo }),
      resetResults: () =>
        set({ hexScores: [], hood: null, mode: 'idle', lastResolution: null }),
    }),
    {
      name: 'loc3-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        city: s.city,
        destinations: s.destinations,
        chains: s.chains,
      }),
    },
  ),
);

export function getState() {
  return store.getState();
}

// Chain destinations share visits/modes/peak. After upsert, copy those fields
// from the just-saved destination to all sibling destinations in the same chain.
function syncChainSiblings(
  list: Destination[],
  source: Destination,
): Destination[] {
  if (!source.chainId) return list;
  return list.map((d) =>
    d.chainId === source.chainId && d.id !== source.id
      ? {
          ...d,
          visitsPerWeek: source.visitsPerWeek,
          modes: source.modes,
          peak: source.peak,
        }
      : d,
  );
}
