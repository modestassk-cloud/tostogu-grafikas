const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LITHUANIAN_FIXED_HOLIDAYS = Object.freeze([
  '01-01',
  '02-16',
  '03-11',
  '05-01',
  '06-24',
  '07-06',
  '08-15',
  '11-01',
  '11-02',
  '12-24',
  '12-25',
  '12-26',
]);

const holidaysByYearCache = new Map();

export function parseIsoDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, amount) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

export function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function startOfYear(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

export function endOfYear(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 11, 31));
}

export function differenceInDays(startDate, endDate) {
  return Math.floor((endDate.getTime() - startDate.getTime()) / MS_PER_DAY);
}

export function getVisibleRange(anchorDate, viewMode) {
  if (viewMode === 'year') {
    return {
      rangeStart: startOfYear(anchorDate),
      rangeEnd: endOfYear(anchorDate),
    };
  }

  return {
    rangeStart: startOfMonth(anchorDate),
    rangeEnd: endOfMonth(anchorDate),
  };
}

export function enumerateDays(rangeStart, rangeEnd) {
  const days = [];
  let cursor = new Date(rangeStart.getTime());

  while (cursor <= rangeEnd) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return days;
}

export function clampInterval(startDate, endDate, rangeStart, rangeEnd) {
  if (endDate < rangeStart || startDate > rangeEnd) {
    return null;
  }

  const clampedStart = startDate < rangeStart ? rangeStart : startDate;
  const clampedEnd = endDate > rangeEnd ? rangeEnd : endDate;

  return { clampedStart, clampedEnd };
}

export function shiftIsoDate(isoDate, deltaDays) {
  const moved = addDays(parseIsoDate(isoDate), deltaDays);
  return formatIsoDate(moved);
}

export function formatHumanDate(isoDate) {
  return parseIsoDate(isoDate).toLocaleDateString('lt-LT', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  });
}

export function modeLabel(viewMode, anchorDate) {
  if (viewMode === 'year') {
    return String(anchorDate.getUTCFullYear());
  }

  return anchorDate.toLocaleDateString('lt-LT', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function shiftAnchorDate(anchorDate, viewMode, direction) {
  if (viewMode === 'year') {
    return new Date(
      Date.UTC(anchorDate.getUTCFullYear() + direction, anchorDate.getUTCMonth(), 1),
    );
  }

  return new Date(
    Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + direction, 1),
  );
}

export function orderIsoDates(a, b) {
  return a <= b ? [a, b] : [b, a];
}

function computeEasterSundayUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month - 1, day));
}

function getLithuanianHolidaySetForYear(year) {
  const existing = holidaysByYearCache.get(year);
  if (existing) {
    return existing;
  }

  const fixed = LITHUANIAN_FIXED_HOLIDAYS.map((monthDay) => `${year}-${monthDay}`);
  const easterSunday = computeEasterSundayUtc(year);
  const easterMonday = addDays(easterSunday, 1);
  const holidaySet = new Set([...fixed, formatIsoDate(easterSunday), formatIsoDate(easterMonday)]);

  holidaysByYearCache.set(year, holidaySet);
  return holidaySet;
}

export function isWeekendDate(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function isLithuanianHoliday(date) {
  const year = date.getUTCFullYear();
  return getLithuanianHolidaySetForYear(year).has(formatIsoDate(date));
}
