export const ENTRY_TYPES = Object.freeze({
  VACATION: 'vacation',
  ILLNESS: 'illness',
  PARENT_DAY: 'parent_day',
});

export const ENTRY_TYPE_OPTIONS = Object.freeze([
  { value: ENTRY_TYPES.VACATION, label: 'Atostogos' },
  { value: ENTRY_TYPES.PARENT_DAY, label: 'Tėvadienis' },
  { value: ENTRY_TYPES.ILLNESS, label: 'Liga' },
]);

export function isIllnessEntry(entry) {
  return entry?.entryType === ENTRY_TYPES.ILLNESS;
}

export function isVacationEntry(entry) {
  return entry?.entryType === ENTRY_TYPES.VACATION;
}

export function isParentDayEntry(entry) {
  return entry?.entryType === ENTRY_TYPES.PARENT_DAY;
}

export function getEntryTypeLabel(entryOrType) {
  const value = typeof entryOrType === 'string' ? entryOrType : entryOrType?.entryType;
  return (
    ENTRY_TYPE_OPTIONS.find((option) => option.value === value)?.label || ENTRY_TYPE_OPTIONS[0].label
  );
}
