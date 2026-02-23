const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { customAlphabet } = require('nanoid');

const VACATION_STATUSES = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
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
    department TEXT NOT NULL DEFAULT 'gamyba',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    signed_request_received INTEGER NOT NULL DEFAULT 0,
    signed_request_received_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
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
const hasSignedRequestReceivedColumn = vacationColumns.some(
  (column) => column.name === 'signed_request_received',
);
const hasSignedRequestReceivedAtColumn = vacationColumns.some(
  (column) => column.name === 'signed_request_received_at',
);

if (!hasDepartmentColumn) {
  db.exec(`
    ALTER TABLE vacations
    ADD COLUMN department TEXT NOT NULL DEFAULT 'gamyba';
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

db.exec(`
  UPDATE vacations
  SET department = 'gamyba'
  WHERE department IS NULL OR TRIM(department) = '';

  UPDATE vacations
  SET signed_request_received = 0
  WHERE signed_request_received IS NULL;

  CREATE INDEX IF NOT EXISTS idx_vacations_dates ON vacations (start_date, end_date);
  CREATE INDEX IF NOT EXISTS idx_vacations_status ON vacations (status);
  CREATE INDEX IF NOT EXISTS idx_vacations_department ON vacations (department);
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

function rowToVacation(row) {
  if (!row) return null;

  return {
    id: row.id,
    employeeName: row.employee_name,
    department: row.department,
    startDate: row.start_date,
    endDate: row.end_date,
    signedRequestReceived: Number(row.signed_request_received) === 1,
    signedRequestReceivedAt: row.signed_request_received_at || null,
    status: row.status,
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
    conditions.push('department = ?');
    values.push(toDepartmentOrDefault(department));
  }

  if (!includeRejected) {
    conditions.push('status != ?');
    values.push(VACATION_STATUSES.REJECTED);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
      SELECT
        id,
        employee_name,
        department,
        start_date,
        end_date,
        signed_request_received,
        signed_request_received_at,
        status,
        created_at,
        updated_at
      FROM vacations
      ${whereSql}
      ORDER BY start_date ASC, employee_name COLLATE NOCASE ASC
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
        id,
        employee_name,
        department,
        start_date,
        end_date,
        signed_request_received,
        signed_request_received_at,
        status,
        created_at,
        updated_at
      FROM vacations
      WHERE id = ?
    `,
    )
    .get(id);

  return rowToVacation(row);
}

function createVacation({ employeeName, department, startDate, endDate }) {
  const id = generateId();
  const createdAt = nowIso();
  const normalizedDepartment = toDepartmentOrDefault(department);

  db.prepare(
    `
    INSERT INTO vacations (
      id,
      employee_name,
      department,
      start_date,
      end_date,
      signed_request_received,
      signed_request_received_at,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    employeeName,
    normalizedDepartment,
    startDate,
    endDate,
    0,
    null,
    VACATION_STATUSES.PENDING,
    createdAt,
    createdAt,
  );

  return getVacationById(id);
}

function updateVacation(id, updates) {
  const updateFields = [];
  const values = [];

  if (typeof updates.employeeName === 'string') {
    updateFields.push('employee_name = ?');
    values.push(updates.employeeName);
  }

  if (typeof updates.department === 'string') {
    updateFields.push('department = ?');
    values.push(toDepartmentOrDefault(updates.department));
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

module.exports = {
  VACATION_STATUSES,
  DEPARTMENTS,
  ALL_DEPARTMENTS,
  dbPath: DB_PATH,
  isValidDepartment,
  toDepartmentOrDefault,
  getOrCreateManagerTokens,
  listVacations,
  createVacation,
  getVacationById,
  updateVacation,
};
