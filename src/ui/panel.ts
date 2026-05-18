import { store } from '../state/store';
import { MODE_EMOJI } from '../state/types';
import { paletteSwatches } from '../compute/colors';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector<T>(sel)!;

export function initPanel(handlers: {
  onSearchCity: (q: string) => void;
  onToggleAddMode: () => void;
  onEditDestination: (id: string) => void;
  onRemoveDestination: (id: string) => void;
  onStartFraming: () => void;
  onConfirmCompute: () => void;
  onCancelFraming: () => void;
  onToggleHood: () => void;
  onResetResults: () => void;
}) {
  $<HTMLButtonElement>('#city-search-btn').addEventListener('click', () => {
    const q = $<HTMLInputElement>('#city-search').value.trim();
    if (q) handlers.onSearchCity(q);
  });
  $<HTMLInputElement>('#city-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = (e.target as HTMLInputElement).value.trim();
      if (q) handlers.onSearchCity(q);
    }
  });
  $<HTMLButtonElement>('#add-dest-btn').addEventListener('click', handlers.onToggleAddMode);
  $<HTMLButtonElement>('#done-btn').addEventListener('click', handlers.onStartFraming);
  $<HTMLButtonElement>('#confirm-compute-btn').addEventListener('click', handlers.onConfirmCompute);
  $<HTMLButtonElement>('#cancel-framing-btn').addEventListener('click', handlers.onCancelFraming);
  $<HTMLButtonElement>('#hood-btn').addEventListener('click', handlers.onToggleHood);
  $<HTMLButtonElement>('#reset-btn').addEventListener('click', handlers.onResetResults);

  store.subscribe(render);
  render();

  function render() {
    const s = store.getState();

    // City section status
    const cityStatus = $('#city-status');
    if (s.city) {
      cityStatus.textContent = s.city.displayName;
      cityStatus.classList.remove('error');
    }

    // Destinations section visibility
    $<HTMLElement>('#destinations-section').hidden = !s.city;

    // Results section visibility
    $<HTMLElement>('#results-section').hidden = s.hexScores.length === 0;

    // Add-mode button visual state
    const addBtn = $<HTMLButtonElement>('#add-dest-btn');
    addBtn.classList.toggle('active', s.mode === 'adding-destination');
    addBtn.textContent = s.mode === 'adding-destination' ? '× Cancel' : '+ Add';
    addBtn.disabled = s.mode === 'framing';

    // Hood-mode button visual state
    const hoodBtn = $<HTMLButtonElement>('#hood-btn');
    hoodBtn.classList.toggle('active', s.mode === 'choosing-hood');
    hoodBtn.textContent =
      s.mode === 'choosing-hood' ? 'Stop choosing hood' : 'Choose a hood';

    // Framing vs idle UI in destinations section
    const framingBox = $<HTMLElement>('#framing-box');
    const computeBtn = $<HTMLButtonElement>('#done-btn');
    if (s.mode === 'framing') {
      framingBox.hidden = false;
      computeBtn.hidden = true;
      const info = s.viewInfo;
      const framingInfo = $('#framing-info');
      if (info) {
        framingInfo.innerHTML = `View area: <b>${fmtArea(info.areaKm2)}</b> · resolution <b>H3 ${info.resolution}</b> · ~<b>${info.estimatedHexes.toLocaleString()}</b> hexes`;
      } else {
        framingInfo.textContent = 'Move the map to see grid info.';
      }
      const confirmBtn = $<HTMLButtonElement>('#confirm-compute-btn');
      confirmBtn.disabled = !!s.computing || !info || info.estimatedHexes === 0;
      confirmBtn.textContent = s.computing ? 'Computing…' : 'Compute for this view';
    } else {
      framingBox.hidden = true;
      computeBtn.hidden = false;
      computeBtn.disabled = s.destinations.length === 0 || s.computing;
      computeBtn.textContent = 'Compute travel times';
    }

    // Destinations list
    const list = $('#destinations-list');
    list.innerHTML = '';
    const singles = s.destinations.filter((d) => !d.chainId);
    const byChain = new Map<string, typeof s.destinations>();
    for (const d of s.destinations) {
      if (!d.chainId) continue;
      const arr = byChain.get(d.chainId) ?? [];
      arr.push(d);
      byChain.set(d.chainId, arr);
    }
    for (const [chainId, dests] of byChain) {
      const chain = s.chains.find((c) => c.id === chainId);
      const group = document.createElement('div');
      group.className = 'chain-group';
      group.innerHTML = `<div class="chain-header">${escapeHtml(chain?.name ?? 'Chain')} · ${dests.length} locations</div>`;
      for (const d of dests) group.appendChild(destItem(d, true));
      list.appendChild(group);
    }
    for (const d of singles) list.appendChild(destItem(d, false));
    if (s.destinations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'status';
      empty.textContent = 'Click + Add, then click on the map to add a destination.';
      list.appendChild(empty);
    }

    // Legend
    if (s.hexScores.length > 0) {
      const legend = $('#legend');
      const min = Math.min(...s.hexScores.map((h) => h.weeklyMinutes));
      const max = Math.max(...s.hexScores.map((h) => h.weeklyMinutes));
      const palette = paletteSwatches();
      legend.innerHTML = `
        <div class="legend-row"><span>Weekly travel</span></div>
        <div class="legend-row" style="gap:2px">
          ${palette.map(([r, g, b]) => `<div class="legend-swatch" style="background:rgba(${r},${g},${b},0.7); flex:1"></div>`).join('')}
        </div>
        <div class="legend-row" style="justify-content:space-between; color:var(--muted); font-size:11px">
          <span>${fmtMin(min)}</span><span>${fmtMin(max)}</span>
        </div>
      `;
    }
  }

  function destItem(d: import('../state/types').Destination, inChain: boolean) {
    const modesStr = d.modes.map((m) => MODE_EMOJI[m]).join(' ');
    const el = document.createElement('div');
    el.className = 'dest-item';
    el.innerHTML = `
      <div>
        <div>${escapeHtml(d.name)}${inChain ? '' : ''}</div>
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

function fmtArea(km2: number): string {
  if (km2 < 1) return `${(km2 * 100).toFixed(0)} ha`;
  if (km2 < 100) return `${km2.toFixed(1)} km²`;
  return `${Math.round(km2).toLocaleString()} km²`;
}
