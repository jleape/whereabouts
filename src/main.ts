import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';

import { createMap } from './map/basemap';
import { attachOverlay } from './map/overlay';
import { store, getState } from './state/store';
import type { Destination } from './state/types';
import { openDestinationPopup } from './ui/popup';
import { initPanel } from './ui/panel';
import { getLoadedMatrix, loadManifest } from './data/matrix';
import { snapToGrid } from './data/snap';
import { computeArcs, computeScores } from './compute/score';
import { loadPresetData, type PresetMeta } from './presets/loader';
import { openChainSettingsModal, openChainEditorModal } from './ui/chain-popup';

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

let activePopup: maplibregl.Popup | null = null;

map.on('load', async () => {
  attachOverlay(map, {
    onDestinationClick: (id) => onMarkerClick(id),
  });
  try {
    const matrix = await loadManifest('/data/sf');
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
  onToggleHood: () => {
    const s = getState();
    if (s.mode === 'choosing-hood') {
      s.setMode('idle');
      mapContainer.style.cursor = '';
    } else {
      s.setMode('choosing-hood');
      mapContainer.style.cursor = 'crosshair';
    }
  },
  onResetResults: () => {
    getState().resetResults();
  },
  onAddPresetChain: (preset) => {
    void addPresetChain(preset);
  },
  onOpenChain: (chainId) => {
    openChainEditor(chainId);
  },
  onConfirmBatchDelete: () => {
    confirmBatchDelete();
  },
  onCancelBatchDelete: () => {
    cancelBatchDelete();
  },
});

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
  } else if (s.mode === 'choosing-hood') {
    placeHood(e.lngLat.lng, e.lngLat.lat);
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

// Add a preset chain: confirm chain-level settings, then bulk-add all the
// preset's locations as members of a new chain.
async function addPresetChain(preset: PresetMeta) {
  const matrix = getLoadedMatrix();
  if (!matrix) return;
  if (
    getState().chains.some(
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

  const settings = await openChainSettingsModal({
    title: `Add ${data.locations.length} ${preset.name} as a chain`,
    defaults: preset.defaults,
    submitLabel: `Add ${data.locations.length}`,
  });
  if (!settings) return;

  const chain = getState().addChain({
    name: preset.name,
    emoji: preset.emoji,
    modes: settings.modes,
    peak: settings.peak,
    visitsPerWeek: settings.visitsPerWeek,
  });
  for (const loc of data.locations) {
    const snap = snapToGrid(matrix, loc.lng, loc.lat);
    if (!snap) continue;
    getState().addDestination({
      id: crypto.randomUUID(),
      name: loc.name,
      lng: loc.lng,
      lat: loc.lat,
      // Per-destination settings are unused for chained destinations (scoring
      // reads the chain) — stored only to keep the Destination shape valid.
      visitsPerWeek: settings.visitsPerWeek,
      modes: settings.modes,
      peak: settings.peak,
      chainId: chain.id,
      snappedH3: snap.h3,
      snappedLng: snap.lng,
      snappedLat: snap.lat,
    });
  }
}

// Open the chain editor: settings apply to the whole chain; also exposes
// batch-delete and full-chain delete.
function openChainEditor(chainId: string) {
  const s = getState();
  const chain = s.chains.find((c) => c.id === chainId);
  if (!chain) return;
  const dests = s.destinations.filter((d) => d.chainId === chainId);
  openChainEditorModal({
    chain,
    destinations: dests,
    onSave: (settings) => {
      getState().updateChain(chainId, {
        modes: settings.modes,
        peak: settings.peak,
        visitsPerWeek: settings.visitsPerWeek,
      });
    },
    onDeleteChain: () => {
      getState().removeChain(chainId);
    },
    onBatchDelete: () => {
      startBatchDelete(chainId);
    },
  });
}

// Clicking a destination marker: chained → open the chain editor (settings are
// chain-level); standalone → open that destination's edit popup.
function onMarkerClick(id: string) {
  const d = getState().destinations.find((x) => x.id === id);
  if (!d) return;
  if (d.chainId) {
    openChainEditor(d.chainId);
  } else {
    openEditPopupForDestination(id, false);
  }
}

// --- Batch delete ------------------------------------------------------------

function startBatchDelete(chainId: string) {
  if (activePopup) activePopup.remove();
  activePopup = null;
  getState().startBatchDelete(chainId);
}

function cancelBatchDelete() {
  endBatchDrag();
  getState().endBatchDelete();
}

function confirmBatchDelete() {
  const b = getState().batchDelete;
  if (!b) return;
  for (const id of b.selectedIds) getState().removeDestination(id);
  cancelBatchDelete();
}

// Custom drag-to-select rectangle. Only active while mode === 'batch-deleting'.
// We disable map.dragPan in that mode so mousedown reaches us directly.
let dragStart: { x: number; y: number } | null = null;
let dragRectEl: HTMLDivElement | null = null;
const DRAG_THRESHOLD_PX = 4;

function endBatchDrag() {
  if (dragRectEl) {
    dragRectEl.remove();
    dragRectEl = null;
  }
  dragStart = null;
}

function onCanvasMouseDown(e: MouseEvent) {
  if (getState().mode !== 'batch-deleting') return;
  if (e.button !== 0) return;
  const rect = mapContainer.getBoundingClientRect();
  dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onCanvasMouseMove(e: MouseEvent) {
  if (!dragStart) return;
  const rect = mapContainer.getBoundingClientRect();
  const cur = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const dx = cur.x - dragStart.x;
  const dy = cur.y - dragStart.y;
  if (!dragRectEl && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
  if (!dragRectEl) {
    dragRectEl = document.createElement('div');
    dragRectEl.className = 'batch-rect';
    mapContainer.appendChild(dragRectEl);
  }
  const left = Math.min(dragStart.x, cur.x);
  const top = Math.min(dragStart.y, cur.y);
  dragRectEl.style.left = `${left}px`;
  dragRectEl.style.top = `${top}px`;
  dragRectEl.style.width = `${Math.abs(dx)}px`;
  dragRectEl.style.height = `${Math.abs(dy)}px`;
}

function onCanvasMouseUp(e: MouseEvent) {
  if (!dragStart) return;
  const start = dragStart;
  const drawn = !!dragRectEl;
  const rect = mapContainer.getBoundingClientRect();
  const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  endBatchDrag();
  if (!drawn) return; // treat as a click — let deck.gl handle it via onClick

  const s = getState();
  if (s.mode !== 'batch-deleting' || !s.batchDelete) return;
  const box = {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y),
  };
  const hits: string[] = [];
  for (const d of s.destinations) {
    if (d.chainId !== s.batchDelete.chainId) continue;
    const p = map.project([d.lng, d.lat]);
    if (p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom) {
      hits.push(d.id);
    }
  }
  if (hits.length > 0) getState().addToBatchSelection(hits);
}

mapContainer.addEventListener('mousedown', onCanvasMouseDown);
window.addEventListener('mousemove', onCanvasMouseMove);
window.addEventListener('mouseup', onCanvasMouseUp);

// Disable map drag-pan while in batch mode so our rect drag isn't fighting it.
store.subscribe((s) => {
  if (s.mode === 'batch-deleting') {
    map.dragPan.disable();
    map.boxZoom.disable();
    mapContainer.style.cursor = 'crosshair';
  } else {
    map.dragPan.enable();
    map.boxZoom.enable();
    endBatchDrag();
  }
});

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

async function placeHood(lng: number, lat: number) {
  const matrix = getLoadedMatrix();
  if (!matrix) return;
  const snap = snapToGrid(matrix, lng, lat);
  if (!snap) return;
  // Marker + arc origin: exact click point. Matrix lookup: snapped cell.
  getState().setHood({ lng, lat, h3: snap.h3, index: snap.index });
  await refreshArcs();
}

async function refreshArcs() {
  const s = getState();
  if (!s.hood) {
    getState().setArcs([]);
    return;
  }
  const arcs = await computeArcs(s.hood, s.destinations, s.chains);
  getState().setArcs(arcs);
}

async function runCompute() {
  const s = getState();
  if (s.destinations.length === 0) return;
  s.setComputing(true);
  try {
    const scores = await computeScores(s.destinations, s.chains);
    if (scores) getState().setHexScores(scores);
    if (s.hood) await refreshArcs();
  } finally {
    getState().setComputing(false);
  }
}

// Recompute arcs whenever destinations/chains change and a hood is placed.
let prevDeps: { dests: unknown; chains: unknown } = {
  dests: getState().destinations,
  chains: getState().chains,
};
store.subscribe((s) => {
  if (!s.hood) return;
  if (s.destinations !== prevDeps.dests || s.chains !== prevDeps.chains) {
    prevDeps = { dests: s.destinations, chains: s.chains };
    void refreshArcs();
  }
});
