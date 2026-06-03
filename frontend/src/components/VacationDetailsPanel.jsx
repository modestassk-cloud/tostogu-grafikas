import { useEffect, useMemo, useState } from 'react';
import {
  getEntryTypeLabel,
  isIllnessEntry,
  isParentDayEntry,
  isVacationEntry,
} from '../entryTypes';
import { formatHumanDate, formatHumanDateTime } from '../utilsDate';
import { getSignedRequestAlert, getVacationStatusView } from '../vacationStatus';

function VacationDetailsPanel({
  vacation,
  allVacations,
  employees = [],
  isManager,
  canEditSignedRequest = false,
  loading,
  onClose,
  onSelectVacation,
  onApprove,
  onReject,
  onSave,
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [signedRequestReceived, setSignedRequestReceived] = useState(false);
  const [error, setError] = useState('');
  const [pdfMessage, setPdfMessage] = useState('');
  const [generatingPdf, setGeneratingPdf] = useState(false);

  useEffect(() => {
    if (!vacation) {
      setEmployeeId('');
      setStartDate('');
      setEndDate('');
      setSignedRequestReceived(false);
      setError('');
      setPdfMessage('');
      setGeneratingPdf(false);
      return;
    }

    const matchedEmployee =
      employees.find((employee) => employee.id === vacation.employeeId) ||
      employees.find(
        (employee) =>
          employee.fullName.trim().toLowerCase() === vacation.employeeName.trim().toLowerCase(),
      ) ||
      null;

    setEmployeeId(matchedEmployee?.id || vacation.employeeId || '');
    setStartDate(vacation.startDate);
    setEndDate(vacation.endDate);
    setSignedRequestReceived(Boolean(vacation.signedRequestReceived));
    setError('');
    setPdfMessage('');
    setGeneratingPdf(false);
  }, [employees, vacation]);

  const vacationList = useMemo(
    () =>
      (allVacations || [])
        .filter((item) => item.status !== 'rejected')
        .sort(
          (a, b) =>
            a.startDate.localeCompare(b.startDate) ||
            a.employeeName.localeCompare(b.employeeName, 'lt'),
        ),
    [allVacations],
  );
  const signedRequestAlerts = useMemo(
    () =>
      vacationList
        .map((item) => ({ item, alert: getSignedRequestAlert(item) }))
        .filter((entry) => Boolean(entry.alert))
        .sort((a, b) => (a.alert.daysUntilStart ?? 9999) - (b.alert.daysUntilStart ?? 9999)),
    [vacationList],
  );
  const editableEmployees = useMemo(() => {
    if (!vacation?.employeeId) {
      return employees;
    }

    return employees.some((employee) => employee.id === vacation.employeeId)
      ? employees
      : [
          ...employees,
          {
            id: vacation.employeeId,
            fullName: vacation.employeeName,
            isActive: false,
          },
        ];
  }, [employees, vacation]);
  const selectedEmployee = useMemo(() => {
    const matchedEmployee = editableEmployees.find((employee) => employee.id === employeeId);
    if (matchedEmployee) {
      return matchedEmployee;
    }

    if (vacation?.employeeId && employeeId === vacation.employeeId) {
      return {
        id: vacation.employeeId,
        fullName: vacation.employeeName,
        isActive: false,
      };
    }

    return null;
  }, [editableEmployees, employeeId, vacation]);

  if (!vacation) {
    return (
      <aside className="details-panel">
        <h3>Įrašų informacija</h3>
        <p className="panel-note">Visi patvirtinti ir laukiantys įrašai:</p>
        {vacationList.length ? (
          <div className="details-list">
            {vacationList.map((item) => {
              const statusView = getVacationStatusView(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="vacation-list-item"
                  onClick={() => onSelectVacation?.(item.id)}
                >
                  <div className="vacation-list-main">
                    <strong>{item.employeeName}</strong>
                    <span className="entry-type-badge">{getEntryTypeLabel(item)}</span>
                    <span>
                      {formatHumanDate(item.startDate)} – {formatHumanDate(item.endDate)}
                    </span>
                  </div>
                  <span className={`status-chip status-${statusView.key}`}>
                    {statusView.label}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="panel-note">Šiuo metu nėra patvirtintų ar laukiančių įrašų.</p>
        )}

        {canEditSignedRequest && signedRequestAlerts.length ? (
          <div className="alerts-block">
            <h4>Trūksta pasirašytų prašymų (iki 14 d.)</h4>
            <div className="details-list">
              {signedRequestAlerts.map(({ item, alert }) => (
                <button
                  key={`alert-${item.id}`}
                  type="button"
                  className="vacation-list-item warning"
                  onClick={() => onSelectVacation?.(item.id)}
                >
                  <div className="vacation-list-main">
                    <strong>{item.employeeName}</strong>
                    <span className="entry-type-badge">{getEntryTypeLabel(item)}</span>
                    <span>
                      {formatHumanDate(item.startDate)} – {formatHumanDate(item.endDate)}
                    </span>
                    <span className="warning-text">{alert.label}</span>
                  </div>
                  <span className={`status-chip status-${alert.key}`}>Reikia veiksmo</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>
    );
  }

  const submit = async (event) => {
    event.preventDefault();

    if (!isManager) return;

    if (!selectedEmployee) {
      setError('Pasirinkite darbuotoją iš sąrašo.');
      return;
    }

    if (!startDate || !endDate) {
      setError('Pradžios ir pabaigos datos yra privalomos.');
      return;
    }

    if (startDate > endDate) {
      setError('Pradžios data negali būti vėlesnė už pabaigos datą.');
      return;
    }

    setError('');
    const updates = {};

    if (selectedEmployee.id !== vacation.employeeId) {
      updates.employeeId = selectedEmployee.id;
    }
    if (startDate !== vacation.startDate) {
      updates.startDate = startDate;
    }
    if (endDate !== vacation.endDate) {
      updates.endDate = endDate;
    }

    if (
      canEditSignedRequest &&
      signedRequestReceived !== Boolean(vacation.signedRequestReceived)
    ) {
      updates.signedRequestReceived = signedRequestReceived;
    }

    await onSave(updates);
  };

  const selectedStatusView = getVacationStatusView(vacation);
  const selectedRequestAlert = getSignedRequestAlert(vacation);
  const isIllness = isIllnessEntry(vacation);
  const isVacation = isVacationEntry(vacation);
  const hasRequestPdf = isVacation || isParentDayEntry(vacation);

  const generateRequestPdf = async () => {
    if (!hasRequestPdf) {
      return;
    }

    const employeeForPdf = selectedEmployee || {
      fullName: vacation.employeeName,
      position: '',
    };

    try {
      setGeneratingPdf(true);
      setPdfMessage('');
      setError('');
      const { generateVacationRequestPdf } = await import('../vacationRequestPdf');
      await generateVacationRequestPdf({
        entryType: vacation.entryType,
        employeeName: employeeForPdf.fullName || vacation.employeeName,
        employeePosition:
          employeeForPdf.position || employeeForPdf.jobTitle || employeeForPdf.role || '',
        startDate: startDate || vacation.startDate,
        endDate: endDate || vacation.endDate,
        submittedAt: vacation.createdAt || new Date(),
      });
      setPdfMessage('Prašymo PDF parsiųstas.');
    } catch (pdfError) {
      console.error('Nepavyko sugeneruoti prašymo PDF:', pdfError);
      setError('Nepavyko sugeneruoti prašymo PDF.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const lastSignedRequestLabel = vacation.signedRequestReceived ? 'Gautas' : 'Nenurodytas';
  const lastSignedRequestTimestamp = formatHumanDateTime(
    vacation.signedRequestReceivedAt || vacation.updatedAt,
  );

  return (
    <aside className="details-panel">
      <header>
        <h3>Įrašo informacija</h3>
      </header>

      <div className={`status-chip status-${selectedStatusView.key}`}>
        {selectedStatusView.label}
      </div>
      <p className="panel-note">
        Tipas: <strong>{getEntryTypeLabel(vacation)}</strong>
      </p>
      {selectedRequestAlert ? (
        <p className={`request-alert ${selectedRequestAlert.key}`}>{selectedRequestAlert.label}</p>
      ) : null}

      <form className="form-grid tight" onSubmit={submit}>
        <label>
          Darbuotojas
          <select
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            disabled={!isManager || loading}
          >
            <option value="">Pasirinkite darbuotoją</option>
            {editableEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName}
                {!employee.isActive ? ' (archyvuotas)' : ''}
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
            disabled={!isManager || loading}
          />
        </label>

        <label>
          Pabaigos data
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            disabled={!isManager || loading}
          />
        </label>

        {isManager && isVacation ? (
          <section className={`signed-request-box ${canEditSignedRequest ? 'editable' : 'readonly'}`}>
            <p className="signed-request-title">Pasirašytas prašymas</p>
            {canEditSignedRequest ? (
              <label className="signed-request-toggle">
                <input
                  type="checkbox"
                  checked={signedRequestReceived}
                  onChange={(event) => setSignedRequestReceived(event.target.checked)}
                  disabled={loading}
                />
                <span>Pasirašytas prašymas gautas</span>
              </label>
            ) : (
              <p className="panel-note">
                Žymą apie gautą pasirašytą prašymą gali keisti tik administracijos vadovas.
              </p>
            )}
            <p className="panel-note">
              Paskutinis: <strong>{lastSignedRequestLabel}</strong> ({lastSignedRequestTimestamp})
            </p>
          </section>
        ) : null}

        <p className="panel-note">
          Intervale: <strong>{formatHumanDate(vacation.startDate)}</strong> –{' '}
          <strong>{formatHumanDate(vacation.endDate)}</strong>
        </p>

        {isManager ? (
          <p className="panel-note">
            Patarimas: galite pertempti bloką grafike į kairę/dešinę, kad pakeistumėte datas.
          </p>
        ) : null}

        {isManager && !editableEmployees.length ? (
          <p className="panel-note">
            Šiame padalinyje dar nėra darbuotojų kortelių iš Valdymo centro.
          </p>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        {isManager ? (
          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? 'Saugoma...' : 'Išsaugoti pakeitimus'}
          </button>
        ) : null}
      </form>

      {hasRequestPdf ? (
        <div className="pdf-action-block">
          <button
            type="button"
            className="secondary-btn wide"
            onClick={generateRequestPdf}
            disabled={loading || generatingPdf}
          >
            {generatingPdf ? 'Generuojama...' : 'Atsisiųsti prašymą PDF'}
          </button>
          {pdfMessage ? <p className="success-note compact">{pdfMessage}</p> : null}
        </div>
      ) : null}

      {isManager && !isIllness ? (
        <div className="action-grid">
          <button
            type="button"
            className="approve-btn"
            onClick={() => onApprove()}
            disabled={loading || vacation.status === 'approved'}
          >
            Patvirtinti
          </button>
          <button
            type="button"
            className="reject-btn"
            onClick={() => onReject()}
            disabled={loading || vacation.status === 'rejected'}
          >
            Atmesti
          </button>
        </div>
      ) : null}

      {isManager && isIllness ? (
        <div className="action-grid single-action">
          <button
            type="button"
            className="reject-btn"
            onClick={() => onReject()}
            disabled={loading || vacation.status === 'rejected'}
          >
            Pašalinti įrašą
          </button>
        </div>
      ) : null}

      <button type="button" className="ghost-btn" onClick={onClose}>
        Uždaryti
      </button>
    </aside>
  );
}

export default VacationDetailsPanel;
