import { store } from '../state/store';
import { MODE_EMOJI } from '../state/types';
import { paletteSwatches } from '../compute/colors';
import { loadPresets, type PresetMeta } from '../presets/loader';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector<T>(sel)!;

export function initPanel(handlers: {
  onToggleAddMode: () => void;
  onEditDestination: (id: string) => void;
  onRemoveDestination: (id: string) => void;
  onCompute: () => void;
  onToggleHood: () => void;
  onResetResults: () => void;
  onAddPresetChain: (preset: PresetMeta) => void;
  onOpenChain: (chainId: string) => void;
  onConfirmBatchDelete: () => void;
  onCancelBatchDelete: () => void;
}) {
  $<HTMLButtonElement>('#add-dest-btn').addEventListener('click', handlers.onToggleAddMode);
  $<HTMLButtonElement>('#done-btn').addEventListener('click', handlers.onCompute);
  $<HTMLButtonElement>('#hood-btn').addEventListener('click', handlers.onToggleHood);
  $<HTMLButtonElement>('#reset-btn').addEventListener('click', handlers.onResetResults);
  $<HTMLButtonElement>('#batch-confirm-btn').addEventListener('click', handlers.onConfirmBatchDelete);
  $<HTMLButtonElement>('#batch-cancel-btn').addEventListener('click', handlers.onCancelBatchDelete);

  const capSlider = $<HTMLInputElement>('#cap-slider');
  capSlider.addEventListener('input', () => {
    const v = parseFloat(capSlider.value);
    if (Number.isFinite(v)) store.getState().setWeeklyCap(v);
  });

  const presetSelect = $<HTMLSelectElement>('#preset-select');
  let presets: PresetMeta[] = [];
  presetSelect.addEventListener('change', () => {
    const preset = presets.find((p) => p.id === presetSelect.value);
    presetSelect.value = ''; // reset to placeholder
    if (preset) handlers.onAddPresetChain(preset);
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

    // Batch-delete banner
    const batchBanner = $<HTMLElement>('#batch-banner');
    const confirmBtn = $<HTMLButtonElement>('#batch-confirm-btn');
    if (s.mode === 'batch-deleting' && s.batchDelete) {
      const count = s.batchDelete.selectedIds.length;
      const chain = s.chains.find((c) => c.id === s.batchDelete!.chainId);
      $('#batch-banner-text').textContent =
        count === 0
          ? `Drag a rectangle to select ${chain?.name ?? 'destinations'} to delete`
          : `${count} selected · click a marker to toggle`;
      confirmBtn.disabled = count === 0;
      confirmBtn.textContent = count > 0 ? `Delete ${count}` : 'Delete';
      batchBanner.hidden = false;
    } else {
      batchBanner.hidden = true;
    }

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

    const hoodBtn = $<HTMLButtonElement>('#hood-btn');
    hoodBtn.classList.toggle('active', s.mode === 'choosing-hood');
    hoodBtn.textContent =
      s.mode === 'choosing-hood' ? 'Stop choosing neighborhood' : 'Choose a neighborhood';

    const computeBtn = $<HTMLButtonElement>('#done-btn');
    computeBtn.disabled = !s.matrixReady || s.destinations.length === 0 || s.computing;
    computeBtn.textContent = s.computing ? 'Computing…' : 'Compute travel times';

    // Preset dropdown — list only presets not yet added.
    presetSelect.disabled = !s.matrixReady || presets.length === 0;
    const addedNames = new Set(s.chains.map((c) => c.name.toLowerCase()));
    const available = presets.filter((p) => !addedNames.has(p.name.toLowerCase()));
    presetSelect.innerHTML =
      `<option value="">${available.length ? '+ Add a preset chain…' : 'All preset chains added'}</option>` +
      available
        .map((p) => `<option value="${p.id}">${p.emoji}  ${escapeHtml(p.name)}</option>`)
        .join('');

    // Destinations list: one card per chain + one card per standalone destination.
    const list = $('#destinations-list');
    list.innerHTML = '';
    for (const chain of s.chains) {
      const count = s.destinations.filter((d) => d.chainId === chain.id).length;
      const card = document.createElement('div');
      card.className = 'dest-item chain-card';
      card.innerHTML = `
        <div>
          <div>${chain.emoji} ${escapeHtml(chain.name)}</div>
          <div class="meta">${count} location${count === 1 ? '' : 's'} · ${chain.visitsPerWeek}/wk · ${chain.modes.map((m) => MODE_EMOJI[m]).join(' ')}</div>
        </div>
        <div class="actions"><button data-open>Settings</button></div>
      `;
      card.querySelector('[data-open]')!.addEventListener('click', () =>
        handlers.onOpenChain(chain.id),
      );
      list.appendChild(card);
    }
    const singles = s.destinations.filter((d) => !d.chainId);
    for (const d of singles) list.appendChild(destItem(d));

    if (s.destinations.length === 0 && s.chains.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'status';
      empty.textContent =
        'Add a preset chain above, or click + Add then click the map.';
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
        <div class="legend-row"><span>Weekly travel</span></div>
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
        <div>📍 ${escapeHtml(d.name)}</div>
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

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h${m ? m + 'm' : ''}`;
}
