import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const PREFERENCE_OPTIONS = [
  ['stepFree', 'Keine Treppen, nur Aufzug oder ebenerdig'],
  ['rollator', 'Ich fahre mit Rollator'],
  ['preferSeat', 'Lieber sitzen als schnell sein'],
  ['fewTransfers', 'Möglichst wenig umsteigen'],
  ['extraTransferTime', 'Mehr Zeit beim Umsteigen'],
  ['readAloud', 'Ansagen automatisch vorlesen'],
];

const STORAGE_KEY = 'gutankommenPreferences';

export function readPreferences() {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

export default function PreferencesPanel() {
  const [mount, setMount] = useState(null);
  const [values, setValues] = useState({});

  useEffect(() => {
    setMount(document.getElementById('preferences-root'));
    setValues(readPreferences());
  }, []);

  function change(key, checked) {
    const next = { ...values, [key]: checked };
    setValues(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('preferences:change', { detail: next }));
  }

  if (!mount) return null;
  return createPortal(<div className="preferences-panel">
    <p className="preferences-intro">Wählen Sie aus, was Ihnen bei der Fahrt hilft. Die Auswahl bleibt auf diesem Gerät gespeichert.</p>
    <div className="preferences-list">
      {PREFERENCE_OPTIONS.map(([key, label]) => <label className="preference-option" key={key}>
        <input type="checkbox" checked={Boolean(values[key])} onChange={(event) => change(key, event.target.checked)} />
        <span>{label}</span>
      </label>)}
    </div>
    <p className="preferences-note">Aufzüge und Barrierefreiheit sind in den Fahrplandaten nur teilweise dokumentiert. Die Suche kennzeichnet fehlende Angaben; sie kann einen barrierefreien Weg noch nicht garantieren.</p>
  </div>, mount);
}
