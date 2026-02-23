export const DEPARTMENTS = Object.freeze({
  PRODUCTION: 'gamyba',
  ADMINISTRATION: 'administracija',
});

export const DEPARTMENT_OPTIONS = Object.freeze([
  { value: DEPARTMENTS.PRODUCTION, label: 'Gamyba' },
  { value: DEPARTMENTS.ADMINISTRATION, label: 'Administracija' },
]);

export function isValidDepartment(value) {
  return DEPARTMENT_OPTIONS.some((department) => department.value === value);
}

export function getDepartmentLabel(value) {
  return DEPARTMENT_OPTIONS.find((department) => department.value === value)?.label || value;
}
