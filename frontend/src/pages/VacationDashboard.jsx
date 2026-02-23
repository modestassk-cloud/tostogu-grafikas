import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  approveVacation,
  createVacationRequest,
  fetchVacations,
  patchVacationAsManager,
  rejectVacation,
  validateManagerSession,
} from '../api';
import { DEPARTMENTS, DEPARTMENT_OPTIONS, getDepartmentLabel, isValidDepartment } from '../departments';
import GanttChart from '../components/GanttChart';
import VacationDetailsPanel from '../components/VacationDetailsPanel';
import VacationFormModal from '../components/VacationFormModal';
import logo from '../assets/eigida-logo.svg';
import { shiftAnchorDate, shiftIsoDate } from '../utilsDate';

function utcMonthAnchorNow() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function VacationDashboard({ isManager }) {
  const { token = '', department: managerDepartmentParam = '' } = useParams();
  const managerToken = isManager ? token : '';
  const managerDepartment = String(managerDepartmentParam || '').trim().toLowerCase();
  const managerDepartmentValid = !isManager || isValidDepartment(managerDepartment);

  const [selectedDepartment, setSelectedDepartment] = useState(() =>
    isManager && isValidDepartment(managerDepartment)
      ? managerDepartment
      : DEPARTMENTS.PRODUCTION,
  );
  const [managerAccess, setManagerAccess] = useState({
    managerRole: isManager ? 'department-manager' : 'employee',
    canManageAllDepartments: false,
    canEditSignedRequest: false,
  });
  const managerCanManageAllDepartments = isManager && managerAccess.canManageAllDepartments;
  const activeDepartment = isManager
    ? managerCanManageAllDepartments
      ? selectedDepartment
      : managerDepartment
    : selectedDepartment;

  const [sessionValidated, setSessionValidated] = useState(!isManager);
  const [loadingSession, setLoadingSession] = useState(isManager);
  const [loadingData, setLoadingData] = useState(true);
  const [savingAction, setSavingAction] = useState(false);

  const [vacations, setVacations] = useState([]);
  const [selectedVacationId, setSelectedVacationId] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [viewMode, setViewMode] = useState('month');
  const [anchorDate, setAnchorDate] = useState(utcMonthAnchorNow());
  const [showRejected, setShowRejected] = useState(false);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectedVacation = useMemo(
    () => vacations.find((vacation) => vacation.id === selectedVacationId) || null,
    [selectedVacationId, vacations],
  );

  const flashMessage = (text) => {
    setMessage(text);
    setTimeout(() => setMessage(''), 3500);
  };

  const loadVacations = useCallback(async () => {
    if (!isValidDepartment(activeDepartment)) {
      setVacations([]);
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    setError('');

    try {
      const data = await fetchVacations({
        managerToken: isManager ? managerToken : undefined,
        department: activeDepartment,
        includeRejected: isManager && showRejected,
      });

      setVacations(data);
      setSelectedVacationId((currentSelectedId) => {
        if (!currentSelectedId) return null;
        return data.some((vacation) => vacation.id === currentSelectedId) ? currentSelectedId : null;
      });
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoadingData(false);
    }
  }, [activeDepartment, isManager, managerToken, showRejected]);

  useEffect(() => {
    if (!isManager) {
      setSessionValidated(true);
      setLoadingSession(false);
      setManagerAccess({
        managerRole: 'employee',
        canManageAllDepartments: false,
        canEditSignedRequest: false,
      });
      return;
    }

    if (!managerDepartmentValid) {
      setSessionValidated(false);
      setLoadingSession(false);
      setError('Neteisingas vadovo padalinys URL nuorodoje.');
      return;
    }

    let isCancelled = false;

    const validate = async () => {
      setLoadingSession(true);
      try {
        const sessionData = await validateManagerSession({
          managerToken,
          department: managerDepartment,
        });
        if (!isCancelled) {
          setSessionValidated(true);
          setError('');
          setManagerAccess({
            managerRole: sessionData.managerRole || 'department-manager',
            canManageAllDepartments: Boolean(sessionData.canManageAllDepartments),
            canEditSignedRequest: Boolean(sessionData.canEditSignedRequest),
          });
        }
      } catch (validationError) {
        if (!isCancelled) {
          setSessionValidated(false);
          setError(validationError.message);
        }
      } finally {
        if (!isCancelled) {
          setLoadingSession(false);
        }
      }
    };

    validate();

    return () => {
      isCancelled = true;
    };
  }, [isManager, managerDepartment, managerDepartmentValid, managerToken]);

  useEffect(() => {
    if (!isManager || !isValidDepartment(managerDepartment)) {
      return;
    }

    setSelectedDepartment(managerDepartment);
  }, [isManager, managerDepartment]);

  useEffect(() => {
    if (!sessionValidated) {
      return;
    }

    loadVacations();
  }, [loadVacations, sessionValidated]);

  useEffect(() => {
    setSelectedVacationId(null);
  }, [activeDepartment]);

  const handleCreate = async (payload) => {
    if (!isValidDepartment(activeDepartment)) {
      setError('Pirma pasirinkite padalinį.');
      return;
    }

    try {
      setSavingAction(true);
      setError('');
      await createVacationRequest({
        ...payload,
        department: activeDepartment,
      });
      setShowModal(false);
      flashMessage(`Prašymas pateiktas: ${getDepartmentLabel(activeDepartment)} padalinys.`);
      await loadVacations();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSavingAction(false);
    }
  };

  const requireSelection = () => {
    if (!selectedVacation) {
      setError('Pasirinkite atostogų bloką grafike.');
      return false;
    }

    return true;
  };

  const handleApprove = async () => {
    if (!isManager || !requireSelection()) return;

    try {
      setSavingAction(true);
      setError('');
      await approveVacation({ id: selectedVacation.id, managerToken, department: activeDepartment });
      flashMessage('Atostogos patvirtintos.');
      await loadVacations();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setSavingAction(false);
    }
  };

  const handleReject = async () => {
    if (!isManager || !requireSelection()) return;

    try {
      setSavingAction(true);
      setError('');
      await rejectVacation({ id: selectedVacation.id, managerToken, department: activeDepartment });
      flashMessage('Atostogų prašymas atmestas.');
      await loadVacations();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setSavingAction(false);
    }
  };

  const handleSave = async (updates) => {
    if (!isManager || !requireSelection()) return;

    try {
      setSavingAction(true);
      setError('');
      await patchVacationAsManager({
        id: selectedVacation.id,
        managerToken,
        department: activeDepartment,
        updates,
      });
      flashMessage('Pakeitimai išsaugoti.');
      await loadVacations();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setSavingAction(false);
    }
  };

  const handleMoveVacation = async (vacation, deltaDays) => {
    if (!isManager || deltaDays === 0) return;

    try {
      setSavingAction(true);
      setError('');

      await patchVacationAsManager({
        id: vacation.id,
        managerToken,
        department: activeDepartment,
        updates: {
          startDate: shiftIsoDate(vacation.startDate, deltaDays),
          endDate: shiftIsoDate(vacation.endDate, deltaDays),
        },
      });

      setSelectedVacationId(vacation.id);
      flashMessage('Datos pakoreguotos grafike.');
      await loadVacations();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setSavingAction(false);
    }
  };

  if (loadingSession) {
    return <main className="fullscreen-message">Tikrinama vadovo prieiga...</main>;
  }

  if (isManager && (!sessionValidated || !managerDepartmentValid)) {
    return (
      <main className="fullscreen-message">
        <div>
          <h1>Prieiga uždrausta</h1>
          <p>Neteisinga arba nebegaliojanti vadovo nuoroda.</p>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <img src={logo} alt="Eigida" className="logo" />

        <div className="sidebar-title-block">
          <h1>Atostogų planavimo platforma</h1>
          <p>
            Vizualus kalendorius komandoms, kad vadovas vienu žvilgsniu matytų užimtumą ir
            persidengimus.
          </p>
        </div>

        <div className="department-switch">
          <p className="department-label">Padalinys</p>
          <div className="department-grid">
            {DEPARTMENT_OPTIONS.map((departmentOption) => {
              const isActive = activeDepartment === departmentOption.value;
              const canSwitchDepartment = !isManager || managerCanManageAllDepartments;
              const shouldDisable = !canSwitchDepartment && !isActive;

              return (
                <button
                  key={departmentOption.value}
                  type="button"
                  className={`department-btn ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    if (canSwitchDepartment) {
                      setSelectedDepartment(departmentOption.value);
                    }
                  }}
                  disabled={shouldDisable}
                >
                  {departmentOption.label}
                </button>
              );
            })}
          </div>
          {isManager && managerCanManageAllDepartments ? (
            <p className="small-note">
              Administracijos vadovo nuoroda yra pagrindinė ir leidžia valdyti{' '}
              <strong>abu padalinius</strong>.
            </p>
          ) : null}
          {isManager && !managerCanManageAllDepartments ? (
            <p className="small-note">
              Vadovo nuoroda galioja tik <strong>{getDepartmentLabel(activeDepartment)}</strong>{' '}
              padaliniui.
            </p>
          ) : null}
        </div>

        <button type="button" className="primary-btn wide" onClick={() => setShowModal(true)}>
          Pridėti atostogas
        </button>

        <div className="pill-row">
          <span className={`mode-pill ${isManager ? 'manager' : 'employee'}`}>
            {isManager ? 'Vadovo režimas' : 'Darbuotojo režimas'}
          </span>
        </div>

        {isManager ? (
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showRejected}
              onChange={(event) => setShowRejected(event.target.checked)}
            />
            Rodyti atmestus įrašus
          </label>
        ) : (
          <p className="small-note">
            Pateikti prašymai pirmiausia rodomi kaip <strong>laukiantys patvirtinimo</strong>.
          </p>
        )}

        {message ? <p className="success-note">{message}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </aside>

      <main className="main-content">
        {loadingData ? (
          <div className="loading-card">Kraunami atostogų duomenys...</div>
        ) : (
          <GanttChart
            vacations={vacations}
            isManager={isManager}
            selectedVacationId={selectedVacationId}
            viewMode={viewMode}
            anchorDate={anchorDate}
            onViewModeChange={setViewMode}
            onSelectVacation={(vacation) => setSelectedVacationId(vacation.id)}
            onMoveVacation={handleMoveVacation}
            onShiftRange={(direction) =>
              setAnchorDate((prev) => shiftAnchorDate(prev, viewMode, direction))
            }
            onJumpToday={() => setAnchorDate(utcMonthAnchorNow())}
          />
        )}
      </main>

      <VacationDetailsPanel
        vacation={selectedVacation}
        allVacations={vacations}
        isManager={isManager}
        canEditSignedRequest={isManager && managerAccess.canEditSignedRequest}
        loading={savingAction}
        onClose={() => setSelectedVacationId(null)}
        onSelectVacation={setSelectedVacationId}
        onApprove={handleApprove}
        onReject={handleReject}
        onSave={handleSave}
      />

      <VacationFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSubmit={handleCreate}
        submitting={savingAction}
      />
    </div>
  );
}

export default VacationDashboard;
