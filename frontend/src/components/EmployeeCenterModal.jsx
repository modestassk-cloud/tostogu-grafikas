import { useEffect, useMemo, useState } from 'react';

function sanitizeFullName(value) {
  return String(value || '').trim().replace(/\s{2,}/g, ' ');
}

function buildDraftNames(employees) {
  return Object.fromEntries(
    (employees || []).map((employee) => [employee.id, employee.fullName]),
  );
}

function EmployeeCenterModal({
  isOpen,
  onClose,
  departmentLabel,
  employees = [],
  loading,
  onCreateEmployee,
  onUpdateEmployee,
}) {
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [draftNames, setDraftNames] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setNewEmployeeName('');
      setDraftNames({});
      setError('');
      return;
    }

    setDraftNames(buildDraftNames(employees));
    setError('');
  }, [employees, isOpen]);

  const sortedEmployees = useMemo(
    () =>
      [...employees].sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) || a.fullName.localeCompare(b.fullName, 'lt'),
      ),
    [employees],
  );

  if (!isOpen) {
    return null;
  }

  const handleCreate = async (event) => {
    event.preventDefault();
    const fullName = sanitizeFullName(newEmployeeName);
    if (!fullName) {
      setError('Įrašykite darbuotojo vardą ir pavardę.');
      return;
    }

    setError('');
    try {
      await onCreateEmployee(fullName);
      setNewEmployeeName('');
    } catch (submitError) {
      setError(submitError.message);
    }
  };

  const handleSaveEmployee = async (employeeId) => {
    const fullName = sanitizeFullName(draftNames[employeeId]);
    if (!fullName) {
      setError('Darbuotojo vardas ir pavardė negali būti tušti.');
      return;
    }

    setError('');
    try {
      await onUpdateEmployee(employeeId, { fullName });
    } catch (submitError) {
      setError(submitError.message);
    }
  };

  const handleToggleEmployee = async (employee) => {
    setError('');
    try {
      await onUpdateEmployee(employee.id, { isActive: !employee.isActive });
    } catch (submitError) {
      setError(submitError.message);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Darbuotojų centras">
      <div className="modal-card employee-center-modal">
        <header className="modal-header">
          <div>
            <h3>Darbuotojų centras</h3>
            <p className="panel-note">{departmentLabel} padalinio darbuotojų kortelės.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Uždaryti">
            ×
          </button>
        </header>

        <form className="employee-create-form" onSubmit={handleCreate}>
          <label>
            Naujas darbuotojas
            <input
              type="text"
              value={newEmployeeName}
              onChange={(event) => setNewEmployeeName(event.target.value)}
              placeholder="Pvz., Vardenis Pavardenis"
              disabled={loading}
            />
          </label>
          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? 'Saugoma...' : 'Pridėti darbuotoją'}
          </button>
        </form>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="employee-card-grid">
          {sortedEmployees.length ? (
            sortedEmployees.map((employee) => (
              <article
                key={employee.id}
                className={`employee-card ${employee.isActive ? 'active' : 'inactive'}`}
              >
                <div className="employee-card-top">
                  <span className={`status-chip ${employee.isActive ? 'status-approved' : 'status-rejected'}`}>
                    {employee.isActive ? 'Aktyvus' : 'Archyvuotas'}
                  </span>
                  <span className="employee-card-meta">{employee.recordsCount} įraš.</span>
                </div>

                <label>
                  Darbuotojo vardas
                  <input
                    type="text"
                    value={draftNames[employee.id] || ''}
                    onChange={(event) =>
                      setDraftNames((current) => ({
                        ...current,
                        [employee.id]: event.target.value,
                      }))
                    }
                    disabled={loading}
                  />
                </label>

                <div className="employee-card-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => handleSaveEmployee(employee.id)}
                    disabled={loading}
                  >
                    Pervadinti
                  </button>
                  <button
                    type="button"
                    className={employee.isActive ? 'reject-btn' : 'approve-btn'}
                    onClick={() => handleToggleEmployee(employee)}
                    disabled={loading}
                  >
                    {employee.isActive ? 'Archyvuoti' : 'Atkurti'}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="employee-empty-state">
              <h4>Darbuotojų dar nėra</h4>
              <p className="panel-note">
                Pridėkite pirmą darbuotoją, kad atostogų ir ligų įrašai būtų pildomi iš vieningo
                sąrašo.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EmployeeCenterModal;
