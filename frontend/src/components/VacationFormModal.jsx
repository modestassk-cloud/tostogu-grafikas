import { useEffect, useState } from 'react';

function VacationFormModal({ isOpen, onClose, onSubmit, submitting }) {
  const today = new Date().toISOString().slice(0, 10);
  const [employeeName, setEmployeeName] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setError('');
      return;
    }

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
      employeeName: cleanedName,
      startDate,
      endDate,
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pridėti atostogas">
      <div className="modal-card">
        <header className="modal-header">
          <h3>Pridėti atostogas</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Uždaryti">
            ×
          </button>
        </header>

        <form className="form-grid" onSubmit={submit}>
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
              {submitting ? 'Siunčiama...' : 'Pateikti prašymą'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export default VacationFormModal;
