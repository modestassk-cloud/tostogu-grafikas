const { DEPARTMENTS, isValidDepartment, listVacations, syncVacationEmployeeLink } = require('./db');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const PRODUCTION_PERSONNEL_URL = 'https://timesheet-web-production.up.railway.app';
const DEV_PERSONNEL_URL = 'http://localhost:8000';

let cache = {
  fetchedAt: 0,
  employees: [],
};
let inflightPromise = null;
let lastReconcileKey = '';

function normalizeText(value) {
  return String(value || '').trim().replace(/\s{2,}/g, ' ');
}

function normalizeLookup(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeDepartmentCandidate(value) {
  return normalizeLookup(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolvePersonnelApiBaseUrl() {
  const explicit = String(process.env.PERSONNEL_API_BASE_URL || '').trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const isProduction = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  return isProduction ? PRODUCTION_PERSONNEL_URL : DEV_PERSONNEL_URL;
}

function resolvePersonnelIntegrationToken() {
  const explicit = String(process.env.PERSONNEL_INTEGRATION_TOKEN || '').trim();
  if (explicit) {
    return explicit;
  }

  const sharedTokens = String(process.env.INTEGRATION_TOKENS || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return sharedTokens[0] || '';
}

function resolveTimeoutMs() {
  const parsed = Number(process.env.PERSONNEL_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function resolveCacheTtlMs() {
  const parsed = Number(process.env.PERSONNEL_DIRECTORY_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

function mapVacationDepartment(rawEmployee) {
  const positionCandidate = normalizeDepartmentCandidate(rawEmployee?.position);
  if (positionCandidate.includes('gamyb') && positionCandidate.includes('vadov')) {
    return DEPARTMENTS.ADMINISTRATION;
  }

  const exactCandidates = [
    rawEmployee?.vacation_department,
    rawEmployee?.department_code,
    rawEmployee?.department,
  ]
    .map((value) => normalizeDepartmentCandidate(value))
    .filter(Boolean);

  if (exactCandidates.includes(DEPARTMENTS.ADMINISTRATION)) {
    return DEPARTMENTS.ADMINISTRATION;
  }
  if (exactCandidates.includes(DEPARTMENTS.PRODUCTION)) {
    return DEPARTMENTS.PRODUCTION;
  }

  const adminKeywords = [
    'administr',
    'admin',
    'pardav',
    'sales',
    'apskait',
    'finans',
    'pirk',
    'marketing',
    'projekt',
    'konstr',
    'dizain',
    'personal',
    'hr',
    'vadov',
    'biur',
    'office',
    'it',
  ];
  const productionKeywords = [
    'gamyb',
    'cech',
    'surink',
    'sand',
    'pakav',
    'operator',
    'meistr',
    'komplekt',
    'bald',
    'virin',
    'daz',
    'stakl',
  ];

  const heuristicCandidates = [
    rawEmployee?.schedule_type,
    rawEmployee?.department,
    rawEmployee?.department_code,
    rawEmployee?.position,
  ]
    .map((value) => normalizeDepartmentCandidate(value))
    .filter(Boolean);

  if (heuristicCandidates.some((value) => adminKeywords.some((keyword) => value.includes(keyword)))) {
    return DEPARTMENTS.ADMINISTRATION;
  }
  if (
    heuristicCandidates.some((value) =>
      productionKeywords.some((keyword) => value.includes(keyword)),
    )
  ) {
    return DEPARTMENTS.PRODUCTION;
  }

  return DEPARTMENTS.PRODUCTION;
}

function mapEmployee(rawEmployee) {
  const id = normalizeText(rawEmployee?.employee_id || rawEmployee?.id);
  const firstName = normalizeText(rawEmployee?.first_name);
  const lastName = normalizeText(rawEmployee?.last_name);
  const fullName =
    normalizeText(rawEmployee?.full_name) || normalizeText(`${firstName} ${lastName}`);

  if (!id || !fullName) {
    return null;
  }

  return {
    id,
    employeeId: id,
    employeeCode: normalizeText(rawEmployee?.employee_code) || null,
    firstName,
    lastName,
    fullName,
    position:
      normalizeText(rawEmployee?.position || rawEmployee?.job_title || rawEmployee?.jobTitle) || null,
    department: mapVacationDepartment(rawEmployee),
    rawDepartment: normalizeText(rawEmployee?.department) || null,
    departmentCode: normalizeText(rawEmployee?.department_code) || null,
    isActive: Boolean(rawEmployee?.is_active),
    source: 'management-center',
  };
}

function sortEmployees(employees) {
  return employees
    .slice()
    .sort(
      (left, right) =>
        left.department.localeCompare(right.department, 'lt') ||
        left.fullName.localeCompare(right.fullName, 'lt'),
    );
}

function buildDirectoryMaps(employees) {
  const byId = new Map();
  const byDepartmentAndName = new Map();

  employees.forEach((employee) => {
    byId.set(employee.id, employee);
    const key = `${employee.department}::${normalizeLookup(employee.fullName)}`;
    if (!byDepartmentAndName.has(key)) {
      byDepartmentAndName.set(key, []);
    }
    byDepartmentAndName.get(key).push(employee);
  });

  return { byId, byDepartmentAndName };
}

async function fetchDirectoryFromApi() {
  const baseUrl = resolvePersonnelApiBaseUrl();
  if (!baseUrl) {
    throw new Error('Valdymo centro darbuotojų API adresas nesukonfigūruotas.');
  }

  const integrationToken = resolvePersonnelIntegrationToken();
  if (!integrationToken) {
    throw new Error('Trūksta Valdymo centro integracijos rakto.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveTimeoutMs());

  try {
    const response = await fetch(
      `${baseUrl}/api/v1/integrations/vacations/employees?include_inactive=true`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'eigida-vacations/1.0',
          'x-integration-token': integrationToken,
        },
        signal: controller.signal,
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage =
        payload && typeof payload === 'object' && payload.detail
          ? String(payload.detail)
          : 'Nepavyko gauti darbuotojų kortelių iš Valdymo centro.';
      throw new Error(errorMessage);
    }

    if (!Array.isArray(payload)) {
      throw new Error('Valdymo centro darbuotojų katalogas grąžino neteisingą formatą.');
    }

    const employees = sortEmployees(payload.map(mapEmployee).filter(Boolean));
    cache = {
      fetchedAt: Date.now(),
      employees,
    };
    await reconcileLegacyVacationLinks(employees);
    return employees;
  } finally {
    clearTimeout(timeout);
  }
}

async function getDirectoryEmployees({ forceRefresh = false } = {}) {
  const cacheAge = Date.now() - cache.fetchedAt;
  if (!forceRefresh && cache.fetchedAt && cacheAge < resolveCacheTtlMs()) {
    return cache.employees;
  }

  if (!inflightPromise) {
    inflightPromise = fetchDirectoryFromApi().finally(() => {
      inflightPromise = null;
    });
  }

  return inflightPromise;
}

async function listPersonnelEmployees({ department, includeInactive = false } = {}) {
  const employees = await getDirectoryEmployees();
  return employees.filter((employee) => {
    if (department && employee.department !== department) {
      return false;
    }
    if (!includeInactive && !employee.isActive) {
      return false;
    }
    return true;
  });
}

async function resolvePersonnelEmployee({
  department,
  employeeId,
  employeeName,
  allowInactive = false,
}) {
  const employees = await listPersonnelEmployees({ department, includeInactive: allowInactive });
  const maps = buildDirectoryMaps(employees);

  const normalizedEmployeeId = normalizeText(employeeId);
  if (normalizedEmployeeId) {
    const directMatch = maps.byId.get(normalizedEmployeeId) || null;
    if (directMatch) {
      return directMatch;
    }
  }

  const lookupKey = `${department}::${normalizeLookup(employeeName)}`;
  const matches = maps.byDepartmentAndName.get(lookupKey) || [];
  return matches.length === 1 ? matches[0] : null;
}

async function reconcileLegacyVacationLinks(employees) {
  const nextKey = employees.map((employee) => `${employee.id}:${employee.fullName}`).join('|');
  if (!nextKey || nextKey === lastReconcileKey) {
    return;
  }

  const { byId, byDepartmentAndName } = buildDirectoryMaps(employees);
  const vacations = listVacations({ includeRejected: true });

  vacations.forEach((vacation) => {
    if (!isValidDepartment(vacation.department)) {
      return;
    }

    let matchedEmployee = null;
    const normalizedEmployeeId = normalizeText(vacation.employeeId);
    if (normalizedEmployeeId) {
      matchedEmployee = byId.get(normalizedEmployeeId) || null;
    }

    if (!matchedEmployee) {
      const matches =
        byDepartmentAndName.get(
          `${vacation.department}::${normalizeLookup(vacation.employeeName)}`,
        ) || [];
      if (matches.length === 1) {
        matchedEmployee = matches[0];
      }
    }

    if (!matchedEmployee || matchedEmployee.department !== vacation.department) {
      return;
    }

    const shouldSyncId = normalizeText(vacation.employeeId) !== matchedEmployee.id;
    const shouldSyncName = normalizeText(vacation.employeeName) !== matchedEmployee.fullName;

    if (!shouldSyncId && !shouldSyncName) {
      return;
    }

    syncVacationEmployeeLink(vacation.id, {
      employeeId: matchedEmployee.id,
      employeeName: matchedEmployee.fullName,
    });
  });

  lastReconcileKey = nextKey;
}

module.exports = {
  getDirectoryEmployees,
  listPersonnelEmployees,
  resolvePersonnelEmployee,
};
