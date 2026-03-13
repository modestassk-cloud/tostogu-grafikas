export const ENTRY_TYPES = Object.freeze({
  VACATION: 'vacation',
  ILLNESS: 'illness',
});

export const ENTRY_TYPE_OPTIONS = Object.freeze([
  { value: ENTRY_TYPES.VACATION, label: 'Atostogos' },
  { value: ENTRY_TYPES.ILLNESS, label: 'Liga' },
]);

export function isIllnessEntry(entry) {
  return entry?.entryType === ENTRY_TYPES.ILLNESS;
}

export function getEntryTypeLabel(entryOrType) {
  const value = typeof entryOrType === 'string' ? entryOrType : entryOrType?.entryType;
  return (
    ENTRY_TYPE_OPTIONS.find((option) => option.value === value)?.label || ENTRY_TYPE_OPTIONS[0].label
  );
}
