import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clampInterval,
  differenceInDays,
  enumerateDays,
  formatIsoDate,
  getVisibleRange,
  isLithuanianHoliday,
  isWeekendDate,
  modeLabel,
  parseIsoDate,
} from '../utilsDate';
import { getVacationStatusView } from '../vacationStatus';

function assignLanes(items) {
  const laneEndByIndex = [];

  return items
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))
    .map((item) => {
      const start = parseIsoDate(item.startDate).getTime();
      const end = parseIsoDate(item.endDate).getTime();
      let lane = laneEndByIndex.findIndex((laneEnd) => laneEnd < start);

      if (lane === -1) {
        lane = laneEndByIndex.length;
      }

      laneEndByIndex[lane] = end;
      return { ...item, lane };
    });
}

function buildRows(vacations, rangeStart, rangeEnd, dayWidth) {
  const employees = new Map();

  vacations.forEach((vacation) => {
    const key = vacation.employeeName.trim();
    if (!employees.has(key)) {
      employees.set(key, []);
    }
    employees.get(key).push(vacation);
  });

  return Array.from(employees.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'lt'))
    .map(([employeeName, employeeVacations]) => {
      const withLanes = assignLanes(employeeVacations);
      const visibleBars = withLanes
        .map((vacation) => {
          const startDate = parseIsoDate(vacation.startDate);
          const endDate = parseIsoDate(vacation.endDate);
          const clamped = clampInterval(startDate, endDate, rangeStart, rangeEnd);

          if (!clamped) {
            return null;
          }

          const left = differenceInDays(rangeStart, clamped.clampedStart) * dayWidth;
          const width = (differenceInDays(clamped.clampedStart, clamped.clampedEnd) + 1) * dayWidth;

          return {
            vacation,
            lane: vacation.lane,
            left,
            width,
          };
        })
        .filter(Boolean);

      const laneCount = withLanes.reduce((max, item) => Math.max(max, item.lane + 1), 1);

      return {
        employeeName,
        bars: visibleBars,
        laneCount,
      };
    })
    .filter((row) => row.bars.length > 0);
}

function VacationBar({
  bar,
  dayWidth,
  isManager,
  isSelected,
  onSelect,
  onMove,
}) {
  const [dragDeltaDays, setDragDeltaDays] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragDataRef = useRef(null);

  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    const onMouseMove = (event) => {
      if (!dragDataRef.current) return;

      const movedPx = event.clientX - dragDataRef.current.startX;
      const deltaDays = Math.round(movedPx / dayWidth);

      dragDataRef.current.deltaDays = deltaDays;
      setDragDeltaDays(deltaDays);
    };

    const onMouseUp = () => {
      if (dragDataRef.current && dragDataRef.current.deltaDays !== 0) {
        onMove(bar.vacation, dragDataRef.current.deltaDays);
      }

      dragDataRef.current = null;
      setDragDeltaDays(0);
      setIsDragging(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [bar, dayWidth, isDragging, onMove]);

  const handleMouseDown = (event) => {
    if (!isManager) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragDataRef.current = {
      startX: event.clientX,
      deltaDays: 0,
    };

    setIsDragging(true);
  };

  const statusView = getVacationStatusView(bar.vacation);
  const tooltip = `${bar.vacation.employeeName}\n${bar.vacation.startDate} → ${bar.vacation.endDate}\n${statusView.label}`;

  return (
    <button
      type="button"
      className={`vacation-bar status-${statusView.key} ${isSelected ? 'selected' : ''} ${
        isDragging ? 'dragging' : ''
      }`}
      title={tooltip}
      style={{
        left: `${bar.left + dragDeltaDays * dayWidth}px`,
        width: `${bar.width}px`,
        top: `${8 + bar.lane * 34}px`,
      }}
      onMouseDown={handleMouseDown}
      onClick={() => onSelect(bar.vacation)}
    >
      <span>{bar.vacation.employeeName}</span>
    </button>
  );
}

function GanttChart({
  vacations,
  isManager,
  selectedVacationId,
  viewMode,
  anchorDate,
  onViewModeChange,
  onSelectVacation,
  onMoveVacation,
  onShiftRange,
  onJumpToday,
}) {
  const nameColumnWidth = 220;
  const timelineScrollRef = useRef(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);

  const { rangeStart, rangeEnd } = useMemo(
    () => getVisibleRange(anchorDate, viewMode),
    [anchorDate, viewMode],
  );

  const days = useMemo(() => enumerateDays(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const dayMeta = useMemo(
    () =>
      days.map((day, index) => ({
        day,
        index,
        isoDate: formatIsoDate(day),
        isWeekend: isWeekendDate(day),
        isHoliday: isLithuanianHoliday(day),
      })),
    [days],
  );

  useEffect(() => {
    const element = timelineScrollRef.current;
    if (!element) return undefined;

    const updateWidth = () => {
      setTimelineViewportWidth(element.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const dayWidth = useMemo(() => {
    if (viewMode === 'year') {
      return 20;
    }

    if (!timelineViewportWidth) {
      return 34;
    }

    const availableForDays = Math.max(1, timelineViewportWidth - nameColumnWidth - 2);
    const fitWidth = Math.floor(availableForDays / Math.max(days.length, 1));

    return Math.max(8, Math.min(44, fitWidth));
  }, [days.length, timelineViewportWidth, viewMode]);

  const timelineWidth = days.length * dayWidth;
  const showWeekdayLabel = viewMode === 'month' && dayWidth >= 20;

  const visibleVacations = useMemo(() => vacations, [vacations]);
  const overlapRelevantVacations = useMemo(
    () => vacations.filter((vacation) => vacation.status !== 'rejected'),
    [vacations],
  );

  const rows = useMemo(
    () => buildRows(visibleVacations, rangeStart, rangeEnd, dayWidth),
    [dayWidth, rangeEnd, rangeStart, visibleVacations],
  );

  const overlapByDay = useMemo(
    () =>
      dayMeta.map((meta) => {
        return overlapRelevantVacations.reduce((count, vacation) => {
          if (vacation.startDate <= meta.isoDate && vacation.endDate >= meta.isoDate) {
            return count + 1;
          }
          return count;
        }, 0);
      }),
    [dayMeta, overlapRelevantVacations],
  );

  const monthMarkers = useMemo(
    () =>
      dayMeta
        .map(({ day, index }) => ({ day, index }))
        .filter(({ day }) => day.getUTCDate() === 1),
    [dayMeta],
  );

  return (
    <section className="gantt-section">
      <header className="gantt-toolbar">
        <div className="range-controls">
          <button type="button" className="ghost-btn" onClick={() => onShiftRange(-1)}>
            ←
          </button>
          <h2>{modeLabel(viewMode, anchorDate)}</h2>
          <button type="button" className="ghost-btn" onClick={() => onShiftRange(1)}>
            →
          </button>
          <button type="button" className="ghost-btn" onClick={onJumpToday}>
            Šiandien
          </button>
        </div>

        <div className="mode-controls">
          <button
            type="button"
            className={viewMode === 'month' ? 'primary-btn' : 'ghost-btn'}
            onClick={() => onViewModeChange('month')}
          >
            Mėnuo
          </button>
          <button
            type="button"
            className={viewMode === 'year' ? 'primary-btn' : 'ghost-btn'}
            onClick={() => onViewModeChange('year')}
          >
            Metai
          </button>
        </div>
      </header>

      <div className="timeline-scroll" ref={timelineScrollRef}>
        <div style={{ width: `${nameColumnWidth + timelineWidth}px` }}>
          <div className="header-row">
            <div className="name-cell sticky">Darbuotojas</div>
            <div className="header-track" style={{ width: `${timelineWidth}px` }}>
              {dayMeta.map((meta) => {
                const { day, isHoliday, isWeekend } = meta;
                const isMonthStart = day.getUTCDate() === 1;
                const dayKindClass = isHoliday ? 'holiday' : isWeekend ? 'weekend' : '';
                return (
                  <div
                    key={day.toISOString()}
                    className={`day-cell ${isMonthStart ? 'month-start' : ''} ${dayKindClass}`}
                    style={{ width: `${dayWidth}px` }}
                  >
                    {viewMode === 'month' ? (
                      <>
                        <strong>{day.getUTCDate()}</strong>
                        {showWeekdayLabel ? (
                          <span>
                            {day.toLocaleDateString('lt-LT', {
                              weekday: 'short',
                              timeZone: 'UTC',
                            })}
                          </span>
                        ) : null}
                      </>
                    ) : isMonthStart ? (
                      <strong>
                        {day.toLocaleDateString('lt-LT', { month: 'short', timeZone: 'UTC' })}
                      </strong>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="gantt-row overlap-row" style={{ minHeight: '52px' }}>
            <div className="name-cell sticky">Persidengimai</div>
            <div className="overlap-track" style={{ width: `${timelineWidth}px` }}>
              {overlapByDay.map((count, index) => {
                const level = Math.min(count, 4);
                const meta = dayMeta[index];
                const dayKindClass = meta?.isHoliday ? 'holiday' : meta?.isWeekend ? 'weekend' : '';

                return (
                  <div
                    key={`overlap-${index}`}
                    className={`overlap-cell level-${level} ${dayKindClass}`}
                    style={{ width: `${dayWidth}px` }}
                  >
                    {count > 1 ? count : ''}
                  </div>
                );
              })}
            </div>
          </div>

          {rows.length ? (
            rows.map((row) => {
              const rowHeight = Math.max(50, row.laneCount * 34 + 12);

              return (
                <div key={row.employeeName} className="gantt-row" style={{ minHeight: `${rowHeight}px` }}>
                  <div className="name-cell sticky">
                    <span>{row.employeeName}</span>
                    <small>{row.bars.length} įraš.</small>
                  </div>

                  <div
                    className="timeline-track"
                    style={{
                      width: `${timelineWidth}px`,
                      backgroundSize: `${dayWidth}px 100%`,
                    }}
                  >
                    <div className="day-bg-layer">
                      {dayMeta.map((meta) => {
                        const dayKindClass = meta.isHoliday ? 'holiday' : meta.isWeekend ? 'weekend' : '';
                        return (
                          <div
                            key={`bg-${row.employeeName}-${meta.isoDate}`}
                            className={`day-bg-cell ${dayKindClass}`}
                            style={{
                              left: `${meta.index * dayWidth}px`,
                              width: `${dayWidth}px`,
                            }}
                          />
                        );
                      })}
                    </div>

                    {monthMarkers.map(({ index }) => (
                      <div
                        key={`marker-${row.employeeName}-${index}`}
                        className="month-marker"
                        style={{ left: `${index * dayWidth}px` }}
                      />
                    ))}

                    {row.bars.map((bar) => (
                      <VacationBar
                        key={bar.vacation.id}
                        bar={bar}
                        dayWidth={dayWidth}
                        isManager={isManager}
                        isSelected={selectedVacationId === bar.vacation.id}
                        onSelect={onSelectVacation}
                        onMove={onMoveVacation}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="gantt-empty">
              Šiame intervale dar nėra atostogų įrašų.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default GanttChart;
