import { store } from '../state/store';
import { MODE_EMOJI } from '../state/types';
import { paletteSwatches } from '../compute/colors';
import { loadPresets, type PresetMeta } from '../presets/loader';
import { initBottomSheet, collapseSheet } from './sheet';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector<T>(sel)!;

export function initPanel(handlers: {
  onToggleAddMode: () => void;
  onEditDestination: (id: string) => void;
  onRemoveDestination: (id: string) => void;
  onCompute: () => void;
  onToggleAbode: () => void;
  onResetResults: () => void;
  onAddPresetGroup: (preset: PresetMeta) => void;
  onOpenGroup: (groupId: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onSave: () => void;
  onLoad: () => void;
}) {
  $<HTMLButtonElement>('#add-dest-btn').addEventListener('click', handlers.onToggleAddMode);
  $<HTMLButtonElement>('#done-btn').addEventListener('click', handlers.onCompute);
  $<HTMLButtonElement>('#abode-btn').addEventListener('click', handlers.onToggleAbode);
  $<HTMLButtonElement>('#reset-btn').addEventListener('click', handlers.onResetResults);
  $<HTMLButtonElement>('#save-btn').addEventListener('click', handlers.onSave);
  $<HTMLButtonElement>('#load-btn').addEventListener('click', handlers.onLoad);

  // On mobile the panel is a bottom sheet; this wires its drag handle.
  initBottomSheet();

  const capSlider = $<HTMLInputElement>('#cap-slider');
  capSlider.addEventListener('input', () => {
    const v = parseFloat(capSlider.value);
    if (Number.isFinite(v)) store.getState().setWeeklyCap(v);
  });

  const presetSelect = $<HTMLSelectElement>('#preset-select');
  let presets: PresetMeta[] = [];
  let prevMode = store.getState().mode;
  presetSelect.addEventListener('change', () => {
    const preset = presets.find((p) => p.id === presetSelect.value);
    presetSelect.value = ''; // reset to placeholder
    if (preset) handlers.onAddPresetGroup(preset);
  });
  loadPresets()
    .then((p) => {
      presets = p;
      render();
    })
    .catch((err) => console.warn('failed to load presets:', err));

  store.subscribe(render);
  render();

  function render() {
    const s = store.getState();

    // On mobile, collapse the bottom sheet when the user needs the map: both
    // "adding a destination" and "choosing an abode" require a map click.
    if (s.mode !== prevMode) {
      if (s.mode === 'adding-destination' || s.mode === 'choosing-abode') {
        collapseSheet();
      }
      prevMode = s.mode;
    }

    // Progressive "next step" highlight — the most relevant control glows.
    //  1 add destinations · 2 do the sums · 3 choose an abode ·
    //  4 confirm the abode · 5 hunt for an apartment
    const hasDest = s.destinations.length > 0 || s.groups.length > 0;
    const step = s.mode === 'choosing-abode'
      ? 4
      : s.abode
        ? 5
        : s.hexScores.length > 0
          ? 3
          : hasDest
            ? 2
            : 1;

    // Matrix status banner
    const matrixStatus = $('#matrix-status');
    if (s.matrixError) {
      matrixStatus.textContent = `Couldn't load travel-time data: ${s.matrixError}`;
      matrixStatus.classList.add('error');
    } else if (!s.matrixReady) {
      matrixStatus.textContent = 'Loading travel-time data…';
      matrixStatus.classList.remove('error');
    } else {
      matrixStatus.textContent = '';
      matrixStatus.classList.remove('error');
    }

    $<HTMLElement>('#results-section').hidden = s.hexScores.length === 0;

    const addBtn = $<HTMLButtonElement>('#add-dest-btn');
    addBtn.classList.toggle('active', s.mode === 'adding-destination');
    addBtn.textContent = s.mode === 'adding-destination' ? '× Cancel' : '+ Add';
    addBtn.disabled = !s.matrixReady;
    addBtn.classList.toggle('nudge', step === 1);

    const abodeBtn = $<HTMLButtonElement>('#abode-btn');
    abodeBtn.classList.toggle('active', s.mode === 'choosing-abode');
    abodeBtn.textContent =
      s.mode === 'choosing-abode' ? "That'll do" : 'Whereabouts will you live?';
    abodeBtn.classList.toggle('nudge', step === 3 || step === 4);

    // Apartment-hunting links — shown once an abode is placed, pre-centered on it.
    const aptLinks = $<HTMLElement>('#apartment-links');
    if (s.abode) {
      aptLinks.querySelector('.apt-links')!.innerHTML = apartmentLinks(
        s.abode.lng,
        s.abode.lat,
      )
        .map(
          (l) =>
            `<a href="${l.url}" target="_blank" rel="noopener noreferrer" class="${step === 5 ? 'nudge' : ''}">${l.name}</a>`,
        )
        .join('');
      aptLinks.hidden = false;
    } else {
      aptLinks.hidden = true;
    }

    const computeBtn = $<HTMLButtonElement>('#done-btn');
    computeBtn.disabled = !s.matrixReady || s.destinations.length === 0 || s.computing;
    computeBtn.textContent = s.computing ? 'Computing…' : 'Do the sums';
    computeBtn.classList.toggle('nudge', step === 2);

    $<HTMLButtonElement>('#save-btn').disabled =
      s.destinations.length === 0 && s.groups.length === 0;
    $<HTMLButtonElement>('#load-btn').disabled = !s.matrixReady;

    // Preset dropdown — list only presets not yet added.
    presetSelect.disabled = !s.matrixReady || presets.length === 0;
    presetSelect.classList.toggle('nudge-outline', step === 1);
    const addedNames = new Set(s.groups.map((c) => c.name.toLowerCase()));
    const available = presets.filter((p) => !addedNames.has(p.name.toLowerCase()));
    presetSelect.innerHTML =
      `<option value="">${available.length ? '+ Add a preset group…' : 'All preset groups added'}</option>` +
      available
        .map((p) => `<option value="${p.id}">${p.emoji}  ${escapeHtml(p.name)}</option>`)
        .join('');

    // Destinations list: one card per group + one card per standalone destination.
    const list = $('#destinations-list');
    list.innerHTML = '';
    for (const group of s.groups) {
      const count = s.destinations.filter((d) => d.groupId === group.id).length;
      const card = document.createElement('div');
      card.className = 'dest-item group-card';
      card.innerHTML = `
        <div>
          <div>${group.emoji} ${escapeHtml(group.name)}</div>
          <div class="meta">${count} location${count === 1 ? '' : 's'} · ${group.visitsPerWeek}/wk · ${group.modes.map((m) => MODE_EMOJI[m]).join(' ')}</div>
        </div>
        <div class="actions">
          <button data-edit>Edit</button>
          <button data-remove>×</button>
        </div>
      `;
      card.querySelector('[data-edit]')!.addEventListener('click', () =>
        handlers.onOpenGroup(group.id),
      );
      card.querySelector('[data-remove]')!.addEventListener('click', () =>
        handlers.onRemoveGroup(group.id),
      );
      list.appendChild(card);
    }
    const singles = s.destinations.filter((d) => !d.groupId);
    for (const d of singles) list.appendChild(destItem(d));

    if (s.destinations.length === 0 && s.groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'status';
      empty.textContent =
        'Add a preset group above, or click + Add then click the map.';
      list.appendChild(empty);
    }

    // Legend + cap slider
    if (s.hexScores.length > 0) {
      const reachable = s.hexScores
        .map((h) => h.weeklyMinutes)
        .filter((v) => Number.isFinite(v));
      const dataMin = reachable.length ? Math.min(...reachable) : 0;
      const dataMax = reachable.length ? Math.max(...reachable) : 0;
      const cap = s.weeklyCap ?? dataMax;

      const slider = $<HTMLInputElement>('#cap-slider');
      slider.min = String(Math.floor(dataMin));
      slider.max = String(Math.ceil(dataMax));
      if (document.activeElement !== slider) {
        slider.value = String(Math.round(cap));
      }
      slider.disabled = dataMin === dataMax;
      $('#cap-value').textContent = fmtMin(cap);

      const legend = $('#legend');
      const palette = paletteSwatches();
      legend.innerHTML = `
        <div class="legend-row" style="gap:2px">
          ${palette.map(([r, g, b]) => `<div class="legend-swatch" style="background:rgba(${r},${g},${b},0.7); flex:1"></div>`).join('')}
        </div>
        <div class="legend-row" style="justify-content:space-between; color:var(--muted); font-size:11px">
          <span>${fmtMin(dataMin)}</span><span>${fmtMin(cap)}${cap < dataMax ? '+' : ''}</span>
        </div>
      `;
    }
  }

  function destItem(d: import('../state/types').Destination) {
    const modesStr = d.modes.map((m) => MODE_EMOJI[m]).join(' ');
    const el = document.createElement('div');
    el.className = 'dest-item';
    el.innerHTML = `
      <div>
        <div>${d.emoji || '📍'} ${escapeHtml(d.name)}</div>
        <div class="meta">${d.visitsPerWeek}/wk · ${modesStr} · ${d.peak}</div>
      </div>
      <div class="actions">
        <button data-edit>Edit</button>
        <button data-remove>×</button>
      </div>
    `;
    el.querySelector('[data-edit]')!.addEventListener('click', () =>
      handlers.onEditDestination(d.id),
    );
    el.querySelector('[data-remove]')!.addEventListener('click', () =>
      handlers.onRemoveDestination(d.id),
    );
    return el;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Apartment-hunting link pre-centered on the abode. Zillow exposes a reliable
// lat/lng URL scheme (searchQueryState + mapBounds).
function apartmentLinks(lng: number, lat: number): { name: string; url: string }[] {
  const d = 0.004; // ~±400 m box around the abode
  const zillowState = encodeURIComponent(
    JSON.stringify({
      mapBounds: { west: lng - d, east: lng + d, south: lat - d, north: lat + d },
      usersSearchTerm: 'San Francisco, CA',
      isMapVisible: true,
      isListVisible: true,
    }),
  );
  return [
    {
      name: 'Zillow (centered here)',
      url: `https://www.zillow.com/san-francisco-ca/rentals/?searchQueryState=${zillowState}`,
    },
  ];
}

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h${m ? m + 'm' : ''}`;
}
