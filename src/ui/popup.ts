import maplibregl from 'maplibre-gl';
import {
  ALL_MODES,
  MODE_LABEL,
  type Destination,
  type PeakPeriod,
  type TravelMode,
} from '../state/types';

interface PopupInit {
  lng: number;
  lat: number;
  existing?: Destination;
  onSave: (d: Destination) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

// Edit popup for a standalone (non-chain) destination. Chained destinations
// are managed through the chain editor instead — their settings are chain-level.
export function openDestinationPopup(
  map: maplibregl.Map,
  init: PopupInit,
): maplibregl.Popup {
  const root = document.createElement('div');
  root.className = 'popup-form';

  const existing = init.existing;

  root.innerHTML = `
    <div class="field">
      <label>Name</label>
      <input type="text" data-field="name" placeholder="e.g. Office, Yoga studio" value="${escapeHtml(existing?.name ?? '')}" />
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
    const visits = parseFloat(visitsInput.value);
    const modes = ALL_MODES.filter(
      (m) => (root.querySelector(`[data-mode="${m}"]`) as HTMLInputElement).checked,
    ) as TravelMode[];
    const peakInput = root.querySelector('input[name="peak"]:checked') as HTMLInputElement;
    const peak = (peakInput?.value ?? 'peak') as PeakPeriod;

    if (!name) {
      alert('Please enter a name for this destination.');
      return;
    }
    if (!Number.isFinite(visits) || visits <= 0) {
      alert('Visits per week must be a positive number.');
      return;
    }
    if (modes.length === 0) {
      alert('Pick at least one travel mode.');
      return;
    }

    const d: Destination = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      lng: init.lng,
      lat: init.lat,
      visitsPerWeek: visits,
      modes,
      peak,
      chainId: null,
      // snappedH3 / snappedLng / snappedLat are filled in by the caller (main.ts).
      snappedH3: existing?.snappedH3,
      snappedLng: existing?.snappedLng,
      snappedLat: existing?.snappedLat,
    };
    popup.remove();
    init.onSave(d);
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
