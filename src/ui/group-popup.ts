import {
  ALL_MODES,
  MODE_LABEL,
  type Group,
  type Destination,
  type PeakPeriod,
  type TravelMode,
} from '../state/types';
import type { PresetDefaults } from '../presets/loader';

export interface GroupSettings {
  visitsPerWeek: number;
  modes: TravelMode[];
  peak: PeakPeriod;
  // Brands the user kept (when the settings modal showed a brand multiselect).
  selectedBrands?: string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shared settings form markup (visits / modes / peak).
function settingsFieldsHtml(defaults: GroupSettings | PresetDefaults): string {
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
        <label><input type="radio" name="group-peak" value="peak" ${defaults.peak === 'peak' ? 'checked' : ''}/> Peak</label>
        <label><input type="radio" name="group-peak" value="offpeak" ${defaults.peak === 'offpeak' ? 'checked' : ''}/> Off-peak</label>
      </div>
    </div>
  `;
}

// Optional brand multiselect — checkboxes for the distinct brands in a preset.
function brandsFieldHtml(brands: string[]): string {
  return `
    <div class="field">
      <label>Which ones?</label>
      <div class="modes">
        ${brands
          .map(
            (b) => `
          <label>
            <input type="checkbox" data-brand="${escapeHtml(b)}" checked />
            ${escapeHtml(b)}
          </label>`,
          )
          .join('')}
      </div>
    </div>
  `;
}

// Read the settings form back into a GroupSettings, or null if invalid.
function readSettings(modal: HTMLElement): GroupSettings | null {
  const visits = parseFloat(
    (modal.querySelector('[data-field="visits"]') as HTMLInputElement).value,
  );
  const modes = ALL_MODES.filter(
    (m) => (modal.querySelector(`[data-mode="${m}"]`) as HTMLInputElement).checked,
  ) as TravelMode[];
  const peakInput = modal.querySelector(
    'input[name="group-peak"]:checked',
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
  const brandBoxes = [
    ...modal.querySelectorAll<HTMLInputElement>('[data-brand]'),
  ];
  let selectedBrands: string[] | undefined;
  if (brandBoxes.length > 0) {
    selectedBrands = brandBoxes
      .filter((b) => b.checked)
      .map((b) => b.dataset.brand!);
    if (selectedBrands.length === 0) {
      alert('Pick at least one to include.');
      return null;
    }
  }
  return { visitsPerWeek: visits, modes, peak, selectedBrands };
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

// --- Preset add: capture group settings before bulk-adding -------------------

interface SettingsModalInit {
  title: string;
  defaults: PresetDefaults;
  submitLabel?: string;
  // Distinct brands in the preset — when 2+, a brand multiselect is shown.
  brands?: string[];
}

export function openGroupSettingsModal(
  init: SettingsModalInit,
): Promise<GroupSettings | null> {
  return new Promise((resolve) => {
    const { backdrop, modal } = mountModal();
    const showBrands = !!init.brands && init.brands.length > 1;
    modal.innerHTML = `
      <h3 class="modal-title">${escapeHtml(init.title)}</h3>
      ${showBrands ? brandsFieldHtml(init.brands!) : ''}
      ${settingsFieldsHtml(init.defaults)}
      <div class="actions">
        <div class="actions-right">
          <button type="button" data-action="cancel">Cancel</button>
          <button type="button" class="primary" data-action="save">${escapeHtml(init.submitLabel ?? 'Add')}</button>
        </div>
      </div>
    `;

    function cleanup(result: GroupSettings | null) {
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

// --- Group editor: settings + destination list + delete tools ---------------

interface EditorModalInit {
  group: Group;
  destinations: Destination[]; // members of this group
  // Resolves a destination's SF neighborhood for display in the list.
  neighborhoodOf: (d: Destination) => string;
  // When set, scroll to and highlight this destination's row.
  highlightDestId?: string;
  onSave: (settings: GroupSettings) => void;
  onDeleteGroup: () => void;
  onRemoveDestination: (id: string) => void;
}

export function openGroupEditorModal(init: EditorModalInit): void {
  const { backdrop, modal } = mountModal();
  const { group, destinations } = init;
  modal.classList.add('group-editor');
  let remaining = destinations.length;

  const countLabel = (n: number) =>
    `${n} location${n === 1 ? '' : 's'} in this group`;

  modal.innerHTML = `
    <h3 class="modal-title">${group.emoji} ${escapeHtml(group.name)}</h3>
    ${settingsFieldsHtml({
      visitsPerWeek: group.visitsPerWeek,
      modes: group.modes,
      peak: group.peak,
    })}
    <div class="field">
      <label data-count-label>${countLabel(remaining)}</label>
      <div class="group-dest-list">
        ${destinations
          .map(
            (d) => `
          <div class="group-dest-row" data-dest-id="${d.id}">
            <span class="gd-name">${escapeHtml(d.name)}</span>
            <span class="gd-hood">${escapeHtml(init.neighborhoodOf(d))}</span>
            <button type="button" class="gd-remove" title="Remove">×</button>
          </div>`,
          )
          .join('')}
      </div>
    </div>
    <div class="actions">
      <button type="button" class="danger-btn" data-action="delete-group" title="Delete this whole group">Delete group</button>
      <div class="actions-right">
        <button type="button" class="primary" data-action="save">Save</button>
      </div>
    </div>
  `;

  // Per-row remove buttons.
  for (const row of modal.querySelectorAll<HTMLElement>('.group-dest-row')) {
    const id = row.dataset.destId!;
    row.querySelector('.gd-remove')!.addEventListener('click', () => {
      init.onRemoveDestination(id);
      row.remove();
      remaining -= 1;
      modal.querySelector('[data-count-label]')!.textContent = countLabel(remaining);
    });
  }

  // Scroll to + highlight the clicked destination's row.
  if (init.highlightDestId) {
    const row = modal.querySelector<HTMLElement>(
      `.group-dest-row[data-dest-id="${CSS.escape(init.highlightDestId)}"]`,
    );
    if (row) {
      row.classList.add('highlight');
      requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }));
    }
  }

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
  modal.querySelector('[data-action="delete-group"]')!.addEventListener('click', () => {
    if (confirm(`Delete the entire "${group.name}" group and all ${destinations.length} locations?`)) {
      init.onDeleteGroup();
      cleanup();
    }
  });
}
