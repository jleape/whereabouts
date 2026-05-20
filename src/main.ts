import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';

import { createMap } from './map/basemap';
import { attachOverlay } from './map/overlay';
import { store, getState } from './state/store';
import type { Destination } from './state/types';
import { openDestinationPopup } from './ui/popup';
import { initPanel } from './ui/panel';
import { collapseSheet } from './ui/sheet';
import { getLoadedMatrix, loadManifest } from './data/matrix';
import { snapToGrid } from './data/snap';
import { computeArcs, computeScores } from './compute/score';
import { loadPresetData, loadPresets, type PresetMeta } from './presets/loader';
import { openGroupSettingsModal, openGroupEditorModal } from './ui/group-popup';
import { loadNeighborhoods, neighborhoodAt } from './data/neighborhoods';

// One-shot localStorage migration: rename from the original `loc3-state` key
// to `whereabouts-state` if the new one is empty. Runs before the store loads
// its persisted slice, so the new key is populated in time.
(() => {
  try {
    const oldKey = 'loc3-state';
    const newKey = 'whereabouts-state';
    if (!localStorage.getItem(newKey) && localStorage.getItem(oldKey)) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey)!);
    }
    localStorage.removeItem(oldKey);
  } catch {
    // ignore quota / private-mode failures
  }
})();

const mapContainer = document.getElementById('map')!;
const map = createMap(mapContainer);

// On mobile, slide the panel out of the way the moment the user pans the map.
// (collapseSheet is a no-op on desktop and when the sheet is already down.)
map.on('dragstart', () => collapseSheet());

let activePopup: maplibregl.Popup | null = null;

map.on('load', async () => {
  attachOverlay(map, {
    onDestinationClick: (id) => onMarkerClick(id),
  });
  void loadNeighborhoods();
  try {
    const matrix = await loadManifest();
    const [w, s, e, n] = matrix.manifest.bbox;
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 40, duration: 0 },
    );
    // Backfill / refresh snappedH3 for persisted destinations. Re-snap when
    // either no snap is recorded yet, or the recorded cell no longer exists
    // in the current grid (e.g. resolution or land polygon changed between
    // sessions).
    const dests = getState().destinations;
    for (const d of dests) {
      const stale = d.snappedH3 && !matrix.cellIndex.has(d.snappedH3);
      if (!d.snappedH3 || stale) {
        const snap = snapToGrid(matrix, d.lng, d.lat);
        if (snap) {
          getState().updateDestination(d.id, {
            snappedH3: snap.h3,
            snappedLng: snap.lng,
            snappedLat: snap.lat,
          });
        }
      }
    }
    getState().setMatrixReady(true);
  } catch (err) {
    getState().setMatrixError((err as Error).message);
  }

  // Self-heal: groups created before the group-emoji field existed were
  // migrated with the default 📍. Backfill the real emoji by matching the
  // group name against the preset list.
  try {
    const presets = await loadPresets();
    for (const group of getState().groups) {
      const preset = presets.find(
        (p) => p.name.toLowerCase() === group.name.toLowerCase(),
      );
      if (preset && group.emoji !== preset.emoji) {
        getState().updateGroup(group.id, { emoji: preset.emoji });
      }
    }
  } catch {
    // presets unavailable — markers fall back to 📍
  }
});

initPanel({
  onToggleAddMode: () => {
    const s = getState();
    if (s.mode === 'adding-destination') {
      s.setMode('idle');
      mapContainer.style.cursor = '';
    } else {
      s.setMode('adding-destination');
      mapContainer.style.cursor = 'crosshair';
    }
  },
  onEditDestination: (id) => {
    openEditPopupForDestination(id, true);
  },
  onRemoveDestination: (id) => {
    getState().removeDestination(id);
  },
  onCompute: runCompute,
  onToggleAbode: () => {
    const s = getState();
    if (s.mode === 'choosing-abode') {
      s.setMode('idle');
      mapContainer.style.cursor = '';
    } else {
      s.setMode('choosing-abode');
      mapContainer.style.cursor = 'crosshair';
    }
  },
  onResetResults: () => {
    getState().resetResults();
  },
  onAddPresetGroup: (preset) => {
    void addPresetGroup(preset);
  },
  onOpenGroup: (groupId) => {
    openGroupEditor(groupId);
  },
  onRemoveGroup: (groupId) => {
    getState().removeGroup(groupId);
  },
  onSave: () => {
    saveToFile();
  },
  onLoad: () => {
    loadFromFile();
  },
});

// Download the user's destinations + groups as a JSON file.
function saveToFile() {
  const s = getState();
  const data = {
    app: 'whereabouts',
    version: 1,
    destinations: s.destinations,
    groups: s.groups,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'whereabouts-destinations.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Upload a previously-saved JSON file and replace the current destinations.
function loadFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    let parsed: any;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      alert('That file is not valid JSON.');
      return;
    }
    if (!Array.isArray(parsed?.destinations) || !Array.isArray(parsed?.groups)) {
      alert('That file does not look like a Whereabouts destinations export.');
      return;
    }
    // Re-snap destinations in case the file came from a different grid.
    const destinations = (parsed.destinations as Destination[]).map(snapDestination);
    getState().importData(destinations, parsed.groups);
  });
  input.click();
}

map.on('click', (e) => {
  const s = getState();
  if (s.mode === 'adding-destination') {
    if (activePopup) activePopup.remove();
    activePopup = openDestinationPopup(map, {
      lng: e.lngLat.lng,
      lat: e.lngLat.lat,
      onSave: (d: Destination) => {
        s.addDestination(snapDestination(d));
        s.setMode('idle');
        mapContainer.style.cursor = '';
        activePopup = null;
      },
      onCancel: () => {
        s.setMode('idle');
        mapContainer.style.cursor = '';
        activePopup = null;
      },
    });
  } else if (s.mode === 'choosing-abode') {
    placeAbode(e.lngLat.lng, e.lngLat.lat);
  }
});

function snapDestination(d: Destination): Destination {
  const matrix = getLoadedMatrix();
  if (!matrix) return d;
  const snap = snapToGrid(matrix, d.lng, d.lat);
  if (!snap) return d;
  return {
    ...d,
    snappedH3: snap.h3,
    snappedLng: snap.lng,
    snappedLat: snap.lat,
  };
}

// Add a preset group: confirm group-level settings, then bulk-add all the
// preset's locations as members of a new group.
async function addPresetGroup(preset: PresetMeta) {
  const matrix = getLoadedMatrix();
  if (!matrix) return;
  if (
    getState().groups.some(
      (c) => c.name.toLowerCase() === preset.name.toLowerCase(),
    )
  ) {
    return; // already added
  }
  let data;
  try {
    data = await loadPresetData(preset);
  } catch (err) {
    console.warn('preset load failed:', err);
    return;
  }

  // Distinct brands, ordered by frequency (most common first, "Other" last).
  const brandCounts = new Map<string, number>();
  for (const loc of data.locations) {
    const b = loc.brand ?? 'Other';
    brandCounts.set(b, (brandCounts.get(b) ?? 0) + 1);
  }
  const brands = [...brandCounts.keys()].sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return brandCounts.get(b)! - brandCounts.get(a)!;
  });

  const settings = await openGroupSettingsModal({
    title: `Add ${preset.name}`,
    defaults: preset.defaults,
    submitLabel: 'Add',
    brands: brands.length > 1 ? brands : undefined,
  });
  if (!settings) return;

  // Apply the brand filter, if the multiselect was shown.
  let locations = data.locations;
  if (settings.selectedBrands) {
    const keep = new Set(settings.selectedBrands);
    locations = locations.filter((l) => keep.has(l.brand ?? 'Other'));
  }
  if (locations.length === 0) return;

  const group = getState().addGroup({
    name: preset.name,
    emoji: preset.emoji,
    modes: settings.modes,
    peak: settings.peak,
    visitsPerWeek: settings.visitsPerWeek,
    polygon: data.polygon,
  });
  for (const loc of locations) {
    const snap = snapToGrid(matrix, loc.lng, loc.lat);
    if (!snap) continue;
    getState().addDestination({
      id: crypto.randomUUID(),
      name: loc.name,
      lng: loc.lng,
      lat: loc.lat,
      // Per-destination settings are unused for grouped destinations (scoring
      // and the marker emoji both read the group) — stored only to keep the
      // Destination shape valid.
      visitsPerWeek: settings.visitsPerWeek,
      modes: settings.modes,
      peak: settings.peak,
      emoji: preset.emoji,
      groupId: group.id,
      snappedH3: snap.h3,
      snappedLng: snap.lng,
      snappedLat: snap.lat,
    });
  }
}

// Open the group editor: settings apply to the whole group; also exposes
// full-group delete and per-location removal.
function openGroupEditor(groupId: string, highlightDestId?: string) {
  const s = getState();
  const group = s.groups.find((c) => c.id === groupId);
  if (!group) return;
  const dests = s.destinations.filter((d) => d.groupId === groupId);
  openGroupEditorModal({
    group,
    destinations: dests,
    highlightDestId,
    neighborhoodOf: (d) => neighborhoodAt(d.lng, d.lat),
    onSave: (settings) => {
      getState().updateGroup(groupId, {
        modes: settings.modes,
        peak: settings.peak,
        visitsPerWeek: settings.visitsPerWeek,
      });
    },
    onDeleteGroup: () => {
      getState().removeGroup(groupId);
    },
    onRemoveDestination: (id) => {
      getState().removeDestination(id);
    },
  });
}

// Clicking a destination marker: grouped → open the group editor and scroll to
// the clicked location; standalone → open that destination's edit popup.
function onMarkerClick(id: string) {
  const d = getState().destinations.find((x) => x.id === id);
  if (!d) return;
  if (d.groupId) {
    openGroupEditor(d.groupId, id);
  } else {
    openEditPopupForDestination(id, false);
  }
}

// --- Edit popup --------------------------------------------------------------

function openEditPopupForDestination(id: string, flyTo: boolean) {
  const d = getState().destinations.find((x) => x.id === id);
  if (!d) return;
  if (flyTo) {
    map.flyTo({ center: [d.lng, d.lat], zoom: Math.max(map.getZoom(), 13) });
  }
  if (activePopup) activePopup.remove();
  activePopup = openDestinationPopup(map, {
    lng: d.lng,
    lat: d.lat,
    existing: d,
    onSave: (updated) => {
      getState().updateDestination(d.id, snapDestination(updated));
      activePopup = null;
    },
    onCancel: () => {
      activePopup = null;
    },
    onDelete: () => {
      getState().removeDestination(d.id);
      activePopup = null;
    },
  });
}

async function placeAbode(lng: number, lat: number) {
  const matrix = getLoadedMatrix();
  if (!matrix) return;
  const snap = snapToGrid(matrix, lng, lat);
  if (!snap) return;
  // Marker + arc origin: exact click point. Matrix lookup: snapped cell.
  getState().setAbode({ lng, lat, h3: snap.h3, index: snap.index });
  await refreshArcs();
}

async function refreshArcs() {
  const s = getState();
  if (!s.abode) {
    getState().setArcs([]);
    return;
  }
  const arcs = await computeArcs(s.abode, s.destinations, s.groups);
  getState().setArcs(arcs);
}

async function runCompute() {
  const s = getState();
  if (s.destinations.length === 0) return;
  s.setComputing(true);
  try {
    const scores = await computeScores(s.destinations, s.groups);
    if (scores) getState().setHexScores(scores);
    if (s.abode) await refreshArcs();
  } finally {
    getState().setComputing(false);
  }
}

// Recompute arcs whenever destinations/groups change and an abode is placed.
let prevDeps: { dests: unknown; groups: unknown } = {
  dests: getState().destinations,
  groups: getState().groups,
};
store.subscribe((s) => {
  if (!s.abode) return;
  if (s.destinations !== prevDeps.dests || s.groups !== prevDeps.groups) {
    prevDeps = { dests: s.destinations, groups: s.groups };
    void refreshArcs();
  }
});
