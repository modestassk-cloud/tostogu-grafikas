const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { customAlphabet } = require('nanoid');

const VACATION_STATUSES = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});
const ENTRY_TYPES = Object.freeze({
  VACATION: 'vacation',
  ILLNESS: 'illness',
});
const EMPLOYEE_SOURCES = Object.freeze({
  MANUAL: 'manual',
  IMPORTED: 'imported',
});

const DEPARTMENTS = Object.freeze({
  PRODUCTION: 'gamyba',
  ADMINISTRATION: 'administracija',
});

const ALL_DEPARTMENTS = Object.freeze(Object.values(DEPARTMENTS));

const generateId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 14);
const generateManagerToken = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  32,
);

const DATA_DIR = path.resolve(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'vacations.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS vacations (
    id TEXT PRIMARY KEY,
    employee_name TEXT NOT NULL,
    employee_id TEXT,
    department TEXT NOT NULL DEFAULT 'gamyba',
    entry_type TEXT NOT NULL DEFAULT 'vacation' CHECK(entry_type IN ('vacation', 'illness')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    signed_request_received INTEGER NOT NULL DEFAULT 0,
    signed_request_received_at TEXT,
    signed_request_reminder_sent_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    full_name_normalized TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT 'gamyba',
    source TEXT NOT NULL DEFAULT 'manual',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const vacationColumns = db.prepare('PRAGMA table_info(vacations)').all();
const hasDepartmentColumn = vacationColumns.some((column) => column.name === 'department');
const hasEntryTypeColumn = vacationColumns.some((column) => column.name === 'entry_type');
const hasSignedRequestReceivedColumn = vacationColumns.some(
  (column) => column.name === 'signed_request_received',
);
const hasSignedRequestReceivedAtColumn = vacationColumns.some(
  (column) => column.name === 'signed_request_received_at',
);
const hasSignedRequestReminderSentAtColumn = vacationColumns.some(
  (column) => column.name === 'signed_request_reminder_sent_at',
);
const hasEmployeeIdColumn = vacationColumns.some((column) => column.name === 'employee_id');

const employeeColumns = db.prepare('PRAGMA table_info(employees)').all();
const hasEmployeeFullNameNormalizedColumn = employeeColumns.some(
  (column) => column.name === 'full_name_normalized',
);
const hasEmployeeIsActiveColumn = employeeColumns.some((column) => column.name === 'is_active');
const hasEmployeeCreatedAtColumn = employeeColumns.some((column) => column.name === 'created_at');
const hasEmployeeUpdatedAtColumn = employeeColumns.some((column) => column.name === 'updated_at');
const hasEmployeeSourceColumn = employeeColumns.some((column) => column.name === 'source');

if (!hasEmployeeIdColumn) {
  db.exec(`
    ALTER TABLE vacations
    ADD COLUMN employee_id TEXT;
  `);
}

if (!hasEmployeeFullNameNormalizedColumn) {
  db.exec(`
    ALTER TABLE employees
    ADD COLUMN full_name_normalized TEXT;
  `);
}

if (!hasEmployeeIsActiveColumn) {
  db.exec(`
    ALTER TABLE employees
    ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
  `);
}

if (!hasEmployeeCreatedAtColumn) {
  db.exec(`
    ALTER TABLE employees
    ADD COLUMN created_at TEXT;
  `);
}

if (!hasEmployeeUpdatedAtColumn) {
  db.exec(`
    ALTER TABLE employees
    ADD COLUMN updated_at TEXT;
  `);
}

if (!hasEmployeeSourceColumn) {
  db.exec(`
    ALTER TABLE employees
    ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
  `);
}

if (!hasDepartmentColumn) {
  db.exec(`
    ALTER TABLE vacations
    ADD COLUMN department TEXT NOT NULL DEFAULT 'gamyba';
  `);
}

if (!hasEntryTypeColumn) {
  db.exec(`
    ALTER TABLE vacations
    ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'vacation';
  `);
}

if (!hasSignedRequestReceivedColumn) {
  db.exec(`
    ALTER TABLE vacations
    ADD COLUMN signed_request_received INTEGER NOT NULL DEFAULT 0;
  `);
}

if (!hasSignedRequestReceivedAtColumn) {
  db.exec(`
    ALTER TABLE vacations
    ADD COLUMN signed_request_received_at TEXT;
  `);
}

if (!hasSignedRequestReminderSentAtColumn) {
  db.exec(`
    ALTER TABLE vacations
    ADD COLUMN signed_request_reminder_sent_at TEXT;
  `);
}

db.exec(`
  UPDATE vacations
  SET department = 'gamyba'
  WHERE department IS NULL OR TRIM(department) = '';

  UPDATE vacations
  SET entry_type = 'vacation'
  WHERE entry_type IS NULL OR TRIM(entry_type) = '';

  UPDATE vacations
  SET signed_request_received = 0
  WHERE signed_request_received IS NULL;

  UPDATE employees
  SET full_name_normalized = LOWER(TRIM(full_name))
  WHERE full_name_normalized IS NULL OR TRIM(full_name_normalized) = '';

  UPDATE employees
  SET is_active = 1
  WHERE is_active IS NULL;

  UPDATE employees
  SET created_at = COALESCE(created_at, updated_at, '${new Date(0).toISOString()}')
  WHERE created_at IS NULL OR TRIM(created_at) = '';

  UPDATE employees
  SET updated_at = COALESCE(updated_at, created_at, '${new Date(0).toISOString()}')
  WHERE updated_at IS NULL OR TRIM(updated_at) = '';
`);

if (!hasEmployeeSourceColumn) {
  db.exec(`
    UPDATE employees
    SET source = CASE
      WHEN EXISTS (
        SELECT 1
        FROM vacations
        WHERE vacations.employee_id = employees.id
      ) THEN 'imported'
      ELSE 'manual'
    END;
  `);
}

db.exec(`
  UPDATE employees
  SET source = 'manual'
  WHERE source IS NULL OR TRIM(source) = '';

  CREATE INDEX IF NOT EXISTS idx_vacations_dates ON vacations (start_date, end_date);
  CREATE INDEX IF NOT EXISTS idx_vacations_status ON vacations (status);
  CREATE INDEX IF NOT EXISTS idx_vacations_department ON vacations (department);
  CREATE INDEX IF NOT EXISTS idx_vacations_entry_type ON vacations (entry_type);
  CREATE INDEX IF NOT EXISTS idx_vacations_employee_id ON vacations (employee_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_department_name
    ON employees (department, full_name_normalized);
  CREATE INDEX IF NOT EXISTS idx_employees_department_active
    ON employees (department, is_active);
  CREATE INDEX IF NOT EXISTS idx_employees_source
    ON employees (source);
`);

function normalizeDepartment(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidDepartment(value) {
  return ALL_DEPARTMENTS.includes(normalizeDepartment(value));
}

function toDepartmentOrDefault(value, fallback = DEPARTMENTS.PRODUCTION) {
  const normalized = normalizeDepartment(value);
  return isValidDepartment(normalized) ? normalized : fallback;
}

function normalizeEntryType(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEntryType(value) {
  return Object.values(ENTRY_TYPES).includes(normalizeEntryType(value));
}

function toEntryTypeOrDefault(value, fallback = ENTRY_TYPES.VACATION) {
  const normalized = normalizeEntryType(value);
  return isValidEntryType(normalized) ? normalized : fallback;
}

function normalizePersonName(value) {
  return String(value || '').trim().replace(/\s{2,}/g, ' ');
}

function normalizeEmployeeLookupKey(value) {
  return normalizePersonName(value).toLowerCase();
}

function normalizeEmployeeSource(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmployeeSource(value) {
  return Object.values(EMPLOYEE_SOURCES).includes(normalizeEmployeeSource(value));
}

function toEmployeeSourceOrDefault(value, fallback = EMPLOYEE_SOURCES.MANUAL) {
  const normalized = normalizeEmployeeSource(value);
  return isValidEmployeeSource(normalized) ? normalized : fallback;
}

function rowToVacation(row) {
  if (!row) return null;

  return {
    id: row.id,
    employeeId: row.employee_id || null,
    employeeName: row.employee_full_name || row.employee_name,
    department: row.department,
    entryType: toEntryTypeOrDefault(row.entry_type),
    startDate: row.start_date,
    endDate: row.end_date,
    signedRequestReceived: Number(row.signed_request_received) === 1,
    signedRequestReceivedAt: row.signed_request_received_at || null,
    signedRequestReminderSentAt: row.signed_request_reminder_sent_at || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEmployee(row) {
  if (!row) return null;

  return {
    id: row.id,
    fullName: row.full_name,
    department: row.department,
    source: toEmployeeSourceOrDefault(row.source),
    isActive: Number(row.is_active) === 1,
    recordsCount: Number(row.records_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function getSetting(key) {
  const row = db
    .prepare(
      `
      SELECT value
      FROM settings
      WHERE key = ?
    `,
    )
    .get(key);

  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(key, value);
}

function managerTokenSettingKey(department) {
  return `manager_token_${department}`;
}

const backfillEmployeesFromVacations = db.transaction(() => {
  const distinctVacationEmployees = db
    .prepare(
      `
      SELECT DISTINCT
        employee_name,
        department
      FROM vacations
      WHERE TRIM(employee_name) != ''
    `,
    )
    .all();
  const findEmployeeStatement = db.prepare(
    `
      SELECT id
      FROM employees
      WHERE department = ? AND full_name_normalized = ?
    `,
  );
  const insertEmployeeStatement = db.prepare(
    `
      INSERT INTO employees (
        id,
        full_name,
        full_name_normalized,
        department,
        source,
        is_active,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const linkVacationsStatement = db.prepare(
    `
      UPDATE vacations
      SET employee_id = ?,
          employee_name = ?
      WHERE department = ?
        AND LOWER(TRIM(employee_name)) = ?
        AND (employee_id IS NULL OR TRIM(employee_id) = '')
    `,
  );

  distinctVacationEmployees.forEach((row) => {
    const fullName = normalizePersonName(row.employee_name);
    const department = toDepartmentOrDefault(row.department);
    const lookupKey = normalizeEmployeeLookupKey(fullName);

    if (!fullName || !lookupKey) {
      return;
    }

    let employee = findEmployeeStatement.get(department, lookupKey);
    if (!employee) {
      const createdAt = nowIso();
      const id = generateId();
      insertEmployeeStatement.run(
        id,
        fullName,
        lookupKey,
        department,
        EMPLOYEE_SOURCES.IMPORTED,
        1,
        createdAt,
        createdAt,
      );
      employee = { id };
    }

    linkVacationsStatement.run(employee.id, fullName, department, lookupKey);
  });
});

backfillEmployeesFromVacations();

function getOrCreateManagerTokenForDepartment(department, explicitToken) {
  const normalizedDepartment = toDepartmentOrDefault(department);
  const settingKey = managerTokenSettingKey(normalizedDepartment);

  if (explicitToken && explicitToken.trim()) {
    setSetting(settingKey, explicitToken.trim());
    return explicitToken.trim();
  }

  const existing = getSetting(settingKey);
  if (existing) return existing;

  const created = generateManagerToken();
  setSetting(settingKey, created);
  return created;
}

function getOrCreateManagerTokens(explicitTokensByDepartment = {}) {
  const tokens = {};

  ALL_DEPARTMENTS.forEach((department) => {
    tokens[department] = getOrCreateManagerTokenForDepartment(
      department,
      explicitTokensByDepartment[department] || '',
    );
  });

  return tokens;
}

function listVacations({ department, includeRejected = false } = {}) {
  const conditions = [];
  const values = [];

  if (department) {
    conditions.push('vacations.department = ?');
    values.push(toDepartmentOrDefault(department));
  }

  if (!includeRejected) {
    conditions.push('vacations.status != ?');
    values.push(VACATION_STATUSES.REJECTED);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT
        vacations.id,
        vacations.employee_id,
        vacations.employee_name,
        employees.full_name AS employee_full_name,
        vacations.department,
        vacations.entry_type,
        vacations.start_date,
        vacations.end_date,
        vacations.signed_request_received,
        vacations.signed_request_received_at,
        vacations.signed_request_reminder_sent_at,
        vacations.status,
        vacations.created_at,
        vacations.updated_at
      FROM vacations
      LEFT JOIN employees
        ON employees.id = vacations.employee_id
      ${whereSql}
      ORDER BY vacations.start_date ASC, COALESCE(employees.full_name, vacations.employee_name) COLLATE NOCASE ASC
    `,
    )
    .all(...values);

  return rows.map(rowToVacation);
}

function getVacationById(id) {
  const row = db
    .prepare(
      `
      SELECT
        vacations.id,
        vacations.employee_id,
        vacations.employee_name,
        employees.full_name AS employee_full_name,
        vacations.department,
        vacations.entry_type,
        vacations.start_date,
        vacations.end_date,
        vacations.signed_request_received,
        vacations.signed_request_received_at,
        vacations.signed_request_reminder_sent_at,
        vacations.status,
        vacations.created_at,
        vacations.updated_at
      FROM vacations
      LEFT JOIN employees
        ON employees.id = vacations.employee_id
      WHERE vacations.id = ?
    `,
    )
    .get(id);

  return rowToVacation(row);
}

function createVacation({ employeeId = null, employeeName, department, entryType, startDate, endDate }) {
  const id = generateId();
  const createdAt = nowIso();
  const normalizedDepartment = toDepartmentOrDefault(department);
  const normalizedEntryType = toEntryTypeOrDefault(entryType);
  const initialStatus =
    normalizedEntryType === ENTRY_TYPES.ILLNESS
      ? VACATION_STATUSES.APPROVED
      : VACATION_STATUSES.PENDING;

  db.prepare(
    `
    INSERT INTO vacations (
      id,
      employee_name,
      employee_id,
      department,
      entry_type,
      start_date,
      end_date,
      signed_request_received,
      signed_request_received_at,
      signed_request_reminder_sent_at,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    employeeName,
    employeeId,
    normalizedDepartment,
    normalizedEntryType,
    startDate,
    endDate,
    0,
    null,
    null,
    initialStatus,
    createdAt,
    createdAt,
  );

  return getVacationById(id);
}

function updateVacation(id, updates) {
  const updateFields = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(updates, 'employeeId')) {
    updateFields.push('employee_id = ?');
    values.push(updates.employeeId || null);
  }

  if (typeof updates.employeeName === 'string') {
    updateFields.push('employee_name = ?');
    values.push(updates.employeeName);
  }

  if (typeof updates.department === 'string') {
    updateFields.push('department = ?');
    values.push(toDepartmentOrDefault(updates.department));
  }

  if (typeof updates.entryType === 'string') {
    updateFields.push('entry_type = ?');
    values.push(toEntryTypeOrDefault(updates.entryType));
  }

  if (typeof updates.startDate === 'string') {
    updateFields.push('start_date = ?');
    values.push(updates.startDate);
  }

  if (typeof updates.endDate === 'string') {
    updateFields.push('end_date = ?');
    values.push(updates.endDate);
  }

  if (typeof updates.status === 'string') {
    updateFields.push('status = ?');
    values.push(updates.status);
  }

  if (typeof updates.signedRequestReceived === 'boolean') {
    updateFields.push('signed_request_received = ?');
    values.push(updates.signedRequestReceived ? 1 : 0);

    updateFields.push('signed_request_received_at = ?');
    values.push(updates.signedRequestReceived ? nowIso() : null);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'signedRequestReminderSentAt')) {
    updateFields.push('signed_request_reminder_sent_at = ?');
    values.push(updates.signedRequestReminderSentAt);
  }

  if (!updateFields.length) {
    return getVacationById(id);
  }

  updateFields.push('updated_at = ?');
  values.push(nowIso());
  values.push(id);

  const sql = `
    UPDATE vacations
    SET ${updateFields.join(', ')}
    WHERE id = ?
  `;

  db.prepare(sql).run(...values);

  return getVacationById(id);
}

function syncVacationEmployeeLink(id, { employeeId = null, employeeName = '' } = {}) {
  db.prepare(
    `
      UPDATE vacations
      SET employee_id = ?,
          employee_name = ?
      WHERE id = ?
    `,
  ).run(employeeId || null, normalizePersonName(employeeName), id);

  return getVacationById(id);
}

function listEmployees({ department, includeInactive = false, includeImported = true } = {}) {
  const conditions = [];
  const values = [];

  if (department) {
    conditions.push('employees.department = ?');
    values.push(toDepartmentOrDefault(department));
  }

  if (!includeInactive) {
    conditions.push('employees.is_active = 1');
  }

  if (!includeImported) {
    conditions.push('employees.source = ?');
    values.push(EMPLOYEE_SOURCES.MANUAL);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `
      SELECT
        employees.id,
        employees.full_name,
        employees.department,
        employees.source,
        employees.is_active,
        employees.created_at,
        employees.updated_at,
        COUNT(vacations.id) AS records_count
      FROM employees
      LEFT JOIN vacations
        ON vacations.employee_id = employees.id
      ${whereSql}
      GROUP BY employees.id
      ORDER BY
        CASE employees.source
          WHEN 'manual' THEN 0
          ELSE 1
        END,
        employees.is_active DESC,
        employees.full_name COLLATE NOCASE ASC
    `,
    )
    .all(...values);

  return rows.map(rowToEmployee);
}

function getEmployeeById(id) {
  const row = db
    .prepare(
      `
      SELECT
        employees.id,
        employees.full_name,
        employees.department,
        employees.source,
        employees.is_active,
        employees.created_at,
        employees.updated_at,
        COUNT(vacations.id) AS records_count
      FROM employees
      LEFT JOIN vacations
        ON vacations.employee_id = employees.id
      WHERE employees.id = ?
      GROUP BY employees.id
    `,
    )
    .get(id);

  return rowToEmployee(row);
}

function findEmployeeByName({ department, fullName }) {
  const normalizedDepartment = toDepartmentOrDefault(department);
  const lookupKey = normalizeEmployeeLookupKey(fullName);
  if (!lookupKey) {
    return null;
  }

  const row = db
    .prepare(
      `
      SELECT
        employees.id,
        employees.full_name,
        employees.department,
        employees.source,
        employees.is_active,
        employees.created_at,
        employees.updated_at,
        COUNT(vacations.id) AS records_count
      FROM employees
      LEFT JOIN vacations
        ON vacations.employee_id = employees.id
      WHERE employees.department = ? AND employees.full_name_normalized = ?
      GROUP BY employees.id
    `,
    )
    .get(normalizedDepartment, lookupKey);

  return rowToEmployee(row);
}

function createEmployee({ fullName, department, isActive = true, source = EMPLOYEE_SOURCES.MANUAL }) {
  const normalizedFullName = normalizePersonName(fullName);
  const lookupKey = normalizeEmployeeLookupKey(normalizedFullName);
  const normalizedDepartment = toDepartmentOrDefault(department);
  const existing = findEmployeeByName({ department: normalizedDepartment, fullName: normalizedFullName });

  if (existing) {
    return existing;
  }

  const id = generateId();
  const createdAt = nowIso();

  db.prepare(
    `
      INSERT INTO employees (
        id,
        full_name,
        full_name_normalized,
        department,
        source,
        is_active,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    normalizedFullName,
    lookupKey,
    normalizedDepartment,
    toEmployeeSourceOrDefault(source),
    isActive ? 1 : 0,
    createdAt,
    createdAt,
  );

  return getEmployeeById(id);
}

const updateEmployeeRecord = db.transaction((id, updates) => {
  const existing = getEmployeeById(id);
  if (!existing) {
    return null;
  }

  const updateFields = [];
  const values = [];
  let nextFullName = existing.fullName;

  if (typeof updates.fullName === 'string') {
    nextFullName = normalizePersonName(updates.fullName);
    updateFields.push('full_name = ?');
    values.push(nextFullName);
    updateFields.push('full_name_normalized = ?');
    values.push(normalizeEmployeeLookupKey(nextFullName));
  }

  if (typeof updates.isActive === 'boolean') {
    updateFields.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }

  if (typeof updates.source === 'string') {
    updateFields.push('source = ?');
    values.push(toEmployeeSourceOrDefault(updates.source));
  }

  if (!updateFields.length) {
    return existing;
  }

  updateFields.push('updated_at = ?');
  values.push(nowIso());
  values.push(id);

  db.prepare(
    `
      UPDATE employees
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `,
  ).run(...values);

  if (typeof updates.fullName === 'string') {
    db.prepare(
      `
        UPDATE vacations
        SET employee_name = ?
        WHERE employee_id = ?
      `,
    ).run(nextFullName, id);
  }

  return getEmployeeById(id);
});

function updateEmployee(id, updates) {
  return updateEmployeeRecord(id, updates);
}

module.exports = {
  VACATION_STATUSES,
  ENTRY_TYPES,
  EMPLOYEE_SOURCES,
  DEPARTMENTS,
  ALL_DEPARTMENTS,
  dbPath: DB_PATH,
  isValidDepartment,
  toDepartmentOrDefault,
  isValidEntryType,
  toEntryTypeOrDefault,
  isValidEmployeeSource,
  getOrCreateManagerTokens,
  listVacations,
  createVacation,
  getVacationById,
  updateVacation,
  syncVacationEmployeeLink,
  listEmployees,
  getEmployeeById,
  findEmployeeByName,
  createEmployee,
  updateEmployee,
};
