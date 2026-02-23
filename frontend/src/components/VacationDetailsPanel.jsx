import { useEffect, useMemo, useState } from 'react';
import { formatHumanDate } from '../utilsDate';
import { getSignedRequestAlert, getVacationStatusView } from '../vacationStatus';

function VacationDetailsPanel({
  vacation,
  allVacations,
  isManager,
  canEditSignedRequest = false,
  loading,
  onClose,
  onSelectVacation,
  onApprove,
  onReject,
  onSave,
}) {
  const [employeeName, setEmployeeName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [signedRequestReceived, setSignedRequestReceived] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!vacation) {
      setEmployeeName('');
      setStartDate('');
      setEndDate('');
      setSignedRequestReceived(false);
      setError('');
      return;
    }

    setEmployeeName(vacation.employeeName);
    setStartDate(vacation.startDate);
    setEndDate(vacation.endDate);
    setSignedRequestReceived(Boolean(vacation.signedRequestReceived));
    setError('');
  }, [vacation]);

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

  if (!vacation) {
    return (
      <aside className="details-panel">
        <h3>Atostogų informacija</h3>
        <p className="panel-note">Visos patvirtintos ir laukiančios atostogos:</p>
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
          <p className="panel-note">Šiuo metu nėra patvirtintų ar laukiančių atostogų įrašų.</p>
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

    const cleanName = employeeName.trim().replace(/\s{2,}/g, ' ');
    if (!cleanName) {
      setError('Vardas ir pavardė negali būti tuščias.');
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
    const updates = {
      employeeName: cleanName,
      startDate,
      endDate,
    };

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

  return (
    <aside className="details-panel">
      <header>
        <h3>Atostogų informacija</h3>
      </header>

      <div className={`status-chip status-${selectedStatusView.key}`}>
        {selectedStatusView.label}
      </div>
      {selectedRequestAlert ? (
        <p className={`request-alert ${selectedRequestAlert.key}`}>{selectedRequestAlert.label}</p>
      ) : null}

      <form className="form-grid tight" onSubmit={submit}>
        <label>
          Vardas ir Pavardė
          <input
            type="text"
            value={employeeName}
            onChange={(event) => setEmployeeName(event.target.value)}
            disabled={!isManager || loading}
          />
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

        {isManager ? (
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

        {error ? <p className="form-error">{error}</p> : null}

        {isManager ? (
          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? 'Saugoma...' : 'Išsaugoti pakeitimus'}
          </button>
        ) : null}
      </form>

      {isManager ? (
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

      <button type="button" className="ghost-btn" onClick={onClose}>
        Uždaryti
      </button>
    </aside>
  );
}

export default VacationDetailsPanel;
