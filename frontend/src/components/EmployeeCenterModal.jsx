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
  const cardEmployees = useMemo(
    () => sortedEmployees.filter((employee) => employee.source !== 'imported'),
    [sortedEmployees],
  );
  const importedEmployees = useMemo(
    () => sortedEmployees.filter((employee) => employee.source === 'imported'),
    [sortedEmployees],
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

  const handlePromoteImportedEmployee = async (employee) => {
    setError('');
    try {
      await onUpdateEmployee(employee.id, { source: 'manual', isActive: true });
    } catch (submitError) {
      setError(submitError.message);
    }
  };

  const renderEmployeeCard = (employee, { imported = false } = {}) => (
    <article
      key={employee.id}
      className={`employee-card ${employee.isActive ? 'active' : 'inactive'} ${imported ? 'imported' : ''}`}
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
        {imported ? (
          <button
            type="button"
            className="approve-btn"
            onClick={() => handlePromoteImportedEmployee(employee)}
            disabled={loading}
          >
            Paversti kortele
          </button>
        ) : null}
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
  );

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

        <section className="employee-section">
          <header className="employee-section-header">
            <h4>Darbuotojų kortelės</h4>
            <p className="panel-note">
              Tik šis sąrašas rodomas atostogų, tėvadienių ir ligų formoje.
            </p>
          </header>
          <div className="employee-card-grid">
            {cardEmployees.length ? (
              cardEmployees.map((employee) => renderEmployeeCard(employee))
            ) : (
              <div className="employee-empty-state">
                <h4>Kortelių dar nėra</h4>
                <p className="panel-note">
                  Pridėkite pirmą darbuotojo kortelę arba paverskite importuotą vardą kortele.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="employee-section">
          <header className="employee-section-header">
            <h4>Importuoti seni vardai</h4>
            <p className="panel-note">
              Šie vardai atėjo iš istorinių įrašų. Jie formoje nerodomi, kol jų nepaversite
              darbuotojų kortelėmis.
            </p>
          </header>
          <div className="employee-card-grid">
            {importedEmployees.length ? (
              importedEmployees.map((employee) => renderEmployeeCard(employee, { imported: true }))
            ) : (
            <div className="employee-empty-state">
              <h4>Importuotų vardų nėra</h4>
              <p className="panel-note">
                Visi rodomi darbuotojai jau yra tvarkingos kortelės.
              </p>
            </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default EmployeeCenterModal;
