const DEFAULT_STATUS_LABEL = {
  pending: 'Laukia patvirtinimo',
  approved: 'Patvirtinta',
  rejected: 'Atmesta',
};
const SIGNED_REQUEST_DEADLINE_DAYS = 14;

function getTodayIsoLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseIsoDateLocal(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function differenceInCalendarDays(fromIso, toIso) {
  const fromDate = parseIsoDateLocal(fromIso);
  const toDate = parseIsoDateLocal(toIso);
  const ms = toDate.getTime() - fromDate.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function needsSignedRequest(vacation) {
  return vacation?.status === 'approved';
}

function hasSignedRequest(vacation) {
  return Boolean(vacation?.signedRequestReceived);
}

function isWithinSignedRequestWindow(vacation) {
  if (!needsSignedRequest(vacation)) {
    return false;
  }

  const todayIso = getTodayIsoLocal();
  const daysUntilStart = differenceInCalendarDays(todayIso, vacation.startDate);
  return daysUntilStart <= SIGNED_REQUEST_DEADLINE_DAYS;
}

function isBlockedByMissingRequest(vacation) {
  if (!needsSignedRequest(vacation) || hasSignedRequest(vacation)) {
    return false;
  }

  const todayIso = getTodayIsoLocal();
  return vacation.startDate <= todayIso;
}

function isMissingRequestSoon(vacation) {
  return (
    needsSignedRequest(vacation) &&
    !hasSignedRequest(vacation) &&
    isWithinSignedRequestWindow(vacation) &&
    !isBlockedByMissingRequest(vacation)
  );
}

function isOnLeaveToday(vacation) {
  if (!vacation || vacation.status !== 'approved' || !hasSignedRequest(vacation)) {
    return false;
  }

  const todayIso = getTodayIsoLocal();
  return vacation.startDate <= todayIso && vacation.endDate >= todayIso;
}

export function getVacationStatusView(vacation) {
  if (!vacation || !vacation.status) {
    return { key: 'unknown', label: '' };
  }

  if (isBlockedByMissingRequest(vacation)) {
    return {
      key: 'blocked-no-request',
      label: 'Negali atostogauti (negautas pasirašytas prašymas)',
    };
  }

  if (isMissingRequestSoon(vacation)) {
    return {
      key: 'missing-request',
      label: 'Trūksta pasirašyto prašymo (iki atostogų ≤ 14 d.)',
    };
  }

  if (isOnLeaveToday(vacation)) {
    return { key: 'on-leave', label: 'Atostogauja' };
  }

  return {
    key: vacation.status,
    label: DEFAULT_STATUS_LABEL[vacation.status] || vacation.status,
  };
}

export function getVacationStatusLabel(vacation) {
  return getVacationStatusView(vacation).label;
}

export function getSignedRequestAlert(vacation) {
  if (!needsSignedRequest(vacation) || hasSignedRequest(vacation)) {
    return null;
  }

  const todayIso = getTodayIsoLocal();
  const daysUntilStart = differenceInCalendarDays(todayIso, vacation.startDate);

  if (daysUntilStart > SIGNED_REQUEST_DEADLINE_DAYS) {
    return null;
  }

  if (daysUntilStart <= 0) {
    return {
      key: 'blocked-no-request',
      label: 'Atostogos prasidėjusios arba prasideda šiandien, bet pasirašytas prašymas negautas.',
      daysUntilStart,
    };
  }

  return {
    key: 'missing-request',
    label: `Iki atostogų liko ${daysUntilStart} d., bet pasirašytas prašymas negautas.`,
    daysUntilStart,
  };
}
