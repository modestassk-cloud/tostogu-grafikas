require('dotenv').config();

const { createHmac, timingSafeEqual } = require('crypto');
const cors = require('cors');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createEmailNotifierFromEnv } = require('./notifications');
const {
  VACATION_STATUSES,
  ENTRY_TYPES,
  EMPLOYEE_SOURCES,
  DEPARTMENTS,
  dbPath,
  isValidDepartment,
  isValidEntryType,
  isValidEmployeeSource,
  getOrCreateManagerTokens,
  listVacations,
  createVacation,
  getVacationById,
  updateVacation,
  listEmployees,
  getEmployeeById,
  findEmployeeByName,
  createEmployee,
  updateEmployee,
} = require('./db');

const app = express();
const port = Number(process.env.PORT || 8787);
app.set('trust proxy', true);

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
const INTEGRATION_TOKEN_HEADER = 'x-integration-token';
const integrationTokens = new Set(
  String(process.env.INTEGRATION_TOKENS || '')
    .split(',')
    .map((token) => String(token || '').trim())
    .filter(Boolean),
);
const PLATFORM_AUTH_SECRET = String(process.env.PLATFORM_AUTH_SECRET || '').trim();
const PLATFORM_MODULE_KEY = 'vacations';
const PLATFORM_MANAGE_LEVELS = new Set(['manage', 'admin']);

function normalizeIpAddress(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (value === '::1') return '127.0.0.1';
  return value.replace(/^::ffff:/, '');
}

function parseAllowedIps(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((item) => normalizeIpAddress(item))
    .filter(Boolean);
}

function uniqueItems(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function extractIntegrationToken(req) {
  const explicitToken = String(req.get(INTEGRATION_TOKEN_HEADER) || '').trim();
  if (explicitToken) {
    return explicitToken;
  }

  const authorization = String(req.get('authorization') || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match) {
    return String(match[1] || '').trim();
  }

  const queryToken = String(req.query?.integration_token || req.query?.integrationToken || '').trim();
  if (queryToken) {
    return queryToken;
  }

  return '';
}

function isIntegrationAllowedPath(requestPath) {
  const normalizedPath = String(requestPath || '').trim();
  return normalizedPath === '/api/vacations' || normalizedPath.startsWith('/api/vacations/');
}

function signPlatformPayload(payloadBase64) {
  return createHmac('sha256', PLATFORM_AUTH_SECRET).update(payloadBase64).digest('base64url');
}

function verifyPlatformSessionToken(token) {
  if (!PLATFORM_AUTH_SECRET) {
    return null;
  }

  const [payloadBase64, signature] = String(token || '').split('.');
  if (!payloadBase64 || !signature) {
    return null;
  }

  const expected = signPlatformPayload(payloadBase64);
  if (!safeCompare(signature, expected)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
  } catch (error) {
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const expiresAt = Number(payload.exp || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  const modulePermissions =
    payload.module_permissions && typeof payload.module_permissions === 'object'
      ? payload.module_permissions
      : {};
  const vacationsPermission = String(modulePermissions[PLATFORM_MODULE_KEY] || 'none')
    .trim()
    .toLowerCase();
  if (!PLATFORM_MANAGE_LEVELS.has(vacationsPermission)) {
    return null;
  }

  const departmentCodes = Array.isArray(payload.department_codes)
    ? payload.department_codes
        .map((value) => normalizeDepartment(value))
        .filter((value) => isValidDepartment(value))
    : [];

  return {
    email: String(payload.email || '').trim().toLowerCase() || null,
    roles: Array.isArray(payload.roles)
      ? payload.roles.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
      : [],
    departmentCodes: uniqueItems(departmentCodes),
    canManageAllDepartments: Boolean(payload.can_manage_all_departments || payload.is_super_admin),
    permissionLevel: vacationsPermission,
  };
}

const defaultAllowedIps = ['85.206.86.184'];
const ipAllowlist = new Set(
  parseAllowedIps(process.env.ALLOWED_IPS || defaultAllowedIps.join(',')),
);
if (process.env.NODE_ENV !== 'production') {
  ipAllowlist.add('127.0.0.1');
}

const ipAllowlistEnabled =
  String(process.env.IP_ALLOWLIST_ENABLED || 'true').toLowerCase() !== 'false';
const ipAllowlistExemptPaths = new Set(['/api/health']);

function getClientIps(req) {
  const forwardedFor = String(req.get('x-forwarded-for') || '');
  const forwardedIps = forwardedFor
    .split(',')
    .map((value) => normalizeIpAddress(value))
    .filter(Boolean);

  const candidates = [
    normalizeIpAddress(req.get('cf-connecting-ip')),
    normalizeIpAddress(req.get('true-client-ip')),
    normalizeIpAddress(req.get('x-real-ip')),
    normalizeIpAddress(req.ip || req.socket?.remoteAddress || ''),
    forwardedIps[0] || '',
  ];

  return uniqueItems(candidates);
}

function ipAllowlistMiddleware(req, res, next) {
  if (!ipAllowlistEnabled) {
    return next();
  }

  const providedIntegrationToken = extractIntegrationToken(req);
  if (isIntegrationAllowedPath(req.path) && integrationTokens.size > 0) {
    if (providedIntegrationToken && integrationTokens.has(providedIntegrationToken)) {
      return next();
    }
  }

  if (ipAllowlistExemptPaths.has(req.path)) {
    return next();
  }

  const clientIps = getClientIps(req);
  const isAllowed = clientIps.some((ip) => ipAllowlist.has(ip));

  if (isAllowed) {
    return next();
  }

  const detectedIp = clientIps[0] || null;
  const xForwardedFor = req.get('x-forwarded-for') || '-';
  console.warn(
    `[IP_ALLOWLIST] Blokuotas užklausos IP. detected=${detectedIp || '-'} candidates=${clientIps.join(',') || '-'} x-forwarded-for=${xForwardedFor}`,
  );

  const message = 'Prieiga leidžiama tik iš biuro tinklo.';
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({
      error: message,
      detectedIp,
    });
  }

  return res
    .status(403)
    .type('text/plain')
    .send(`${message} Aptiktas IP: ${detectedIp || 'nenustatytas'}.`);
}

app.use(cors());
app.use(express.json());
app.use(ipAllowlistMiddleware);

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

function sanitizeId(input) {
  return String(input || '').trim();
}

function normalizeDepartment(rawValue) {
  return String(rawValue || '').trim().toLowerCase();
}

function normalizeEntryType(rawValue) {
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

function parseEntryTypeOrSendError(res, rawValue, fallback = ENTRY_TYPES.VACATION) {
  const value = normalizeEntryType(rawValue);
  if (!value) {
    return fallback;
  }

  if (!isValidEntryType(value)) {
    res.status(400).json({ error: 'Neteisingas įrašo tipas. Galimi: vacation, illness.' });
    return null;
  }

  return value;
}

function getDepartmentLabel(department) {
  return department === DEPARTMENTS.ADMINISTRATION ? 'Administracija' : 'Gamyba';
}

function resolveEmployeeSelectionOrSendError(
  res,
  { department, employeeId, employeeName, allowInactive = false, allowImported = false },
) {
  const normalizedEmployeeId = sanitizeId(employeeId);
  if (normalizedEmployeeId) {
    const employee = getEmployeeById(normalizedEmployeeId);
    if (!employee || employee.department !== department) {
      res.status(400).json({ error: 'Pasirinktas darbuotojas šiame padalinyje nerastas.' });
      return null;
    }

    if (!allowInactive && !employee.isActive) {
      res.status(400).json({ error: 'Pasirinktas darbuotojas neaktyvus. Pasirinkite kitą iš sąrašo.' });
      return null;
    }

    if (!allowImported && employee.source === EMPLOYEE_SOURCES.IMPORTED) {
      res.status(400).json({ error: 'Pasirinktas vardas yra tik istorinis importas, o ne darbuotojo kortelė.' });
      return null;
    }

    return employee;
  }

  const cleanedName = sanitizeName(employeeName);
  if (!cleanedName) {
    res.status(400).json({ error: 'Pasirinkite darbuotoją iš sąrašo.' });
    return null;
  }

  const employee = findEmployeeByName({ department, fullName: cleanedName });
  if (!employee || (!allowInactive && !employee.isActive)) {
    res.status(400).json({ error: 'Pasirinktas darbuotojas sąraše nerastas.' });
    return null;
  }

  if (!allowImported && employee.source === EMPLOYEE_SOURCES.IMPORTED) {
    res.status(400).json({ error: 'Pasirinktas vardas yra tik istorinis importas, o ne darbuotojo kortelė.' });
    return null;
  }

  return employee;
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
      if (vacation.entryType !== ENTRY_TYPES.VACATION) return false;
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
  let authSource = 'legacy-manager-token';

  if (suppliedToken === administrationToken) {
    managerRole = MANAGER_ROLES.ADMIN_SUPER;
    managerDepartment = DEPARTMENTS.ADMINISTRATION;
  } else if (suppliedToken === departmentToken) {
    managerRole = MANAGER_ROLES.DEPARTMENT_MANAGER;
  } else {
    const platformSession = verifyPlatformSessionToken(suppliedToken);
    if (!platformSession) {
      return res.status(401).json({ error: 'Unauthorized manager access.' });
    }

    if (platformSession.canManageAllDepartments) {
      managerRole = MANAGER_ROLES.ADMIN_SUPER;
      managerDepartment = DEPARTMENTS.ADMINISTRATION;
    } else if (platformSession.departmentCodes.includes(department)) {
      managerRole = MANAGER_ROLES.DEPARTMENT_MANAGER;
    } else {
      return res.status(403).json({ error: 'Platform session neturi prieigos prie šio padalinio.' });
    }

    authSource = 'platform-session';
    req.actorEmail = platformSession.email;
  }

  req.department = department;
  req.managerRole = managerRole;
  req.managerDepartment = managerDepartment;
  req.canManageAllDepartments = managerRole === MANAGER_ROLES.ADMIN_SUPER;
  req.canEditSignedRequest = managerRole === MANAGER_ROLES.ADMIN_SUPER;
  req.authSource = authSource;
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

app.get('/api/employees', (req, res) => {
  const department = parseDepartmentOrSendError(res, req.query.department);
  if (!department) {
    return;
  }

  const employees = listEmployees({ department, includeInactive: false, includeImported: false });
  res.json({ employees });
});

app.post('/api/vacations', (req, res) => {
  const department = parseDepartmentOrSendError(res, req.body.department);
  const entryType = parseEntryTypeOrSendError(res, req.body.entryType);
  const startDate = String(req.body.startDate || '');
  const endDate = String(req.body.endDate || '');

  if (!department || !entryType) {
    return;
  }

  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    return res.status(400).json({ error: 'Neteisingas datos formatas. Naudokite YYYY-MM-DD.' });
  }

  if (isStartAfterEnd(startDate, endDate)) {
    return res.status(400).json({ error: 'Pradžios data negali būti vėlesnė už pabaigos datą.' });
  }

  const employee = resolveEmployeeSelectionOrSendError(res, {
    department,
    employeeId: req.body.employeeId,
    employeeName: req.body.employeeName,
    allowInactive: false,
    allowImported: false,
  });
  if (!employee) {
    return;
  }

  const created = createVacation({
    employeeId: employee.id,
    employeeName: employee.fullName,
    department,
    entryType,
    startDate,
    endDate,
  });
  if (created.entryType === ENTRY_TYPES.VACATION) {
    notifyAboutNewVacationRequest(created)
      .then((result) => {
        if (result?.sent) {
          console.log(`Naujo prašymo el. laiškas išsiųstas: ${created.id}`);
        }
      })
      .catch((error) => {
        console.error('Nepavyko išsiųsti naujo prašymo el. laiško:', error);
      });
  }
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
    authSource: req.authSource,
    actorEmail: req.actorEmail || null,
  });
});

app.get('/api/manager/:department/vacations', managerAuth, (req, res) => {
  const includeRejected = String(req.query.includeRejected || '').toLowerCase() === 'true';
  const vacations = listVacations({ department: req.department, includeRejected });
  res.json({ vacations });
});

app.get('/api/manager/:department/employees', managerAuth, (req, res) => {
  const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
  const includeImported = String(req.query.includeImported || 'true').toLowerCase() !== 'false';
  const employees = listEmployees({ department: req.department, includeInactive, includeImported });
  res.json({ employees });
});

app.post('/api/manager/:department/employees', managerAuth, (req, res) => {
  const fullName = sanitizeName(req.body.fullName);
  if (!fullName) {
    return res.status(400).json({ error: 'Darbuotojo vardas ir pavardė negali būti tušti.' });
  }

  const existing = findEmployeeByName({ department: req.department, fullName });
  if (existing) {
    return res.status(409).json({ error: 'Toks darbuotojas šiame padalinyje jau yra.' });
  }

  const employee = createEmployee({
    fullName,
    department: req.department,
    isActive: true,
  });
  res.status(201).json({ employee });
});

app.patch('/api/manager/:department/employees/:id', managerAuth, (req, res) => {
  const existing = getEmployeeById(req.params.id);
  if (!existing || existing.department !== req.department) {
    return res.status(404).json({ error: 'Darbuotojas šiame padalinyje nerastas.' });
  }

  const updates = {};

  if (Object.prototype.hasOwnProperty.call(req.body, 'fullName')) {
    const fullName = sanitizeName(req.body.fullName);
    if (!fullName) {
      return res.status(400).json({ error: 'Darbuotojo vardas ir pavardė negali būti tušti.' });
    }

    const matched = findEmployeeByName({ department: req.department, fullName });
    if (matched && matched.id !== existing.id) {
      return res.status(409).json({ error: 'Toks darbuotojas šiame padalinyje jau yra.' });
    }

    updates.fullName = fullName;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'isActive')) {
    if (typeof req.body.isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive turi būti true/false.' });
    }
    updates.isActive = req.body.isActive;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'source')) {
    if (!isValidEmployeeSource(req.body.source)) {
      return res.status(400).json({ error: 'source turi būti manual arba imported.' });
    }
    updates.source = req.body.source;
  }

  const employee = updateEmployee(existing.id, updates);
  res.json({ employee });
});

app.patch('/api/manager/:department/vacations/:id', managerAuth, (req, res) => {
  const id = req.params.id;
  const existing = getVacationById(id);

  if (!ensureVacationInDepartmentOrNotFound(existing, req.department, res)) {
    return;
  }

  const updates = {};

  if (
    Object.prototype.hasOwnProperty.call(req.body, 'employeeId') ||
    Object.prototype.hasOwnProperty.call(req.body, 'employeeName')
  ) {
    const employee = resolveEmployeeSelectionOrSendError(res, {
      department: req.department,
      employeeId: req.body.employeeId,
      employeeName: req.body.employeeName,
      allowInactive: true,
    });
    if (!employee) {
      return;
    }

    updates.employeeId = employee.id;
    updates.employeeName = employee.fullName;
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
    const allowed =
      existing.entryType === ENTRY_TYPES.ILLNESS
        ? new Set([VACATION_STATUSES.APPROVED, VACATION_STATUSES.REJECTED])
        : new Set(Object.values(VACATION_STATUSES));
    if (!allowed.has(status)) {
      return res.status(400).json({ error: 'Neleistina būsena.' });
    }
    updates.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'signedRequestReceived')) {
    if (existing.entryType !== ENTRY_TYPES.VACATION) {
      return res.status(400).json({ error: 'Ligos įrašams pasirašyto prašymo žyma netaikoma.' });
    }

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

app.post('/api/manager/:department/notifications/test', managerAuth, async (req, res) => {
  if (!req.canManageAllDepartments) {
    return res.status(403).json({ error: 'Testinį email gali siųsti tik administracijos vadovas.' });
  }

  try {
    const now = new Date().toISOString();
    const result = await emailNotifier.sendMail({
      subject: `TESTAS: Atostogu sistema (${now})`,
      text: 'Tai testinis pranešimas iš produkcinės atostogų sistemos.',
    });

    if (!result?.sent) {
      return res.status(503).json({ error: 'Email siuntimas neaktyvus.' });
    }

    res.json({
      ok: true,
      sent: true,
      provider: emailNotifier.provider || null,
      targetEmail: emailNotifier.targetEmail,
      sentAt: now,
    });
  } catch (error) {
    const details = error && error.message ? error.message : 'Unknown error';
    return res.status(502).json({ error: `Email siuntimas nepavyko: ${details}` });
  }
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
        ? `aktyvūs (provider: ${emailNotifier.provider || 'unknown'}, gavėjas: ${emailNotifier.targetEmail || 'nenurodytas'})`
        : 'neaktyvūs (trūksta email konfigūracijos)'
    }`,
  );
  console.log(
    `IP ribojimas: ${
      ipAllowlistEnabled ? `aktyvus (${Array.from(ipAllowlist).join(', ')})` : 'išjungtas'
    }`,
  );

  setTimeout(() => {
    runSignedRequestReminderJob();
  }, 15000);
  setInterval(() => {
    runSignedRequestReminderJob();
  }, SIGNED_REQUEST_REMINDER_INTERVAL_MS);
});
