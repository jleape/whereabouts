import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';

import { createMap } from './map/basemap';
import { attachOverlay } from './map/overlay';
import { searchCity } from './map/geocode';
import { store, getState } from './state/store';
import type { Destination } from './state/types';
import { openDestinationPopup } from './ui/popup';
import { initPanel } from './ui/panel';
import {
  bboxAreaKm2,
  estimateHexCount,
  pickResolution,
} from './compute/grid';

import ComputeWorker from './workers/compute.worker.ts?worker';
import type { ComputeResult } from './workers/compute.worker';

const mapContainer = document.getElementById('map')!;
const map = createMap(mapContainer);

map.on('load', () => {
  attachOverlay(map);
  const restored = getState().city;
  if (restored) {
    map.fitBounds(
      [
        [restored.bbox[0], restored.bbox[1]],
        [restored.bbox[2], restored.bbox[3]],
      ],
      { padding: 40, duration: 0 },
    );
  }
});

let activePopup: maplibregl.Popup | null = null;

function currentViewBbox(): [number, number, number, number] {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

function refreshViewInfo() {
  if (getState().mode !== 'framing') return;
  const bbox = currentViewBbox();
  const areaKm2 = bboxAreaKm2(bbox);
  const resolution = pickResolution(areaKm2);
  const estimatedHexes = estimateHexCount(areaKm2, resolution);
  getState().setViewInfo({ bbox, areaKm2, resolution, estimatedHexes });
}

map.on('moveend', refreshViewInfo);
map.on('zoomend', refreshViewInfo);

initPanel({
  onSearchCity: async (q) => {
    const status = document.getElementById('city-status')!;
    status.textContent = 'Searching…';
    status.classList.remove('error');
    try {
      const city = await searchCity(q);
      if (!city) {
        status.textContent = 'No matching city found.';
        status.classList.add('error');
        return;
      }
      store.getState().setCity(city);
      map.fitBounds(
        [
          [city.bbox[0], city.bbox[1]],
          [city.bbox[2], city.bbox[3]],
        ],
        { padding: 40, duration: 800 },
      );
    } catch (err) {
      status.textContent = `Search failed: ${(err as Error).message}`;
      status.classList.add('error');
    }
  },
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
    const d = getState().destinations.find((x) => x.id === id);
    if (!d) return;
    map.flyTo({ center: [d.lng, d.lat], zoom: Math.max(map.getZoom(), 13) });
    if (activePopup) activePopup.remove();
    activePopup = openDestinationPopup(map, {
      lng: d.lng,
      lat: d.lat,
      existing: d,
      onSave: (updated) => {
        getState().updateDestination(d.id, updated);
        activePopup = null;
      },
      onCancel: () => {
        activePopup = null;
      },
    });
  },
  onRemoveDestination: (id) => {
    getState().removeDestination(id);
  },
  onStartFraming: () => {
    const s = getState();
    if (s.destinations.length === 0) return;
    s.setMode('framing');
    refreshViewInfo();
  },
  onConfirmCompute: () => {
    runCompute();
  },
  onCancelFraming: () => {
    getState().setMode('idle');
    getState().setViewInfo(null);
  },
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
});

map.on('click', (e) => {
  const s = getState();
  if (s.mode === 'adding-destination') {
    if (activePopup) activePopup.remove();
    activePopup = openDestinationPopup(map, {
      lng: e.lngLat.lng,
      lat: e.lngLat.lat,
      onSave: (d: Destination) => {
        s.addDestination(d);
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
    s.setHood({ lng: e.lngLat.lng, lat: e.lngLat.lat });
  }
});

let worker: Worker | null = null;

function runCompute() {
  const s = getState();
  const info = s.viewInfo;
  if (!info || s.destinations.length === 0) return;

  s.setComputing(true);
  if (worker) worker.terminate();
  worker = new ComputeWorker();
  worker.onmessage = (e: MessageEvent<ComputeResult>) => {
    const msg = e.data;
    if (msg.type === 'result') {
      getState().setHexScores(msg.hexScores, msg.resolution);
      getState().setComputing(false);
      getState().setMode('idle');
      getState().setViewInfo(null);
    }
  };
  worker.postMessage({
    type: 'compute',
    bbox: info.bbox,
    resolution: info.resolution,
    destinations: s.destinations,
    chains: s.chains,
  });
}
