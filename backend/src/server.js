require('dotenv').config();

const cors = require('cors');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createEmailNotifierFromEnv } = require('./notifications');
const {
  VACATION_STATUSES,
  DEPARTMENTS,
  dbPath,
  isValidDepartment,
  getOrCreateManagerTokens,
  listVacations,
  createVacation,
  getVacationById,
  updateVacation,
} = require('./db');

const app = express();
const port = Number(process.env.PORT || 8787);

const managerTokens = getOrCreateManagerTokens({
  [DEPARTMENTS.PRODUCTION]:
    process.env.MANAGER_TOKEN_GAMYBA ||
    process.env.MANAGER_TOKEN_PRODUCTION ||
    process.env.MANAGER_TOKEN ||
    '',
  [DEPARTMENTS.ADMINISTRATION]:
    process.env.MANAGER_TOKEN_ADMINISTRACIJA ||
    process.env.MANAGER_TOKEN_ADMINISTRATION ||
    '',
});
const MANAGER_ROLES = Object.freeze({
  DEPARTMENT_MANAGER: 'department-manager',
  ADMIN_SUPER: 'administration-super',
});
const SIGNED_REQUEST_REMINDER_DAYS = 14;
const SIGNED_REQUEST_REMINDER_INTERVAL_MS = Number(
  process.env.SIGNED_REQUEST_REMINDER_INTERVAL_MS || 60 * 60 * 1000,
);

app.use(cors());
app.use(express.json());

function normalizeBaseUrl(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function getDefaultFrontendBaseUrl() {
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction ? `http://localhost:${port}` : 'http://localhost:5173';
}

const frontendBaseUrl = normalizeBaseUrl(process.env.FRONTEND_URL || getDefaultFrontendBaseUrl());
const emailNotifier = createEmailNotifierFromEnv();

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isStartAfterEnd(startDate, endDate) {
  return startDate > endDate;
}

function sanitizeName(input) {
  return String(input || '').trim().replace(/\s{2,}/g, ' ');
}

function normalizeDepartment(rawValue) {
  return String(rawValue || '').trim().toLowerCase();
}

function parseDepartmentOrSendError(res, rawValue) {
  const department = normalizeDepartment(rawValue);

  if (!isValidDepartment(department)) {
    res
      .status(400)
      .json({ error: 'Neteisingas padalinys. Galimi: gamyba, administracija.' });
    return null;
  }

  return department;
}

function getDepartmentLabel(department) {
  return department === DEPARTMENTS.ADMINISTRATION ? 'Administracija' : 'Gamyba';
}

function parseIsoDateUtc(isoDate) {
  const [year, month, day] = String(isoDate || '')
    .split('-')
    .map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function getTodayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}

function differenceInCalendarDaysUtc(fromIso, toIso) {
  const fromDate = parseIsoDateUtc(fromIso);
  const toDate = parseIsoDateUtc(toIso);
  const ms = toDate.getTime() - fromDate.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function buildManagerRequestLink({ department, vacationId }) {
  const base = `${frontendBaseUrl}/manager/${DEPARTMENTS.ADMINISTRATION}/${managerTokens[DEPARTMENTS.ADMINISTRATION]}`;
  const params = new URLSearchParams({
    department,
    vacationId,
  });
  return `${base}?${params.toString()}`;
}

async function notifyAboutNewVacationRequest(vacation) {
  const managerLink = buildManagerRequestLink({
    department: vacation.department,
    vacationId: vacation.id,
  });

  const subject = `Naujas atostogų prašymas: ${vacation.employeeName}`;
  const text = [
    'Sveiki,',
    '',
    `Gautas naujas atostogų prašymas (${getDepartmentLabel(vacation.department)}).`,
    `Darbuotojas: ${vacation.employeeName}`,
    `Laikotarpis: ${vacation.startDate} – ${vacation.endDate}`,
    '',
    'Atidaryti konkretų prašymą:',
    managerLink,
    '',
    'Eigida Atostogų sistema',
  ].join('\n');

  return emailNotifier.sendMail({ subject, text });
}

async function notifyAboutMissingSignedRequest(vacation, daysUntilStart) {
  const managerLink = buildManagerRequestLink({
    department: vacation.department,
    vacationId: vacation.id,
  });

  const subject = `Priminimas: negautas pasirašytas prašymas (${vacation.employeeName})`;
  const text = [
    'Sveiki,',
    '',
    `Iki atostogų liko ${daysUntilStart} d., bet pasirašytas prašymas dar negautas.`,
    `Padalinys: ${getDepartmentLabel(vacation.department)}`,
    `Darbuotojas: ${vacation.employeeName}`,
    `Laikotarpis: ${vacation.startDate} – ${vacation.endDate}`,
    '',
    'Atidaryti konkretų prašymą:',
    managerLink,
    '',
    'Eigida Atostogų sistema',
  ].join('\n');

  return emailNotifier.sendMail({ subject, text });
}

let reminderJobRunning = false;
let reminderJobScheduled = false;

async function runSignedRequestReminderJob() {
  if (reminderJobRunning) {
    return;
  }
  reminderJobRunning = true;

  try {
    const todayIso = getTodayIsoUtc();
    const vacations = listVacations({ includeRejected: true });
    const candidates = vacations.filter((vacation) => {
      if (vacation.status !== VACATION_STATUSES.APPROVED) return false;
      if (vacation.signedRequestReceived) return false;
      if (vacation.signedRequestReminderSentAt) return false;

      const daysUntilStart = differenceInCalendarDaysUtc(todayIso, vacation.startDate);
      return daysUntilStart >= 0 && daysUntilStart <= SIGNED_REQUEST_REMINDER_DAYS;
    });

    for (const vacation of candidates) {
      const daysUntilStart = differenceInCalendarDaysUtc(todayIso, vacation.startDate);
      const result = await notifyAboutMissingSignedRequest(vacation, daysUntilStart);

      if (result?.sent) {
        updateVacation(vacation.id, {
          signedRequestReminderSentAt: new Date().toISOString(),
        });
      }
    }
  } catch (error) {
    console.error('Nepavyko įvykdyti pasirašyto prašymo priminimų job:', error);
  } finally {
    reminderJobRunning = false;
  }
}

function scheduleSignedRequestReminderJobSoon(delayMs = 2500) {
  if (reminderJobScheduled) return;
  reminderJobScheduled = true;

  setTimeout(() => {
    reminderJobScheduled = false;
    runSignedRequestReminderJob();
  }, delayMs);
}

function managerAuth(req, res, next) {
  const department = parseDepartmentOrSendError(res, req.params.department);
  if (!department) {
    return;
  }

  const headerToken = req.get('x-manager-token');
  const queryToken = req.query.token;
  const suppliedToken = (headerToken || queryToken || '').trim();
  const departmentToken = managerTokens[department];
  const administrationToken = managerTokens[DEPARTMENTS.ADMINISTRATION];

  if (!suppliedToken) {
    return res.status(401).json({ error: 'Unauthorized manager access.' });
  }

  let managerRole = null;
  let managerDepartment = department;

  if (suppliedToken === administrationToken) {
    managerRole = MANAGER_ROLES.ADMIN_SUPER;
    managerDepartment = DEPARTMENTS.ADMINISTRATION;
  } else if (suppliedToken === departmentToken) {
    managerRole = MANAGER_ROLES.DEPARTMENT_MANAGER;
  } else {
    return res.status(401).json({ error: 'Unauthorized manager access.' });
  }

  req.department = department;
  req.managerRole = managerRole;
  req.managerDepartment = managerDepartment;
  req.canManageAllDepartments = managerRole === MANAGER_ROLES.ADMIN_SUPER;
  req.canEditSignedRequest = managerRole === MANAGER_ROLES.ADMIN_SUPER;
  next();
}

function ensureVacationInDepartmentOrNotFound(vacation, department, res) {
  if (!vacation || vacation.department !== department) {
    res.status(404).json({ error: 'Atostogų įrašas šiame padalinyje nerastas.' });
    return false;
  }

  return true;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/vacations', (req, res) => {
  const department = parseDepartmentOrSendError(res, req.query.department);
  if (!department) {
    return;
  }

  const vacations = listVacations({ department, includeRejected: false });
  res.json({ vacations });
});

app.post('/api/vacations', (req, res) => {
  const employeeName = sanitizeName(req.body.employeeName);
  const department = parseDepartmentOrSendError(res, req.body.department);
  const startDate = String(req.body.startDate || '');
  const endDate = String(req.body.endDate || '');

  if (!department) {
    return;
  }

  if (!employeeName) {
    return res.status(400).json({ error: 'Privalomas laukas: vardas ir pavardė.' });
  }

  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    return res.status(400).json({ error: 'Neteisingas datos formatas. Naudokite YYYY-MM-DD.' });
  }

  if (isStartAfterEnd(startDate, endDate)) {
    return res.status(400).json({ error: 'Pradžios data negali būti vėlesnė už pabaigos datą.' });
  }

  const created = createVacation({ employeeName, department, startDate, endDate });
  notifyAboutNewVacationRequest(created).catch((error) => {
    console.error('Nepavyko išsiųsti naujo prašymo el. laiško:', error);
  });
  res.status(201).json({ vacation: created });
});

app.get('/api/manager/:department/session', managerAuth, (req, res) => {
  res.json({
    ok: true,
    department: req.department,
    managerDepartment: req.managerDepartment,
    managerRole: req.managerRole,
    canManageAllDepartments: req.canManageAllDepartments,
    canEditSignedRequest: req.canEditSignedRequest,
  });
});

app.get('/api/manager/:department/vacations', managerAuth, (req, res) => {
  const includeRejected = String(req.query.includeRejected || '').toLowerCase() === 'true';
  const vacations = listVacations({ department: req.department, includeRejected });
  res.json({ vacations });
});

app.patch('/api/manager/:department/vacations/:id', managerAuth, (req, res) => {
  const id = req.params.id;
  const existing = getVacationById(id);

  if (!ensureVacationInDepartmentOrNotFound(existing, req.department, res)) {
    return;
  }

  const updates = {};

  if (Object.prototype.hasOwnProperty.call(req.body, 'employeeName')) {
    const employeeName = sanitizeName(req.body.employeeName);
    if (!employeeName) {
      return res.status(400).json({ error: 'Vardas ir pavardė negali būti tuščias.' });
    }
    updates.employeeName = employeeName;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'startDate')) {
    const startDate = String(req.body.startDate || '');
    if (!isValidIsoDate(startDate)) {
      return res.status(400).json({ error: 'Neteisinga pradžios data.' });
    }
    updates.startDate = startDate;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'endDate')) {
    const endDate = String(req.body.endDate || '');
    if (!isValidIsoDate(endDate)) {
      return res.status(400).json({ error: 'Neteisinga pabaigos data.' });
    }
    updates.endDate = endDate;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
    const status = String(req.body.status || '').trim();
    const allowed = new Set(Object.values(VACATION_STATUSES));
    if (!allowed.has(status)) {
      return res.status(400).json({ error: 'Neleistina būsena.' });
    }
    updates.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'signedRequestReceived')) {
    if (!req.canEditSignedRequest) {
      return res.status(403).json({
        error: 'Pasirašyto prašymo žymą gali keisti tik administracijos vadovas.',
      });
    }

    if (typeof req.body.signedRequestReceived !== 'boolean') {
      return res.status(400).json({ error: 'signedRequestReceived turi būti true/false.' });
    }
    updates.signedRequestReceived = req.body.signedRequestReceived;
  }

  const resultingStart = updates.startDate || existing.startDate;
  const resultingEnd = updates.endDate || existing.endDate;

  if (isStartAfterEnd(resultingStart, resultingEnd)) {
    return res.status(400).json({ error: 'Pradžios data negali būti vėlesnė už pabaigos datą.' });
  }

  const updated = updateVacation(id, updates);
  scheduleSignedRequestReminderJobSoon();
  res.json({ vacation: updated });
});

app.post('/api/manager/:department/vacations/:id/approve', managerAuth, (req, res) => {
  const existing = getVacationById(req.params.id);
  if (!ensureVacationInDepartmentOrNotFound(existing, req.department, res)) {
    return;
  }

  const updated = updateVacation(req.params.id, { status: VACATION_STATUSES.APPROVED });
  scheduleSignedRequestReminderJobSoon();
  res.json({ vacation: updated });
});

app.post('/api/manager/:department/vacations/:id/reject', managerAuth, (req, res) => {
  const existing = getVacationById(req.params.id);
  if (!ensureVacationInDepartmentOrNotFound(existing, req.department, res)) {
    return;
  }

  const updated = updateVacation(req.params.id, { status: VACATION_STATUSES.REJECTED });
  res.json({ vacation: updated });
});

const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`API veikia: http://localhost:${port}/api/health`);
  console.log(`DB failas: ${dbPath}`);
  console.log(`Darbuotojų nuoroda: ${frontendBaseUrl}/`);
  console.log(
    `Pagrindinė vadovo nuoroda (Administracija, valdo abu padalinius): ${frontendBaseUrl}/manager/${DEPARTMENTS.ADMINISTRATION}/${managerTokens[DEPARTMENTS.ADMINISTRATION]}`,
  );
  console.log(
    `Papildoma vadovo nuoroda (Gamyba, tik gamybai): ${frontendBaseUrl}/manager/${DEPARTMENTS.PRODUCTION}/${managerTokens[DEPARTMENTS.PRODUCTION]}`,
  );
  console.log(
    `Email pranešimai: ${
      emailNotifier.enabled
        ? `aktyvūs (gavėjas: ${emailNotifier.targetEmail || 'nenurodytas'})`
        : 'neaktyvūs (trūksta SMTP konfigūracijos)'
    }`,
  );

  setTimeout(() => {
    runSignedRequestReminderJob();
  }, 15000);
  setInterval(() => {
    runSignedRequestReminderJob();
  }, SIGNED_REQUEST_REMINDER_INTERVAL_MS);
});
