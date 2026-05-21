import maplibregl from 'maplibre-gl';
import {
  ALL_MODES,
  MODE_LABEL,
  DESTINATION_TYPES,
  type Destination,
  type Group,
  type PeakPeriod,
  type TravelMode,
} from '../state/types';

interface PopupInit {
  lng: number;
  lat: number;
  existing?: Destination;
  // Existing groups, offered in the "Group" dropdown.
  groups: Group[];
  // newGroupName is set when the user chose "+ New group…"; the caller creates
  // the group (its settings taken from this destination) and assigns it.
  onSave: (d: Destination, newGroupName?: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

// Sentinel <option> value for "create a brand-new group".
const NEW_GROUP = '__new__';

// Edit popup for a standalone destination, or for adding a new one. A
// destination can optionally join a group: an existing one (settings inherited)
// or a new one defined here. Grouped destinations are otherwise managed through
// the group editor.
export function openDestinationPopup(
  map: maplibregl.Map,
  init: PopupInit,
): maplibregl.Popup {
  const root = document.createElement('div');
  root.className = 'popup-form';

  const existing = init.existing;
  // Preselect the type whose emoji matches the existing destination; default
  // to "Other" for new destinations or an unrecognized emoji.
  const initialType =
    DESTINATION_TYPES.find((t) => t.emoji === existing?.emoji) ??
    DESTINATION_TYPES[DESTINATION_TYPES.length - 1];

  root.innerHTML = `
    <div class="field">
      <label>Name</label>
      <input type="text" data-field="name" placeholder="e.g. Office, Yoga studio" value="${escapeHtml(existing?.name ?? '')}" />
    </div>
    <div class="field">
      <label>Group (optional)</label>
      <select data-field="group">
        <option value="">None — a place of its own</option>
        ${init.groups
          .map(
            (g) =>
              `<option value="${g.id}" ${existing?.groupId === g.id ? 'selected' : ''}>${g.emoji} ${escapeHtml(g.name)}</option>`,
          )
          .join('')}
        <option value="${NEW_GROUP}">+ New group…</option>
      </select>
    </div>
    <div class="field" data-new-group hidden>
      <label>New group name</label>
      <input type="text" data-field="new-group-name" placeholder="e.g. Dog parks" />
    </div>
    <div data-dest-settings>
      <div class="field">
        <label>Type</label>
        <div class="modes">
          ${DESTINATION_TYPES.map(
            (t) => `
            <label>
              <input type="radio" name="dest-type" value="${t.id}" ${
                t.id === initialType.id ? 'checked' : ''
              } />
              ${t.emoji} ${t.label}
            </label>`,
          ).join('')}
        </div>
      </div>
      <div class="field">
        <label>Visits per week (fractions ok)</label>
        <input type="number" data-field="visits" step="0.1" min="0" value="${existing?.visitsPerWeek ?? 1}" />
      </div>
      <div class="field">
        <label>Possible travel modes</label>
        <div class="modes">
          ${ALL_MODES.map(
            (m) => `
            <label>
              <input type="checkbox" data-mode="${m}" ${
                existing ? (existing.modes.includes(m) ? 'checked' : '') : 'checked'
              } />
              ${MODE_LABEL[m]}
            </label>`,
          ).join('')}
        </div>
      </div>
      <div class="field">
        <label>When do you typically go?</label>
        <div class="peak">
          <label><input type="radio" name="peak" value="peak" ${
            (existing?.peak ?? 'peak') === 'peak' ? 'checked' : ''
          } /> Peak</label>
          <label><input type="radio" name="peak" value="offpeak" ${
            (existing?.peak ?? 'peak') === 'offpeak' ? 'checked' : ''
          } /> Off-peak</label>
        </div>
      </div>
    </div>
    <div class="actions">
      ${init.onDelete ? '<button type="button" class="danger-btn" data-action="delete" title="Delete this destination">🗑</button>' : ''}
      <div class="actions-right">
        <button type="button" data-action="cancel">Cancel</button>
        <button type="button" class="primary" data-action="save">Save</button>
      </div>
    </div>
  `;

  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    maxWidth: 'none',
  })
    .setLngLat([init.lng, init.lat])
    .setDOMContent(root)
    .addTo(map);

  const nameInput = root.querySelector<HTMLInputElement>('[data-field="name"]')!;
  const visitsInput = root.querySelector<HTMLInputElement>('[data-field="visits"]')!;
  const groupSelect = root.querySelector<HTMLSelectElement>('[data-field="group"]')!;
  const newGroupField = root.querySelector<HTMLElement>('[data-new-group]')!;
  const newGroupInput = root.querySelector<HTMLInputElement>('[data-field="new-group-name"]')!;
  const destSettings = root.querySelector<HTMLElement>('[data-dest-settings]')!;

  // Joining an existing group inherits all of that group's travel settings, so
  // the per-destination fields only matter for a standalone place or a new
  // group being defined here.
  function syncGroupFields() {
    const v = groupSelect.value;
    destSettings.hidden = v !== '' && v !== NEW_GROUP;
    newGroupField.hidden = v !== NEW_GROUP;
  }
  groupSelect.addEventListener('change', syncGroupFields);
  syncGroupFields();

  root.querySelector('[data-action="cancel"]')!.addEventListener('click', () => {
    popup.remove();
    init.onCancel();
  });

  const deleteBtn = root.querySelector('[data-action="delete"]');
  if (deleteBtn && init.onDelete) {
    deleteBtn.addEventListener('click', () => {
      popup.remove();
      init.onDelete!();
    });
  }

  root.querySelector('[data-action="save"]')!.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      alert('Please enter a name for this destination.');
      return;
    }

    const groupVal = groupSelect.value;
    const existingGroup =
      groupVal && groupVal !== NEW_GROUP
        ? init.groups.find((g) => g.id === groupVal)
        : undefined;

    let newGroupName: string | undefined;
    if (groupVal === NEW_GROUP) {
      newGroupName = newGroupInput.value.trim();
      if (!newGroupName) {
        alert('Please name the new group.');
        return;
      }
    }

    let visits: number;
    let modes: TravelMode[];
    let peak: PeakPeriod;
    let emoji: string;

    if (existingGroup) {
      // Travel settings + marker emoji are inherited from the joined group.
      visits = existingGroup.visitsPerWeek;
      modes = existingGroup.modes;
      peak = existingGroup.peak;
      emoji = existingGroup.emoji;
    } else {
      // Standalone, or the defining settings for a brand-new group.
      visits = parseFloat(visitsInput.value);
      modes = ALL_MODES.filter(
        (m) => (root.querySelector(`[data-mode="${m}"]`) as HTMLInputElement).checked,
      ) as TravelMode[];
      const peakInput = root.querySelector('input[name="peak"]:checked') as HTMLInputElement;
      peak = (peakInput?.value ?? 'peak') as PeakPeriod;
      const typeInput = root.querySelector('input[name="dest-type"]:checked') as HTMLInputElement;
      const type =
        DESTINATION_TYPES.find((t) => t.id === typeInput?.value) ??
        DESTINATION_TYPES[DESTINATION_TYPES.length - 1];
      emoji = type.emoji;

      if (!Number.isFinite(visits) || visits <= 0) {
        alert('Visits per week must be a positive number.');
        return;
      }
      if (modes.length === 0) {
        alert('Pick at least one travel mode.');
        return;
      }
    }

    const d: Destination = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      lng: init.lng,
      lat: init.lat,
      visitsPerWeek: visits,
      modes,
      peak,
      // For a new group the caller fills in groupId after creating the group.
      groupId: existingGroup ? existingGroup.id : null,
      emoji,
      // snappedH3 / snappedLng / snappedLat are filled in by the caller (main.ts).
      snappedH3: existing?.snappedH3,
      snappedLng: existing?.snappedLng,
      snappedLat: existing?.snappedLat,
    };
    popup.remove();
    init.onSave(d, newGroupName);
  });

  return popup;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
