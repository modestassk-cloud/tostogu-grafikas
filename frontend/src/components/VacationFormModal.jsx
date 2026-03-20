import { useEffect, useMemo, useState } from 'react';
import { ENTRY_TYPES, ENTRY_TYPE_OPTIONS } from '../entryTypes';

function findEmployeeByInitialValues(employees, initialValues) {
  const requestedEmployeeId = String(initialValues?.employeeId || '').trim();
  if (requestedEmployeeId) {
    return employees.find((employee) => employee.id === requestedEmployeeId) || null;
  }

  const requestedEmployeeName = String(initialValues?.employeeName || '')
    .trim()
    .toLowerCase();
  if (!requestedEmployeeName) {
    return null;
  }

  return (
    employees.find((employee) => employee.fullName.trim().toLowerCase() === requestedEmployeeName) || null
  );
}

function VacationFormModal({ isOpen, onClose, onSubmit, submitting, initialValues, employees = [] }) {
  const today = new Date().toISOString().slice(0, 10);
  const allowedEntryTypes = new Set(ENTRY_TYPE_OPTIONS.map((option) => option.value));
  const normalizedInitialValues = useMemo(
    () => {
      const matchedEmployee = findEmployeeByInitialValues(employees, initialValues);
      return {
        entryType: allowedEntryTypes.has(initialValues?.entryType)
          ? initialValues.entryType
          : ENTRY_TYPES.VACATION,
        employeeId: matchedEmployee?.id || '',
        startDate: initialValues?.startDate || today,
        endDate: initialValues?.endDate || initialValues?.startDate || today,
      };
    },
    [allowedEntryTypes, employees, initialValues, today],
  );
  const [entryType, setEntryType] = useState(ENTRY_TYPES.VACATION);
  const [employeeId, setEmployeeId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setError('');
      return;
    }

    setEntryType(normalizedInitialValues.entryType);
    setEmployeeId(normalizedInitialValues.employeeId);
    setStartDate(normalizedInitialValues.startDate);
    setEndDate(normalizedInitialValues.endDate);
    setError('');
  }, [isOpen, normalizedInitialValues]);

  if (!isOpen) return null;

  const submit = async (event) => {
    event.preventDefault();

    if (!employees.length) {
      setError('Šiame padalinyje dar nėra darbuotojų sąrašo.');
      return;
    }

    const selectedEmployee = employees.find((employee) => employee.id === employeeId) || null;
    if (!selectedEmployee) {
      setError('Pasirinkite darbuotoją iš sąrašo.');
      return;
    }

    if (startDate > endDate) {
      setError('Pradžios data negali būti vėlesnė už pabaigos datą.');
      return;
    }

    setError('');
    await onSubmit({
      entryType,
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.fullName,
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
            Darbuotojas
            <select
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              autoFocus
              required
            >
              <option value="">Pasirinkite darbuotoją</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName}
                </option>
              ))}
            </select>
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

          {!employees.length ? (
            <p className="panel-note">
              Šiame padalinyje dar nėra aktyvių darbuotojų kortelių iš Valdymo centro.
            </p>
          ) : null}

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
