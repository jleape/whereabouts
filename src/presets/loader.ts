import type { TravelMode, PeakPeriod } from '../state/types';

export interface PresetDefaults {
  modes: TravelMode[];
  peak: PeakPeriod;
  visitsPerWeek: number;
}

export interface PresetMeta {
  id: string;
  name: string;
  emoji: string;
  dataFile: string;
  defaults: PresetDefaults;
}

export interface PresetLocation {
  name: string;
  lng: number;
  lat: number;
}

export interface PresetData {
  locations: PresetLocation[];
}

const PRESETS_BASE = '/data/sf/presets';

let presetsPromise: Promise<PresetMeta[]> | null = null;
const dataCache = new Map<string, Promise<PresetData>>();

export function loadPresets(): Promise<PresetMeta[]> {
  if (!presetsPromise) {
    presetsPromise = (async () => {
      const res = await fetch(`${PRESETS_BASE}/index.json`);
      if (!res.ok) throw new Error(`presets/index.json: ${res.status}`);
      return (await res.json()) as PresetMeta[];
    })().catch((err) => {
      presetsPromise = null; // allow retry
      throw err;
    });
  }
  return presetsPromise;
}

export function loadPresetData(preset: PresetMeta): Promise<PresetData> {
  const cached = dataCache.get(preset.id);
  if (cached) return cached;
  const p = (async () => {
    const res = await fetch(`${PRESETS_BASE}/${preset.dataFile}`);
    if (!res.ok) throw new Error(`preset ${preset.id}: ${res.status}`);
    return (await res.json()) as PresetData;
  })().catch((err) => {
    dataCache.delete(preset.id);
    throw err;
  });
  dataCache.set(preset.id, p);
  return p;
}
