import { useEffect, useState } from 'react';
import { ENTRY_TYPES, ENTRY_TYPE_OPTIONS } from '../entryTypes';

function VacationFormModal({ isOpen, onClose, onSubmit, submitting }) {
  const today = new Date().toISOString().slice(0, 10);
  const [entryType, setEntryType] = useState(ENTRY_TYPES.VACATION);
  const [employeeName, setEmployeeName] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setError('');
      return;
    }

    setEntryType(ENTRY_TYPES.VACATION);
    setEmployeeName('');
    setStartDate(today);
    setEndDate(today);
    setError('');
  }, [isOpen, today]);

  if (!isOpen) return null;

  const submit = async (event) => {
    event.preventDefault();

    const cleanedName = employeeName.trim().replace(/\s{2,}/g, ' ');
    if (!cleanedName) {
      setError('Įveskite vardą ir pavardę.');
      return;
    }

    if (startDate > endDate) {
      setError('Pradžios data negali būti vėlesnė už pabaigos datą.');
      return;
    }

    setError('');
    await onSubmit({
      entryType,
      employeeName: cleanedName,
      startDate,
      endDate,
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pridėti įrašą">
      <div className="modal-card">
        <header className="modal-header">
          <h3>Pridėti įrašą</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Uždaryti">
            ×
          </button>
        </header>

        <form className="form-grid" onSubmit={submit}>
          <label>
            Įrašo tipas
            <select value={entryType} onChange={(event) => setEntryType(event.target.value)}>
              {ENTRY_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Vardas ir Pavardė
            <input
              type="text"
              value={employeeName}
              onChange={(event) => setEmployeeName(event.target.value)}
              placeholder="Pvz., Jonė Jonaitė"
              autoFocus
              required
            />
          </label>

          <label>
            Pradžios data
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </label>

          <label>
            Pabaigos data
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              required
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <footer className="modal-footer">
            <button type="button" className="ghost-btn" onClick={onClose} disabled={submitting}>
              Atšaukti
            </button>
            <button type="submit" className="primary-btn" disabled={submitting}>
              {submitting
                ? 'Siunčiama...'
                : entryType === ENTRY_TYPES.ILLNESS
                  ? 'Išsaugoti ligą'
                  : 'Pateikti prašymą'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export default VacationFormModal;
