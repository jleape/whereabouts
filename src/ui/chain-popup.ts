import {
  ALL_MODES,
  MODE_LABEL,
  type Chain,
  type Destination,
  type PeakPeriod,
  type TravelMode,
} from '../state/types';
import type { PresetDefaults } from '../presets/loader';

export interface ChainSettings {
  visitsPerWeek: number;
  modes: TravelMode[];
  peak: PeakPeriod;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shared settings form markup (visits / modes / peak).
function settingsFieldsHtml(defaults: ChainSettings | PresetDefaults): string {
  return `
    <div class="field">
      <label>Visits per week (fractions ok)</label>
      <input type="number" data-field="visits" step="0.1" min="0" value="${defaults.visitsPerWeek}" />
    </div>
    <div class="field">
      <label>Possible travel modes</label>
      <div class="modes">
        ${ALL_MODES.map(
          (m) => `
          <label>
            <input type="checkbox" data-mode="${m}" ${defaults.modes.includes(m) ? 'checked' : ''} />
            ${MODE_LABEL[m]}
          </label>`,
        ).join('')}
      </div>
    </div>
    <div class="field">
      <label>When do you typically go?</label>
      <div class="peak">
        <label><input type="radio" name="chain-peak" value="peak" ${defaults.peak === 'peak' ? 'checked' : ''}/> Peak</label>
        <label><input type="radio" name="chain-peak" value="offpeak" ${defaults.peak === 'offpeak' ? 'checked' : ''}/> Off-peak</label>
      </div>
    </div>
  `;
}

// Read the settings form back into a ChainSettings, or null if invalid.
function readSettings(modal: HTMLElement): ChainSettings | null {
  const visits = parseFloat(
    (modal.querySelector('[data-field="visits"]') as HTMLInputElement).value,
  );
  const modes = ALL_MODES.filter(
    (m) => (modal.querySelector(`[data-mode="${m}"]`) as HTMLInputElement).checked,
  ) as TravelMode[];
  const peakInput = modal.querySelector(
    'input[name="chain-peak"]:checked',
  ) as HTMLInputElement;
  const peak = (peakInput?.value ?? 'peak') as PeakPeriod;
  if (!Number.isFinite(visits) || visits <= 0) {
    alert('Visits per week must be a positive number.');
    return null;
  }
  if (modes.length === 0) {
    alert('Pick at least one travel mode.');
    return null;
  }
  return { visitsPerWeek: visits, modes, peak };
}

function mountModal(): { backdrop: HTMLElement; modal: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal popup-form';
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  return { backdrop, modal };
}

// --- Preset add: capture chain settings before bulk-adding -------------------

interface SettingsModalInit {
  title: string;
  defaults: PresetDefaults;
  submitLabel?: string;
}

export function openChainSettingsModal(
  init: SettingsModalInit,
): Promise<ChainSettings | null> {
  return new Promise((resolve) => {
    const { backdrop, modal } = mountModal();
    modal.innerHTML = `
      <h3 class="modal-title">${escapeHtml(init.title)}</h3>
      ${settingsFieldsHtml(init.defaults)}
      <div class="actions">
        <div class="actions-right">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="button" class="primary" data-action="save">${escapeHtml(init.submitLabel ?? 'Add')}</button>
        </div>
      </div>
    `;

    function cleanup(result: ChainSettings | null) {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cleanup(null);
    }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup(null);
    });
    modal.querySelector('[data-action="cancel"]')!.addEventListener('click', () => cleanup(null));
    modal.querySelector('[data-action="save"]')!.addEventListener('click', () => {
      const s = readSettings(modal);
      if (s) cleanup(s);
    });
  });
}

// --- Chain editor: settings + destination list + delete tools ---------------

interface EditorModalInit {
  chain: Chain;
  destinations: Destination[]; // members of this chain
  onSave: (settings: ChainSettings) => void;
  onDeleteChain: () => void;
  onBatchDelete: () => void;
}

export function openChainEditorModal(init: EditorModalInit): void {
  const { backdrop, modal } = mountModal();
  const { chain, destinations } = init;
  modal.classList.add('chain-editor');

  modal.innerHTML = `
    <h3 class="modal-title">${chain.emoji} ${escapeHtml(chain.name)}</h3>
    ${settingsFieldsHtml({
      visitsPerWeek: chain.visitsPerWeek,
      modes: chain.modes,
      peak: chain.peak,
    })}
    <div class="field">
      <label>${destinations.length} location${destinations.length === 1 ? '' : 's'} in this chain</label>
      <div class="chain-dest-list">
        ${destinations
          .map((d) => `<div class="chain-dest-row">${escapeHtml(d.name)}</div>`)
          .join('')}
      </div>
    </div>
    <div class="actions">
      <button type="button" class="danger-btn" data-action="delete-chain" title="Delete this whole chain">Delete chain</button>
      <div class="actions-right">
        <button type="button" data-action="batch-delete">Batch delete locations</button>
        <button type="button" class="primary" data-action="save">Save</button>
      </div>
    </div>
  `;

  function cleanup() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') cleanup();
  }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) cleanup();
  });

  modal.querySelector('[data-action="save"]')!.addEventListener('click', () => {
    const s = readSettings(modal);
    if (!s) return;
    init.onSave(s);
    cleanup();
  });
  modal.querySelector('[data-action="delete-chain"]')!.addEventListener('click', () => {
    if (confirm(`Delete the entire "${chain.name}" chain and all ${destinations.length} locations?`)) {
      init.onDeleteChain();
      cleanup();
    }
  });
  modal.querySelector('[data-action="batch-delete"]')!.addEventListener('click', () => {
    cleanup();
    init.onBatchDelete();
  });
}
