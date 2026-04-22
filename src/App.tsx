import * as htmlToImage from 'html-to-image';
import JSZip from 'jszip';
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import * as XLSX from 'xlsx';

type WeekFormState = {
  totalTime: string;
  z3Time: string;
  z2Time: string;
  elevation: string;
  longRunPercent: string;
};

type ParsedWeek = {
  week: number;
  totalMinutes: number;
  z1Minutes: number;
  z2Minutes: number;
  z3Minutes: number;
  longRunMinutes: number;
  elevationMeters: number;
  errors: string[];
};

type EventGrade = '' | 'A' | 'B' | 'C';

type WeekEvent = {
  eventName: string;
  eventGrade: EventGrade;
};

type FocusRow = {
  id: string;
  label: string;
  abbreviation: string;
  isCustom: boolean;
};

type PhaseBlock = {
  id: string;
  label: string;
  abbreviation: string;
  startWeekIndex: number;
  endWeekIndex: number;
};

type WeekColumn = {
  startDate: Date | null;
  weeksToRace: number;
  isRaceWeek: boolean;
};

type WeekDesignState = {
  raceDate: string;
  events: WeekEvent[];
  focusRows: FocusRow[];
  focusSelections: Record<string, boolean[]>;
  phaseBlocks: PhaseBlock[];
};

type DayWorkout = {
  recovery: boolean;
  totalTime: string;
  z3Time: string;
  z2Time: string;
  elevation: string;
  notes: string;
};

type ParsedDayWorkout = {
  totalMinutes: number;
  z1Minutes: number;
  z2Minutes: number;
  z3Minutes: number;
  elevationMeters: number;
  errors: string[];
};

type WeekScheduleSummary = {
  totalMinutes: number;
  z1Minutes: number;
  z2Minutes: number;
  z3Minutes: number;
  elevationMeters: number;
  workoutCount: number;
};

type PlannerTab = 'volume' | 'week' | 'calendar';

type PlannerSnapshot = {
  version: number;
  activeTab: PlannerTab;
  weeksInput: string;
  weeks: WeekFormState[];
  weekDesign: WeekDesignState;
  scheduledWorkouts: Record<string, DayWorkout>;
};

export {
  sanitizePlannerSnapshot,
};

const EMPTY_WEEK: WeekFormState = {
  totalTime: '',
  z3Time: '',
  z2Time: '',
  elevation: '',
  longRunPercent: '',
};

const EMPTY_EVENT: WeekEvent = {
  eventName: '',
  eventGrade: '',
};

const EMPTY_DAY_WORKOUT: DayWorkout = {
  recovery: false,
  totalTime: '',
  z3Time: '',
  z2Time: '',
  elevation: '',
  notes: '',
};

const DEFAULT_WEEK_COUNT = 6;
const LEFT_AXIS_TICKS = 5;
const RIGHT_AXIS_TICKS = 5;
const DEFAULT_FOCUS_ROWS: FocusRow[] = [
  { id: 'recovery', label: 'Recovery', abbreviation: 'R', isCustom: false },
  { id: 'z1-focus', label: 'Z1', abbreviation: 'Z1', isCustom: false },
  { id: 'z2-focus', label: 'Z2', abbreviation: 'Z2', isCustom: false },
  { id: 'z3-focus', label: 'Z3', abbreviation: 'Z3', isCustom: false },
  { id: 'cross-training', label: 'Cross Training', abbreviation: 'XT', isCustom: false },
  { id: 'strength', label: 'Strength', abbreviation: 'ST', isCustom: false },
  { id: 'taper', label: 'Taper', abbreviation: 'TA', isCustom: false },
  { id: 'testing', label: 'Testing', abbreviation: 'TA', isCustom: false },
];

const COLORS = {
  z1: '#9bd2ff',
  z2: '#ffe38a',
  z3: '#ffb3ad',
  longRun: '#2c9d62',
  elevation: '#ba36f5',
  eventGradeA: 'rgba(255, 140, 140, 0.2)',
  eventGradeB: 'rgba(255, 227, 138, 0.24)',
  eventGradeC: 'rgba(126, 214, 153, 0.22)',
  grid: '#d8dccf',
  axis: '#526052',
  text: '#223021',
};

function getEventGradeBandColor(grade: EventGrade): string | null {
  if (grade === 'A') {
    return COLORS.eventGradeA;
  }

  if (grade === 'B') {
    return COLORS.eventGradeB;
  }

  if (grade === 'C') {
    return COLORS.eventGradeC;
  }

  return null;
}

function sanitizeAbbreviation(value: unknown): string {
  return sanitizeString(value).trim().slice(0, 2).toUpperCase();
}

function getDefaultFocusAbbreviation(id: string, label: string): string {
  const matchedDefault = DEFAULT_FOCUS_ROWS.find((row) => row.id === id || row.label === label);
  return matchedDefault?.abbreviation ?? '';
}

function resizeWeeks(count: number, previous: WeekFormState[]): WeekFormState[] {
  return Array.from({ length: count }, (_, index) => previous[index] ?? { ...EMPTY_WEEK });
}

function resizeBooleanSelections(count: number, previous: boolean[] = []): boolean[] {
  return Array.from({ length: count }, (_, index) => previous[index] ?? false);
}

function createInitialWeekDesign(count: number): WeekDesignState {
  return {
    raceDate: '',
    events: Array.from({ length: count }, () => ({ ...EMPTY_EVENT })),
    focusRows: DEFAULT_FOCUS_ROWS.map((row) => ({ ...row })),
    focusSelections: Object.fromEntries(
      DEFAULT_FOCUS_ROWS.map((row) => [row.id, resizeBooleanSelections(count)]),
    ),
    phaseBlocks: [],
  };
}

function resizeWeekDesign(count: number, previous: WeekDesignState): WeekDesignState {
  const safeCount = Math.max(count, 0);

  return {
    ...previous,
    events: Array.from({ length: safeCount }, (_, index) => previous.events[index] ?? { ...EMPTY_EVENT }),
    focusSelections: Object.fromEntries(
      previous.focusRows.map((row) => [
        row.id,
        resizeBooleanSelections(safeCount, previous.focusSelections[row.id]),
      ]),
    ),
    phaseBlocks:
      safeCount === 0
        ? []
        : previous.phaseBlocks.map((block) => {
            const startWeekIndex = clamp(block.startWeekIndex, 0, safeCount - 1);
            const endWeekIndex = clamp(block.endWeekIndex, startWeekIndex, safeCount - 1);

            return {
              ...block,
              startWeekIndex,
              endWeekIndex,
            };
          }),
  };
}

function parseWeekCount(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(parsed, 52);
}

function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return 0;
  }

  const match = trimmed.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i);

  if (!match || (!match[1] && !match[2])) {
    return null;
  }

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function parseNonNegativeNumber(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return 0;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes <= 0) {
    return '0m';
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function formatMeters(value: number): string {
  return `${Math.round(value)} m`;
}

function formatPercent(value: number): string {
  return `${roundToOneDecimal(value)}%`;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatCalendarDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateRange(startDate: Date, endDate: Date): string {
  return `${startDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} - ${endDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sanitizeBoolean(value: unknown): boolean {
  return value === true;
}

function sanitizeWeekForm(value: unknown): WeekFormState {
  return {
    totalTime: isRecord(value) ? sanitizeString(value.totalTime) : '',
    z3Time: isRecord(value) ? sanitizeString(value.z3Time) : '',
    z2Time: isRecord(value) ? sanitizeString(value.z2Time) : '',
    elevation: isRecord(value) ? sanitizeString(value.elevation) : '',
    longRunPercent: isRecord(value) ? sanitizeString(value.longRunPercent) : '',
  };
}

function sanitizeWeekEvent(value: unknown): WeekEvent {
  const grade = isRecord(value) ? sanitizeString(value.eventGrade) : '';

  return {
    eventName: isRecord(value) ? sanitizeString(value.eventName) : '',
    eventGrade: grade === 'A' || grade === 'B' || grade === 'C' ? grade : '',
  };
}

function sanitizeFocusRow(value: unknown, index: number): FocusRow {
  const id =
    isRecord(value) && sanitizeString(value.id)
      ? sanitizeString(value.id)
      : `focus-upload-${index + 1}`;
  const label =
    isRecord(value) && sanitizeString(value.label)
      ? sanitizeString(value.label)
      : `Custom ${index + 1}`;

  return {
    id,
    label,
    abbreviation: isRecord(value)
      ? sanitizeAbbreviation(value.abbreviation) || getDefaultFocusAbbreviation(id, label)
      : '',
    isCustom: isRecord(value) ? sanitizeBoolean(value.isCustom) : true,
  };
}

function sanitizePhaseBlock(
  value: unknown,
  index: number,
  weekCount: number,
): PhaseBlock | null {
  if (!isRecord(value) || weekCount <= 0) {
    return null;
  }

  const rawStart = Number.parseInt(String(value.startWeekIndex ?? ''), 10);
  const rawEnd = Number.parseInt(String(value.endWeekIndex ?? ''), 10);
  const startWeekIndex = Number.isNaN(rawStart) ? 0 : clamp(rawStart, 0, weekCount - 1);
  const endWeekIndex = Number.isNaN(rawEnd)
    ? startWeekIndex
    : clamp(rawEnd, startWeekIndex, weekCount - 1);

  return {
    id: sanitizeString(value.id) || `phase-upload-${index + 1}`,
    label: sanitizeString(value.label),
    abbreviation: sanitizeAbbreviation(value.abbreviation),
    startWeekIndex,
    endWeekIndex,
  };
}

function sanitizeDayWorkout(value: unknown): DayWorkout {
  return {
    recovery: isRecord(value) ? sanitizeBoolean(value.recovery) : false,
    totalTime: isRecord(value) ? sanitizeString(value.totalTime) : '',
    z3Time: isRecord(value) ? sanitizeString(value.z3Time) : '',
    z2Time: isRecord(value) ? sanitizeString(value.z2Time) : '',
    elevation: isRecord(value) ? sanitizeString(value.elevation) : '',
    notes: isRecord(value) ? sanitizeString(value.notes) : '',
  };
}

function sanitizeWeekDesignState(value: unknown, weekCount: number): WeekDesignState {
  const baseState = createInitialWeekDesign(weekCount);

  if (!isRecord(value)) {
    return baseState;
  }

  const uploadedFocusRows = Array.isArray(value.focusRows)
    ? value.focusRows.map(sanitizeFocusRow)
    : [];
  const focusRows = uploadedFocusRows.length > 0 ? uploadedFocusRows : baseState.focusRows;
  const focusSelectionsSource = isRecord(value.focusSelections) ? value.focusSelections : {};

  return {
    raceDate: sanitizeString(value.raceDate),
    events: Array.from({ length: weekCount }, (_, index) =>
      sanitizeWeekEvent(Array.isArray(value.events) ? value.events[index] : undefined),
    ),
    focusRows,
    focusSelections: Object.fromEntries(
      focusRows.map((row) => [
        row.id,
        resizeBooleanSelections(
          weekCount,
          Array.isArray(focusSelectionsSource[row.id])
            ? (focusSelectionsSource[row.id] as unknown[]).map(sanitizeBoolean)
            : [],
        ),
      ]),
    ),
    phaseBlocks: Array.isArray(value.phaseBlocks)
      ? value.phaseBlocks
          .map((block, index) => sanitizePhaseBlock(block, index, weekCount))
          .filter((block): block is PhaseBlock => block !== null)
      : [],
  };
}

function sanitizeScheduledWorkouts(value: unknown): Record<string, DayWorkout> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key))
      .map(([key, workout]) => [key, sanitizeDayWorkout(workout)]),
  );
}

function sanitizePlannerSnapshot(value: unknown): PlannerSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const uploadedWeeks = Array.isArray(value.weeks) ? value.weeks.map(sanitizeWeekForm) : [];
  const uploadedWeekDesign = isRecord(value.weekDesign) ? value.weekDesign : {};
  const uploadedEventsLength = Array.isArray(uploadedWeekDesign.events)
    ? uploadedWeekDesign.events.length
    : 0;
  const uploadedFocusSelectionLengths = isRecord(uploadedWeekDesign.focusSelections)
    ? Object.values(uploadedWeekDesign.focusSelections).map((selection) =>
        Array.isArray(selection) ? selection.length : 0,
      )
    : [];
  const inferredWeekCount = Math.max(
    uploadedWeeks.length,
    uploadedEventsLength,
    ...uploadedFocusSelectionLengths,
  );
  const rawWeeksInput = sanitizeString(value.weeksInput);
  const parsedWeeksInputCount = parseWeekCount(rawWeeksInput);
  const weekCount =
    rawWeeksInput.trim() === '' || parsedWeeksInputCount === 0
      ? inferredWeekCount
      : parsedWeeksInputCount;
  const activeTab = sanitizeString(value.activeTab);
  const normalizedWeeksInput = rawWeeksInput.trim() === '' ? String(weekCount) : rawWeeksInput;

  return {
    version: Number.parseInt(String(value.version ?? '1'), 10) || 1,
    activeTab:
      activeTab === 'volume' || activeTab === 'week' || activeTab === 'calendar'
        ? activeTab
        : 'week',
    weeksInput: normalizedWeeksInput,
    weeks: resizeWeeks(weekCount, uploadedWeeks),
    weekDesign: sanitizeWeekDesignState(value.weekDesign, weekCount),
    scheduledWorkouts: sanitizeScheduledWorkouts(value.scheduledWorkouts),
  };
}

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  next.setDate(next.getDate() + diff);
  next.setHours(12, 0, 0, 0);

  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);

  next.setDate(next.getDate() + days);

  return next;
}

function getWeekColumns(weekCount: number, raceDate: string): WeekColumn[] {
  if (weekCount === 0) {
    return [];
  }

  let raceWeekStart: Date | null = null;

  if (raceDate) {
    const parsedRaceDate = new Date(`${raceDate}T12:00:00`);

    if (!Number.isNaN(parsedRaceDate.getTime())) {
      raceWeekStart = startOfWeek(parsedRaceDate);
    }
  }

  return Array.from({ length: weekCount }, (_, index) => ({
    startDate: raceWeekStart ? addDays(raceWeekStart, -(weekCount - 1 - index) * 7) : null,
    weeksToRace: weekCount - 1 - index,
    isRaceWeek: index === weekCount - 1,
  }));
}

function formatWeekStart(date: Date | null): string {
  if (!date) {
    return 'Set race date';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getWeekDates(startDate: Date | null): Date[] {
  if (!startDate) {
    return [];
  }

  return Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
}

function hasDayWorkoutContent(workout: DayWorkout): boolean {
  if (workout.recovery) {
    return true;
  }

  return (
    workout.totalTime.trim() !== '' ||
    workout.z3Time.trim() !== '' ||
    workout.z2Time.trim() !== '' ||
    workout.elevation.trim() !== '' ||
    workout.notes.trim() !== ''
  );
}

function deriveDayWorkout(workout: DayWorkout): ParsedDayWorkout {
  if (workout.recovery) {
    return {
      totalMinutes: 0,
      z1Minutes: 0,
      z2Minutes: 0,
      z3Minutes: 0,
      elevationMeters: 0,
      errors: [],
    };
  }

  const errors: string[] = [];
  const totalMinutes = parseTimeInput(workout.totalTime);
  const z3Minutes = parseTimeInput(workout.z3Time);
  const z2Minutes = parseTimeInput(workout.z2Time);
  const elevationMeters = parseNonNegativeNumber(workout.elevation);

  if (totalMinutes === null) {
    errors.push('Time must use the format Xh Ym.');
  }

  if (z3Minutes === null) {
    errors.push('Time in Z3 must use the format Xh Ym.');
  }

  if (z2Minutes === null) {
    errors.push('Time in Z2 must use the format Xh Ym.');
  }

  if (elevationMeters === null) {
    errors.push('Elevation must be a non-negative number.');
  }

  const safeTotal = totalMinutes ?? 0;
  const safeZ3 = z3Minutes ?? 0;
  const safeZ2 = z2Minutes ?? 0;
  const safeElevation = elevationMeters ?? 0;

  if (safeZ2 + safeZ3 > safeTotal) {
    errors.push('Time in Z2 + Z3 cannot exceed total time.');
  }

  const validStack = safeZ2 + safeZ3 <= safeTotal;

  return {
    totalMinutes: validStack ? safeTotal : 0,
    z1Minutes: validStack ? safeTotal - safeZ2 - safeZ3 : 0,
    z2Minutes: validStack ? safeZ2 : 0,
    z3Minutes: validStack ? safeZ3 : 0,
    elevationMeters: safeElevation,
    errors,
  };
}

function summarizeWeekSchedule(
  weekDates: Date[],
  workoutsByDate: Record<string, DayWorkout>,
): WeekScheduleSummary {
  return weekDates.reduce(
    (summary, date) => {
      const workout = workoutsByDate[formatDateKey(date)];

      if (!workout || !hasDayWorkoutContent(workout)) {
        return summary;
      }

      const parsedWorkout = deriveDayWorkout(workout);

      return {
        totalMinutes: summary.totalMinutes + parsedWorkout.totalMinutes,
        z1Minutes: summary.z1Minutes + parsedWorkout.z1Minutes,
        z2Minutes: summary.z2Minutes + parsedWorkout.z2Minutes,
        z3Minutes: summary.z3Minutes + parsedWorkout.z3Minutes,
        elevationMeters: summary.elevationMeters + parsedWorkout.elevationMeters,
        workoutCount: summary.workoutCount + 1,
      };
    },
    {
      totalMinutes: 0,
      z1Minutes: 0,
      z2Minutes: 0,
      z3Minutes: 0,
      elevationMeters: 0,
      workoutCount: 0,
    },
  );
}

function buildSummaryLines(
  summary: Pick<
    WeekScheduleSummary | ParsedWeek,
    'totalMinutes' | 'z1Minutes' | 'z2Minutes' | 'z3Minutes' | 'elevationMeters'
  >,
  extraLine?: string,
): string[] {
  const lines = [
    `Total ${formatMinutes(summary.totalMinutes)}`,
    `Z1 ${formatMinutes(summary.z1Minutes)}`,
    `Z2 ${formatMinutes(summary.z2Minutes)}`,
    `Z3 ${formatMinutes(summary.z3Minutes)}`,
    `Elev ${formatMeters(summary.elevationMeters)}`,
  ];

  if (extraLine) {
    lines.push(extraLine);
  }

  return lines;
}

function buildCalendarDayCellText(date: Date, workout?: DayWorkout): string {
  const lines = [formatShortDate(date)];

  if (!workout || !hasDayWorkoutContent(workout)) {
    lines.push('No workout');
    return lines.join('\n');
  }

  if (workout.recovery) {
    lines.push('Recovery');
  } else {
    const parsedWorkout = deriveDayWorkout(workout);
    lines.push(`Total ${formatMinutes(parsedWorkout.totalMinutes)}`);
    lines.push(`Z1 ${formatMinutes(parsedWorkout.z1Minutes)}`);
    lines.push(`Z2 ${formatMinutes(parsedWorkout.z2Minutes)}`);
    lines.push(`Z3 ${formatMinutes(parsedWorkout.z3Minutes)}`);
    lines.push(`Elev ${formatMeters(parsedWorkout.elevationMeters)}`);
  }

  if (workout.notes.trim()) {
    lines.push(`Notes: ${workout.notes.trim()}`);
  }

  return lines.join('\n');
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function readTextFromFile(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the selected file.'));
    reader.readAsText(file);
  });
}

function buildMonthSegments(columns: WeekColumn[]): Array<{ label: string; span: number }> {
  if (columns.length === 0) {
    return [];
  }

  if (!columns.some((column) => column.startDate)) {
    return [{ label: 'Planned Weeks', span: columns.length }];
  }

  const segments: Array<{ label: string; span: number }> = [];

  columns.forEach((column) => {
    const label = column.startDate
      ? column.startDate.toLocaleDateString(undefined, { month: 'long' })
      : 'TBD';
    const previousSegment = segments.at(-1);

    if (previousSegment?.label === label) {
      previousSegment.span += 1;
      return;
    }

    segments.push({ label, span: 1 });
  });

  return segments;
}

function buildPhaseSegments(
  weekCount: number,
  phaseBlocks: PhaseBlock[],
): Array<{ label: string; abbreviation: string; span: number; isEmpty: boolean }> {
  if (weekCount === 0) {
    return [];
  }

  const assignedPhases = Array.from({ length: weekCount }, () => ({ label: '', abbreviation: '' }));

  phaseBlocks.forEach((block) => {
    const label = block.label.trim();
    const abbreviation = block.abbreviation.trim();

    for (let weekIndex = block.startWeekIndex; weekIndex <= block.endWeekIndex; weekIndex += 1) {
      assignedPhases[weekIndex] = { label, abbreviation };
    }
  });

  const segments: Array<{ label: string; abbreviation: string; span: number; isEmpty: boolean }> = [];

  assignedPhases.forEach(({ label, abbreviation }) => {
    const previousSegment = segments.at(-1);

    if (
      previousSegment &&
      previousSegment.label === label &&
      previousSegment.abbreviation === abbreviation
    ) {
      previousSegment.span += 1;
      return;
    }

    segments.push({
      label,
      abbreviation,
      span: 1,
      isEmpty: label === '',
    });
  });

  return segments;
}

function buildTickValues(maxValue: number, tickCount: number): number[] {
  const safeMax = maxValue <= 0 ? 1 : maxValue;
  const values = [];

  for (let index = 0; index <= tickCount; index += 1) {
    values.push((safeMax / tickCount) * index);
  }

  return values;
}

function getNiceAxisMax(value: number): number {
  if (value <= 0) {
    return 100;
  }

  const roughStep = value / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;

  let step = magnitude;

  if (normalized > 5) {
    step = 10 * magnitude;
  } else if (normalized > 2) {
    step = 5 * magnitude;
  } else if (normalized > 1) {
    step = 2 * magnitude;
  }

  return step * 5;
}

function buildPolyline(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function deriveWeek(week: WeekFormState, index: number): ParsedWeek {
  const errors: string[] = [];

  const totalMinutes = parseTimeInput(week.totalTime);
  const z3Minutes = parseTimeInput(week.z3Time);
  const z2Minutes = parseTimeInput(week.z2Time);
  const elevationMeters = parseNonNegativeNumber(week.elevation);
  const longRunPercent = parseNonNegativeNumber(week.longRunPercent);

  if (totalMinutes === null) {
    errors.push('Total time must use the format Xh Ym.');
  }

  if (z3Minutes === null) {
    errors.push('Z3 time must use the format Xh Ym.');
  }

  if (z2Minutes === null) {
    errors.push('Z2 time must use the format Xh Ym.');
  }

  if (elevationMeters === null) {
    errors.push('Elevation must be a non-negative number.');
  }

  if (longRunPercent === null || longRunPercent > 100) {
    errors.push('Long run time must be between 0 and 100.');
  }

  const safeTotal = totalMinutes ?? 0;
  const safeZ3 = z3Minutes ?? 0;
  const safeZ2 = z2Minutes ?? 0;
  const safeElevation = elevationMeters ?? 0;
  const safeLongRunPercent = longRunPercent ?? 0;

  if (safeZ2 + safeZ3 > safeTotal) {
    errors.push('Z2 + Z3 cannot exceed the total time.');
  }

  const validStack = safeZ2 + safeZ3 <= safeTotal;
  const z1Minutes = validStack ? safeTotal - safeZ2 - safeZ3 : 0;
  const longRunMinutes = roundToOneDecimal((safeTotal * safeLongRunPercent) / 100);

  return {
    week: index + 1,
    totalMinutes: validStack ? safeTotal : 0,
    z1Minutes,
    z2Minutes: validStack ? safeZ2 : 0,
    z3Minutes: validStack ? safeZ3 : 0,
    longRunMinutes: validStack ? longRunMinutes : 0,
    elevationMeters: safeElevation,
    errors,
  };
}

function getPrescribedWeek(parsedWeeks: ParsedWeek[], weekIndex: number): ParsedWeek {
  return parsedWeeks[weekIndex] ?? deriveWeek({ ...EMPTY_WEEK }, weekIndex);
}

function getRoundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  options: { roundTop?: boolean; roundBottom?: boolean } = {},
) {
  if (height <= 0 || width <= 0) {
    return '';
  }

  const roundTop = options.roundTop ?? false;
  const roundBottom = options.roundBottom ?? false;
  const safeRadius = Math.min(radius, width / 2, height / 2);
  const topRadius = roundTop ? safeRadius : 0;
  const bottomRadius = roundBottom ? safeRadius : 0;
  const right = x + width;
  const bottom = y + height;

  return [
    `M ${x} ${bottom - bottomRadius}`,
    bottomRadius > 0 ? `Q ${x} ${bottom} ${x + bottomRadius} ${bottom}` : `L ${x} ${bottom}`,
    `L ${right - bottomRadius} ${bottom}`,
    bottomRadius > 0 ? `Q ${right} ${bottom} ${right} ${bottom - bottomRadius}` : `L ${right} ${bottom}`,
    `L ${right} ${y + topRadius}`,
    topRadius > 0 ? `Q ${right} ${y} ${right - topRadius} ${y}` : `L ${right} ${y}`,
    `L ${x + topRadius} ${y}`,
    topRadius > 0 ? `Q ${x} ${y} ${x} ${y + topRadius}` : `L ${x} ${y}`,
    'Z',
  ].join(' ');
}

function Chart({
  data,
  eventGrades,
  weekLabels,
  focusAbbreviations,
}: {
  data: ParsedWeek[];
  eventGrades: EventGrade[];
  weekLabels: string[];
  focusAbbreviations: string[][];
}) {
  if (data.length === 0) {
    return (
      <div className="chart-empty">
        Enter a week count to generate the chart and weekly input rows.
      </div>
    );
  }

  const width = 1000;
  const height = 760;
  const maxAbbreviationLines = Math.max(...focusAbbreviations.map((week) => week.length), 0);
  const margin = { top: 80, right: 82, bottom: 78 + maxAbbreviationLines * 14, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const slotWidth = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.max(8, Math.min(34, slotWidth * 0.62));
  const labelStep =
    data.length > 36 ? 6 : data.length > 24 ? 4 : data.length > 16 ? 2 : 1;

  const maxTimeValue = Math.max(...data.map((week) => Math.max(week.totalMinutes, week.longRunMinutes)), 0);
  const maxElevationValue = Math.max(...data.map((week) => week.elevationMeters), 0);

  const timeAxisMax = getNiceAxisMax(maxTimeValue);
  const elevationAxisMax = getNiceAxisMax(maxElevationValue);

  const timeTicks = buildTickValues(timeAxisMax, LEFT_AXIS_TICKS);
  const elevationTicks = buildTickValues(elevationAxisMax, RIGHT_AXIS_TICKS);

  const getX = (index: number) => margin.left + slotWidth * index + slotWidth / 2;
  const getLeftY = (value: number) => margin.top + plotHeight - (value / timeAxisMax) * plotHeight;
  const getRightY = (value: number) => margin.top + plotHeight - (value / elevationAxisMax) * plotHeight;

  const longRunPoints = data.map((week, index) => ({
    x: getX(index),
    y: getLeftY(week.longRunMinutes),
  }));

  const elevationPoints = data.map((week, index) => ({
    x: getX(index),
    y: getRightY(week.elevationMeters),
  }));

  return (
    <div className="chart-frame">
      <svg
        aria-labelledby="training-chart-title"
        className="training-chart"
        height="100%"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        <title id="training-chart-title">Training plan analysis chart</title>

        <g className="chart-legend" transform={`translate(${width / 2 - 200}, 46)`}>
          <LegendSwatch color={COLORS.z1} label="Z1" type="square" x={0} />
          <LegendSwatch color={COLORS.z2} label="Z2" type="square" x={72} />
          <LegendSwatch color={COLORS.z3} label="Z3" type="square" x={144} />
          <LegendSwatch color={COLORS.longRun} label="Long run" type="line" x={216} />
          <LegendSwatch color={COLORS.elevation} label="Elevation" type="line" x={332} />
        </g>

        {data.map((week, index) => {
          const bandColor = getEventGradeBandColor(eventGrades[index] ?? '');

          if (!bandColor) {
            return null;
          }

          return (
            <rect
              fill={bandColor}
              height={plotHeight}
              key={`event-grade-band-${week.week}`}
              width={slotWidth}
              x={margin.left + slotWidth * index}
              y={margin.top}
            />
          );
        })}

        {timeTicks.map((tick) => {
          const y = getLeftY(tick);

          return (
            <g key={`time-${tick}`}>
              <line
                className="chart-grid"
                x1={margin.left}
                x2={width - margin.right}
                y1={y}
                y2={y}
              />
              <text className="axis-label" x={margin.left - 12} y={y + 4}>
                {Math.round(tick)}
              </text>
            </g>
          );
        })}

        <line className="chart-axis" x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} />
        <line
          className="chart-axis"
          x1={width - margin.right}
          x2={width - margin.right}
          y1={margin.top}
          y2={height - margin.bottom}
        />
        <line
          className="chart-axis"
          x1={margin.left}
          x2={width - margin.right}
          y1={height - margin.bottom}
          y2={height - margin.bottom}
        />

        {elevationTicks.map((tick) => {
          const y = getRightY(tick);

          return (
            <text key={`elevation-${tick}`} className="axis-label" x={width - margin.right + 12} y={y + 4}>
              {Math.round(tick)}
            </text>
          );
        })}

        {data.map((week, index) => {
          const x = getX(index);
          const barX = x - barWidth / 2;
          const segmentRadius = 10;
          const z3Top = getLeftY(week.totalMinutes);
          const z3Height = week.totalMinutes === 0 ? 0 : (week.z3Minutes / timeAxisMax) * plotHeight;
          const z2Top = getLeftY(week.z1Minutes + week.z2Minutes);
          const z2Height = week.totalMinutes === 0 ? 0 : (week.z2Minutes / timeAxisMax) * plotHeight;
          const z1Top = getLeftY(week.z1Minutes);
          const z1Height = week.totalMinutes === 0 ? 0 : (week.z1Minutes / timeAxisMax) * plotHeight;
          const showZ1 = z1Height > 0;
          const showZ2 = z2Height > 0;
          const showZ3 = z3Height > 0;

          return (
            <g key={week.week}>
              <path
                d={getRoundedRectPath(barX, z1Top, barWidth, Math.max(z1Height, 0), segmentRadius, {
                  roundTop: showZ1 && !showZ2 && !showZ3,
                  roundBottom: showZ1,
                })}
                fill={COLORS.z1}
              />
              <path
                d={getRoundedRectPath(barX, z2Top, barWidth, Math.max(z2Height, 0), segmentRadius, {
                  roundTop: showZ2 && !showZ3,
                  roundBottom: showZ2 && !showZ1,
                })}
                fill={COLORS.z2}
              />
              <path
                d={getRoundedRectPath(barX, z3Top, barWidth, Math.max(z3Height, 0), segmentRadius, {
                  roundTop: showZ3,
                  roundBottom: showZ3 && !showZ1 && !showZ2,
                })}
                fill={COLORS.z3}
              />
              {index % labelStep === 0 || index === data.length - 1 ? (
                <text className="week-label" x={x} y={height - margin.bottom + 26}>
                  {weekLabels[index] ?? ''}
                </text>
              ) : null}
              {(focusAbbreviations[index] ?? []).map((abbreviation, abbreviationIndex) => (
                <text
                  className="chart-focus-label"
                  key={`${week.week}-focus-${abbreviation}-${abbreviationIndex + 1}`}
                  x={x}
                  y={height - margin.bottom + 42 + abbreviationIndex * 13}
                >
                  {abbreviation}
                </text>
              ))}
            </g>
          );
        })}

        <polyline
          fill="none"
          points={buildPolyline(longRunPoints)}
          stroke={COLORS.longRun}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {longRunPoints.map((point, index) => (
          <circle
            key={`long-run-${data[index].week}`}
            cx={point.x}
            cy={point.y}
            fill={COLORS.longRun}
            r="4"
          />
        ))}

        <polyline
          fill="none"
          points={buildPolyline(elevationPoints)}
          stroke={COLORS.elevation}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {elevationPoints.map((point, index) => (
          <circle
            key={`elevation-${data[index].week}`}
            cx={point.x}
            cy={point.y}
            fill={COLORS.elevation}
            r="4"
          />
        ))}

        <text
          className="axis-title"
          transform={`translate(24 ${margin.top + plotHeight / 2}) rotate(-90)`}
        >
          Time (minutes)
        </text>
        <text
          className="axis-title"
          transform={`translate(${width - 20} ${margin.top + plotHeight / 2}) rotate(90)`}
        >
          Elevation (m)
        </text>
        <text className="axis-title" x={width / 2} y={height - 16}>
          Week
        </text>
      </svg>
    </div>
  );
}

function LegendSwatch({
  color,
  label,
  type,
  x,
}: {
  color: string;
  label: string;
  type: 'square' | 'line';
  x: number;
}) {
  return (
    <g transform={`translate(${x}, 0)`}>
      {type === 'square' ? (
        <rect fill={color} height="10" rx="2" width="18" x="0" y="-8" />
      ) : (
        <>
          <line stroke={color} strokeLinecap="round" strokeWidth="3" x1="0" x2="18" y1="-3" y2="-3" />
          <circle cx="9" cy="-3" fill={color} r="3.5" />
        </>
      )}
      <text className="legend-label" x="26" y="0">
        {label}
      </text>
    </g>
  );
}

export default function App() {
  const weeksInputId = useId();
  const workspaceRef = useRef<HTMLElement | null>(null);
  const idCounterRef = useRef(0);
  const chartExportRef = useRef<HTMLElement | null>(null);
  const weekDesignExportRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [weeksInput, setWeeksInput] = useState(String(DEFAULT_WEEK_COUNT));
  const [weeks, setWeeks] = useState<WeekFormState[]>(() => resizeWeeks(DEFAULT_WEEK_COUNT, []));
  const [weekDesign, setWeekDesign] = useState<WeekDesignState>(() =>
    createInitialWeekDesign(DEFAULT_WEEK_COUNT),
  );
  const [scheduledWorkouts, setScheduledWorkouts] = useState<Record<string, DayWorkout>>({});
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [activeTab, setActiveTab] = useState<PlannerTab>('week');
  const [activeCalendarDate, setActiveCalendarDate] = useState<Date | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<DayWorkout>({ ...EMPTY_DAY_WORKOUT });
  const [calendarDraftErrors, setCalendarDraftErrors] = useState<string[]>([]);
  const [isDownloadingPackage, setIsDownloadingPackage] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const parsedWeekCount = parseWeekCount(weeksInput);

  useEffect(() => {
    startTransition(() => {
      setWeeks((previous) => resizeWeeks(parsedWeekCount, previous));
      setWeekDesign((previous) => resizeWeekDesign(parsedWeekCount, previous));
    });
  }, [parsedWeekCount]);

  const deferredWeeks = useDeferredValue(weeks);
  const parsedWeeks = deferredWeeks.map(deriveWeek);
  const weekColumns = getWeekColumns(parsedWeekCount, weekDesign.raceDate);
  const monthSegments = buildMonthSegments(weekColumns);
  const phaseSegments = buildPhaseSegments(parsedWeekCount, weekDesign.phaseBlocks);
  const chartWeekLabels = weekColumns.map((column) => String(column.weeksToRace));
  const chartFocusAbbreviations = Array.from({ length: parsedWeekCount }, (_, weekIndex) =>
    weekDesign.focusRows
      .filter((row) => weekDesign.focusSelections[row.id][weekIndex] ?? false)
      .map((row) => row.abbreviation.trim())
      .filter(Boolean),
  );
  const invalidWeekCount = weeksInput.trim() !== '' && parsedWeekCount === 0 && weeksInput.trim() !== '0';
  const totalVolumeMinutes = parsedWeeks.reduce((sum, week) => sum + week.totalMinutes, 0);
  const totalZ3Minutes = parsedWeeks.reduce((sum, week) => sum + week.z3Minutes, 0);
  const totalZ2Minutes = parsedWeeks.reduce((sum, week) => sum + week.z2Minutes, 0);
  const totalElevationMeters = parsedWeeks.reduce((sum, week) => sum + week.elevationMeters, 0);
  const z3Share = totalVolumeMinutes > 0 ? (totalZ3Minutes / totalVolumeMinutes) * 100 : 0;
  const z2Share = totalVolumeMinutes > 0 ? (totalZ2Minutes / totalVolumeMinutes) * 100 : 0;
  const activeCalendarDateKey = activeCalendarDate ? formatDateKey(activeCalendarDate) : '';
  const activeCalendarTitle = activeCalendarDate ? formatCalendarDate(activeCalendarDate) : '';

  function updateWeek(index: number, field: keyof WeekFormState, value: string) {
    setWeeks((previous) =>
      previous.map((week, weekIndex) =>
        weekIndex === index ? { ...week, [field]: value } : week,
      ),
    );
  }

  function nextGeneratedId(prefix: string): string {
    idCounterRef.current += 1;
    return `${prefix}-${Date.now()}-${idCounterRef.current}`;
  }

  function updateRaceDate(value: string) {
    setWeekDesign((previous) => ({
      ...previous,
      raceDate: value,
    }));
  }

  function updateWeekEvent(index: number, field: keyof WeekEvent, value: string) {
    setWeekDesign((previous) => ({
      ...previous,
      events: previous.events.map((event, eventIndex) =>
        eventIndex === index ? { ...event, [field]: value } : event,
      ),
    }));
  }

  function addCustomFocusRow() {
    setWeekDesign((previous) => {
      const rowId = nextGeneratedId('focus');
      const row: FocusRow = {
        id: rowId,
        label: `Custom ${previous.focusRows.filter((focusRow) => focusRow.isCustom).length + 1}`,
        abbreviation: '',
        isCustom: true,
      };

      return {
        ...previous,
        focusRows: [...previous.focusRows, row],
        focusSelections: {
          ...previous.focusSelections,
          [rowId]: resizeBooleanSelections(previous.events.length),
        },
      };
    });
  }

  function updateFocusRowLabel(rowId: string, label: string) {
    setWeekDesign((previous) => ({
      ...previous,
      focusRows: previous.focusRows.map((row) =>
        row.id === rowId ? { ...row, label } : row,
      ),
    }));
  }

  function updateFocusRowAbbreviation(rowId: string, abbreviation: string) {
    setWeekDesign((previous) => ({
      ...previous,
      focusRows: previous.focusRows.map((row) =>
        row.id === rowId ? { ...row, abbreviation: sanitizeAbbreviation(abbreviation) } : row,
      ),
    }));
  }

  function removeCustomFocusRow(rowId: string) {
    setWeekDesign((previous) => {
      const nextSelections = { ...previous.focusSelections };
      delete nextSelections[rowId];

      return {
        ...previous,
        focusRows: previous.focusRows.filter((row) => row.id !== rowId),
        focusSelections: nextSelections,
      };
    });
  }

  function toggleFocusCell(rowId: string, weekIndex: number) {
    setWeekDesign((previous) => ({
      ...previous,
      focusSelections: {
        ...previous.focusSelections,
        [rowId]: previous.focusSelections[rowId].map((selected, index) =>
          index === weekIndex ? !selected : selected,
        ),
      },
    }));
  }

  function addPhaseBlock() {
    if (parsedWeekCount === 0) {
      return;
    }

    setWeekDesign((previous) => ({
      ...previous,
      phaseBlocks: [
        ...previous.phaseBlocks,
        {
          id: nextGeneratedId('phase'),
          label: '',
          abbreviation: '',
          startWeekIndex: 0,
          endWeekIndex: Math.min(1, Math.max(parsedWeekCount - 1, 0)),
        },
      ],
    }));
  }

  function updatePhaseBlock(
    blockId: string,
    field: keyof Pick<PhaseBlock, 'label' | 'abbreviation' | 'startWeekIndex' | 'endWeekIndex'>,
    value: string,
  ) {
    setWeekDesign((previous) => ({
      ...previous,
      phaseBlocks: previous.phaseBlocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        if (field === 'label') {
          return {
            ...block,
            label: value,
          };
        }

        if (field === 'abbreviation') {
          return {
            ...block,
            abbreviation: sanitizeAbbreviation(value),
          };
        }

        const numericValue = Number.parseInt(value, 10);

        if (Number.isNaN(numericValue)) {
          return block;
        }

        if (field === 'startWeekIndex') {
          return {
            ...block,
            startWeekIndex: numericValue,
            endWeekIndex: Math.max(block.endWeekIndex, numericValue),
          };
        }

        return {
          ...block,
          endWeekIndex: numericValue,
          startWeekIndex: Math.min(block.startWeekIndex, numericValue),
        };
      }),
    }));
  }

  function removePhaseBlock(blockId: string) {
    setWeekDesign((previous) => ({
      ...previous,
      phaseBlocks: previous.phaseBlocks.filter((block) => block.id !== blockId),
    }));
  }

  function openCalendarDay(date: Date) {
    const dateKey = formatDateKey(date);

    setActiveCalendarDate(date);
    setCalendarDraft(scheduledWorkouts[dateKey] ?? { ...EMPTY_DAY_WORKOUT });
    setCalendarDraftErrors([]);
  }

  function closeCalendarModal() {
    setActiveCalendarDate(null);
    setCalendarDraft({ ...EMPTY_DAY_WORKOUT });
    setCalendarDraftErrors([]);
  }

  function updateCalendarDraft(field: keyof DayWorkout, value: string) {
    setCalendarDraft((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  function toggleCalendarRecovery(checked: boolean) {
    setCalendarDraft((previous) => ({
      ...previous,
      recovery: checked,
      totalTime: checked ? '' : previous.totalTime,
      z3Time: checked ? '' : previous.z3Time,
      z2Time: checked ? '' : previous.z2Time,
      elevation: checked ? '' : previous.elevation,
    }));
    setCalendarDraftErrors([]);
  }

  function clearCalendarDay() {
    if (!activeCalendarDateKey) {
      return;
    }

    setScheduledWorkouts((previous) => {
      const next = { ...previous };
      delete next[activeCalendarDateKey];
      return next;
    });
    closeCalendarModal();
  }

  function saveCalendarDay() {
    if (!activeCalendarDateKey) {
      return;
    }

    const parsedWorkout = deriveDayWorkout(calendarDraft);

    if (parsedWorkout.errors.length > 0) {
      setCalendarDraftErrors(parsedWorkout.errors);
      return;
    }

    if (!hasDayWorkoutContent(calendarDraft)) {
      setScheduledWorkouts((previous) => {
        const next = { ...previous };
        delete next[activeCalendarDateKey];
        return next;
      });
      closeCalendarModal();
      return;
    }

    setScheduledWorkouts((previous) => ({
      ...previous,
      [activeCalendarDateKey]: { ...calendarDraft },
    }));
    closeCalendarModal();
  }

  function buildCalendarWorkbookArray(): Array<Array<string>> {
    return [
      [
        'Week',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
        'Scheduled',
        'Prescribed',
      ],
      ...weekColumns.map((column, weekIndex) => {
        const weekDates = getWeekDates(column.startDate);
        const scheduledSummary = summarizeWeekSchedule(weekDates, scheduledWorkouts);
        const prescribedWeek = getPrescribedWeek(parsedWeeks, weekIndex);

        return [
          `Week ${weekIndex + 1}\n${column.weeksToRace} w to race${
            weekDates.length > 0 ? `\n${formatDateRange(weekDates[0], weekDates[6])}` : ''
          }`,
          ...weekDates.map((date) =>
            buildCalendarDayCellText(date, scheduledWorkouts[formatDateKey(date)]),
          ),
          buildSummaryLines(
            scheduledSummary,
            `Sessions ${scheduledSummary.workoutCount}`,
          ).join('\n'),
          buildSummaryLines(
            prescribedWeek,
            `Long ${formatPercent(
              prescribedWeek.totalMinutes > 0
                ? (prescribedWeek.longRunMinutes / prescribedWeek.totalMinutes) * 100
                : 0,
            )}`,
          ).join('\n'),
        ];
      }),
    ];
  }

  function handleDownloadJson() {
    setDownloadError('');

    const snapshot: PlannerSnapshot = {
      version: 1,
      activeTab,
      weeksInput,
      weeks,
      weekDesign,
      scheduledWorkouts,
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });

    downloadBlob('training-plan-state.json', blob);
  }

  function handleUploadJsonClick() {
    setDownloadError('');
    uploadInputRef.current?.click();
  }

  async function handleUploadJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await readTextFromFile(file)) as unknown;
      const snapshot = sanitizePlannerSnapshot(parsed);

      if (!snapshot) {
        throw new Error('The selected JSON file is not a valid planner state.');
      }

      closeCalendarModal();
      setWeeksInput(snapshot.weeksInput);
      setWeeks(snapshot.weeks);
      setWeekDesign(snapshot.weekDesign);
      setScheduledWorkouts(snapshot.scheduledWorkouts);
      setActiveTab(snapshot.activeTab);
      setDownloadError('');
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : 'Unable to restore planner state from JSON.',
      );
    } finally {
      event.target.value = '';
    }
  }

  async function handleDownloadPackage() {
    if (!chartExportRef.current || !weekDesignExportRef.current) {
      setDownloadError('The export package is not ready yet.');
      return;
    }

    setIsDownloadingPackage(true);
    setDownloadError('');

    try {
      const chartBlob = await htmlToImage.toBlob(chartExportRef.current, {
        backgroundColor: '#275374',
        cacheBust: true,
        pixelRatio: 2,
      });
      const weekDesignBlob = await htmlToImage.toBlob(weekDesignExportRef.current, {
        backgroundColor: '#275374',
        cacheBust: true,
        pixelRatio: 2,
      });

      if (!chartBlob || !weekDesignBlob) {
        throw new Error('Image export failed.');
      }

      const workbook = XLSX.utils.book_new();
      const calendarSheet = XLSX.utils.aoa_to_sheet(buildCalendarWorkbookArray());

      calendarSheet['!cols'] = [
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 20 },
        { wch: 26 },
        { wch: 26 },
      ];

      XLSX.utils.book_append_sheet(workbook, calendarSheet, 'Calendar');

      const workbookBytes = XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'array',
      });

      const zip = new JSZip();

      zip.file('training-plan-chart.png', await chartBlob.arrayBuffer());
      zip.file('week-focus.png', await weekDesignBlob.arrayBuffer());
      zip.file('calendar.xlsx', workbookBytes);

      const zipBlob = await zip.generateAsync({ type: 'blob' });

      downloadBlob('training-plan-package.zip', zipBlob);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : 'Unable to create the download package.',
      );
    } finally {
      setIsDownloadingPackage(false);
    }
  }

  function updateSplitFromClientX(clientX: number) {
    const workspaceBounds = workspaceRef.current?.getBoundingClientRect();

    if (!workspaceBounds) {
      return;
    }

    const nextSplit = ((clientX - workspaceBounds.left) / workspaceBounds.width) * 100;
    setSplitPercent(clamp(nextSplit, 36, 64));
  }

  function beginDividerDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (window.innerWidth <= 920) {
      return;
    }

    setIsDraggingDivider(true);
    updateSplitFromClientX(event.clientX);
  }

  function handleDividerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSplitPercent((current) => clamp(current - 2, 36, 64));
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setSplitPercent((current) => clamp(current + 2, 36, 64));
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setSplitPercent(50);
    }
  }

  useEffect(() => {
    if (!isDraggingDivider) {
      return undefined;
    }

    function handlePointerMove(event: PointerEvent) {
      updateSplitFromClientX(event.clientX);
    }

    function handlePointerUp() {
      setIsDraggingDivider(false);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingDivider]);

  useEffect(() => {
    if (!activeCalendarDate) {
      return undefined;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeCalendarModal();
      }
    }

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [activeCalendarDate]);

  return (
    <>
      <main className="page-shell">
        <section
          className={`workspace ${isDraggingDivider ? 'workspace-dragging' : ''}`}
          ref={workspaceRef}
          style={{ ['--split-percent' as string]: `${splitPercent}%` }}
        >
          <aside className="chart-pane">
          <div className="hero-copy hero-copy-compact">
            <div className="hero-bar">
              <div className="hero-main">
                <h1>Training Plan Builder</h1>
                <div className="hero-notes">
                  <p>
                    Vibe coded by{' '}
                    <a href="https://www.instagram.com/niki.runs/" rel="noreferrer" target="_blank">
                      Niki Micallef
                    </a>{' '}
                    from{' '}
                    <a href="https://bornonthetrail.substack.com/" rel="noreferrer" target="_blank">
                      Born on the Trail
                    </a>
                    .
                  </p>
                  <p>
                    Visit{' '}
                    <a href="https://bornonthetrail.substack.com/" rel="noreferrer" target="_blank">
                      Born on the Trail
                    </a>{' '}
                    for practical training and racing ideas for trail and ultra marathon races.
                  </p>
                  <p>
                    Prefer listening on the run? Tune in on{' '}
                    <a href="https://www.youtube.com/@bornonthetrail" rel="noreferrer" target="_blank">
                      YouTube
                    </a>
                    ,{' '}
                    <a
                      href="https://open.spotify.com/show/6o5yHthUidO0No4VA3xdVb"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Spotify
                    </a>
                    , or{' '}
                    <a
                      href="https://podcasts.apple.com/us/podcast/born-on-the-trail-going-longer/id1857231629"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Apple Podcasts
                    </a>
                    .
                  </p>
                  <p>
                    Need coaching or direct training guidance?{' '}
                    <a
                      href="https://bornonthetrail.substack.com/p/coaching"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Hire me as a coach
                    </a>
                    .
                  </p>
                </div>
              </div>
              <div className="hero-actions">
                <button className="secondary-button" onClick={handleDownloadJson} type="button">
                  Download JSON
                </button>
                <button className="secondary-button" onClick={handleUploadJsonClick} type="button">
                  Upload JSON
                </button>
                <button
                  className="primary-button"
                  disabled={isDownloadingPackage}
                  onClick={handleDownloadPackage}
                  type="button"
                >
                  {isDownloadingPackage ? 'Preparing Package...' : 'Download Package'}
                </button>
              </div>
            </div>
            {downloadError ? <p className="helper-text helper-text-error">{downloadError}</p> : null}
            <input
              accept="application/json,.json"
              className="hidden-file-input"
              onChange={handleUploadJson}
              ref={uploadInputRef}
              type="file"
            />
          </div>

          <section className="panel chart-panel" ref={chartExportRef}>
            <div className="chart-summary-strip">
              <article className="chart-summary-card">
                <span>Total Volume</span>
                <strong>{Math.round(totalVolumeMinutes)} min</strong>
              </article>
              <article className="chart-summary-card">
                <span>Total Time</span>
                <strong>{formatMinutes(totalVolumeMinutes)}</strong>
              </article>
              <article className="chart-summary-card">
                <span>Time in Z3</span>
                <strong>{formatPercent(z3Share)}</strong>
              </article>
              <article className="chart-summary-card">
                <span>Time in Z2</span>
                <strong>{formatPercent(z2Share)}</strong>
              </article>
              <article className="chart-summary-card">
                <span>Total Elevation</span>
                <strong>{formatMeters(totalElevationMeters)}</strong>
              </article>
            </div>
            <Chart
              data={parsedWeeks}
              eventGrades={weekDesign.events.map((event) => event.eventGrade)}
              focusAbbreviations={chartFocusAbbreviations}
              weekLabels={chartWeekLabels}
            />
          </section>
        </aside>

        <div
          aria-label="Resize panels"
          aria-orientation="vertical"
          aria-valuemax={64}
          aria-valuemin={36}
          aria-valuenow={Math.round(splitPercent)}
          className="workspace-divider"
          onDoubleClick={() => setSplitPercent(50)}
          onKeyDown={handleDividerKeyDown}
          onPointerDown={beginDividerDrag}
          role="separator"
          tabIndex={0}
        >
          <span className="workspace-divider-grip" />
        </div>

          <section className="panel form-pane">
          <div className="form-top">
            <div className="tab-bar" role="tablist" aria-label="Planning modes">
              <button
                aria-selected={activeTab === 'week'}
                className={`tab-button ${activeTab === 'week' ? 'tab-button-active' : ''}`}
                onClick={() => setActiveTab('week')}
                role="tab"
                type="button"
              >
                Week Focus
              </button>
              <button
                aria-selected={activeTab === 'volume'}
                className={`tab-button ${activeTab === 'volume' ? 'tab-button-active' : ''}`}
                onClick={() => setActiveTab('volume')}
                role="tab"
                type="button"
              >
                Volume Design
              </button>
              <button
                aria-selected={activeTab === 'calendar'}
                className={`tab-button ${activeTab === 'calendar' ? 'tab-button-active' : ''}`}
                onClick={() => setActiveTab('calendar')}
                role="tab"
                type="button"
              >
                Calendar
              </button>
            </div>

            {activeTab === 'volume' ? (
              <>
                <div className="section-head section-head-form">
                  <div>
                    <p className="eyebrow">Volume Design</p>
                    <h2>Fill the weekly volume targets that drive the chart</h2>
                  </div>
                  <p className="section-note">
                    Week count now comes from Week Focus. Blank values render as zero. If Z2 + Z3
                    is greater than total time, that week is flagged and removed from the stacked
                    bar until corrected.
                  </p>
                </div>

                <div className="planner-toolbar">
                  <div className="planner-chip">
                    <span>Weeks in plan</span>
                    <strong>{parsedWeekCount}</strong>
                  </div>
                  <div className="planner-chip">
                    <span>Race date</span>
                    <strong>{weekDesign.raceDate || 'Set in Week Focus'}</strong>
                  </div>
                </div>
                <p className="helper-text">
                  Enter the weekly targets here after setting the plan length in Week Focus.
                </p>
              </>
            ) : activeTab === 'week' ? (
              <>
                <div className="planner-toolbar">
                  <label className="field-group" htmlFor={weeksInputId}>
                    <span className="field-label">Weeks</span>
                    <input
                      className="text-input weeks-input"
                      id={weeksInputId}
                      inputMode="numeric"
                      max={52}
                      min={0}
                      onChange={(event) => setWeeksInput(event.target.value)}
                      type="number"
                      value={weeksInput}
                    />
                  </label>
                  <label className="field-group" htmlFor="race-date">
                    <span className="field-label">Race Date</span>
                    <input
                      className="text-input"
                      id="race-date"
                      onChange={(event) => updateRaceDate(event.target.value)}
                      type="date"
                      value={weekDesign.raceDate}
                    />
                  </label>
                </div>
                {invalidWeekCount ? (
                  <p className="helper-text helper-text-error">Use a whole number from 0 to 52.</p>
                ) : null}
              </>
            ) : (
              <>
                <div className="section-head section-head-form">
                  <div>
                    <p className="eyebrow">Calendar</p>
                    <h2>Schedule daily sessions against each race week</h2>
                  </div>
                  <p className="section-note">
                    Click any date to log a workout. Scheduled totals roll up from the daily
                    entries, while Prescribed stays fixed from Volume Design.
                  </p>
                </div>

                <div className="planner-toolbar">
                  <div className="planner-chip">
                    <span>Weeks in plan</span>
                    <strong>{parsedWeekCount}</strong>
                  </div>
                  <div className="planner-chip">
                    <span>Race date</span>
                    <strong>{weekDesign.raceDate || 'Set in Week Focus'}</strong>
                  </div>
                </div>
                <p className="helper-text">
                  Calendar weeks are Monday to Sunday. Use Week Focus to change the race date
                  driving this timeline.
                </p>
              </>
            )}
          </div>

          {activeTab === 'volume' ? (
            weeks.length === 0 ? (
              <div className="empty-state">
                Set a positive week count in Week Focus to generate the input grid.
              </div>
            ) : (
              <div className="weeks-grid">
                {weeks.map((week, index) => {
                  const parsedWeek = deriveWeek(week, index);

                  return (
                    <article className="week-card" key={`week-${index + 1}`}>
                      <div className="week-card-header">
                        <div>
                          <p className="week-kicker">Week {index + 1}</p>
                          <h3>{formatMinutes(parsedWeek.totalMinutes)}</h3>
                        </div>
                        <span className="week-badge">Z1: {formatMinutes(parsedWeek.z1Minutes)}</span>
                      </div>

                      <div className="week-fields">
                        <label className="field-group">
                          <span className="field-label">Total Time</span>
                          <input
                            className="text-input"
                            onChange={(event) => updateWeek(index, 'totalTime', event.target.value)}
                            type="text"
                            value={week.totalTime}
                          />
                        </label>

                        <label className="field-group">
                          <span className="field-label">Z3 Time</span>
                          <input
                            className="text-input"
                            onChange={(event) => updateWeek(index, 'z3Time', event.target.value)}
                            type="text"
                            value={week.z3Time}
                          />
                        </label>

                        <label className="field-group">
                          <span className="field-label">Z2 Time</span>
                          <input
                            className="text-input"
                            onChange={(event) => updateWeek(index, 'z2Time', event.target.value)}
                            type="text"
                            value={week.z2Time}
                          />
                        </label>

                        <label className="field-group">
                          <span className="field-label">Elevation (m)</span>
                          <input
                            className="text-input"
                            min={0}
                            onChange={(event) => updateWeek(index, 'elevation', event.target.value)}
                            type="number"
                            value={week.elevation}
                          />
                        </label>

                        <label className="field-group">
                          <span className="field-label">Long Run (%)</span>
                          <input
                            className="text-input"
                            max={100}
                            min={0}
                            onChange={(event) =>
                              updateWeek(index, 'longRunPercent', event.target.value)
                            }
                            type="number"
                            value={week.longRunPercent}
                          />
                        </label>
                      </div>

                      <div className="week-metrics">
                        <span>Long run: {formatMinutes(parsedWeek.longRunMinutes)}</span>
                        <span>Elevation: {formatMeters(parsedWeek.elevationMeters)}</span>
                      </div>

                      {parsedWeek.errors.length > 0 ? (
                        <ul className="error-list">
                          {parsedWeek.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )
          ) : activeTab === 'week' ? (
            <div className="week-design-layout">
              {parsedWeekCount === 0 ? (
                <div className="empty-state">
                  Set a positive week count in Week Focus to build the week planner.
                </div>
              ) : (
                <>
                  <section className="planner-panel">
                    <div className="planner-panel-head">
                      <p className="eyebrow">Phase Goals</p>
                      <button className="secondary-button" onClick={addPhaseBlock} type="button">
                        Add Phase Goal
                      </button>
                    </div>

                    {weekDesign.phaseBlocks.length === 0 ? (
                      <div className="planner-empty-line">
                        No phase blocks yet. Add one to paint the Phase Goal row across multiple
                        weeks.
                      </div>
                    ) : (
                      <div className="phase-block-list">
                        {weekDesign.phaseBlocks.map((block) => (
                          <article className="phase-block-card" key={block.id}>
                            <label className="field-group">
                              <span className="field-label">Phase Goal</span>
                              <input
                                className="text-input"
                                onChange={(event) =>
                                  updatePhaseBlock(block.id, 'label', event.target.value)
                                }
                                placeholder="Tempo"
                                type="text"
                                value={block.label}
                              />
                            </label>

                            <label className="field-group">
                              <span className="field-label">From</span>
                              <select
                                className="text-input"
                                onChange={(event) =>
                                  updatePhaseBlock(block.id, 'startWeekIndex', event.target.value)
                                }
                                value={block.startWeekIndex}
                              >
                                {weekColumns.map((column, index) => (
                                  <option key={`phase-start-${index + 1}`} value={index}>
                                    {`Wk. ${column.weeksToRace}`}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="field-group">
                              <span className="field-label">To</span>
                              <select
                                className="text-input"
                                onChange={(event) =>
                                  updatePhaseBlock(block.id, 'endWeekIndex', event.target.value)
                                }
                                value={block.endWeekIndex}
                              >
                                {weekColumns.map((column, index) => (
                                  <option key={`phase-end-${index + 1}`} value={index}>
                                    {`Wk. ${column.weeksToRace}`}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <button
                              className="icon-button"
                              onClick={() => removePhaseBlock(block.id)}
                              type="button"
                            >
                              Remove
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="planner-panel">
                    <div className="planner-panel-head">
                      <p className="eyebrow">Focus Rows</p>
                      <button className="secondary-button" onClick={addCustomFocusRow} type="button">
                        Add Focus Row
                      </button>
                    </div>
                  </section>

                  <div className="week-design-scroller">
                    <table className="week-design-table">
                      <thead>
                        <tr>
                          <th className="week-design-sticky-column week-design-label" scope="col">
                            Month
                          </th>
                          <th className="week-design-sticky-column week-design-abbr-label" scope="col" />
                          {monthSegments.map((segment) => (
                            <th
                              className="week-design-header-group"
                              colSpan={segment.span}
                              key={`${segment.label}-${segment.span}`}
                              scope="colgroup"
                            >
                              {segment.label}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          <th className="week-design-sticky-column week-design-label" scope="col">
                            Start of Week
                          </th>
                          <th className="week-design-sticky-column week-design-abbr-label" scope="col" />
                          {weekColumns.map((column, index) => (
                            <th
                              className={`week-design-header-cell ${
                                column.isRaceWeek ? 'week-design-race-week' : ''
                              }`}
                              key={`start-week-${index + 1}`}
                              scope="col"
                            >
                              {formatWeekStart(column.startDate)}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          <th className="week-design-sticky-column week-design-label" scope="col">
                            Weeks to Race
                          </th>
                          <th className="week-design-sticky-column week-design-abbr-label" scope="col" />
                          {weekColumns.map((column, index) => (
                            <th
                              className={`week-design-header-cell ${
                                column.isRaceWeek ? 'week-design-race-week' : ''
                              }`}
                              key={`weeks-to-race-${index + 1}`}
                              scope="col"
                            >
                              {column.weeksToRace}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th className="week-design-sticky-column week-design-label" scope="row">
                            Event Name
                          </th>
                          <td className="week-design-sticky-column week-design-abbr-cell" />
                          {weekDesign.events.map((event, index) => (
                            <td key={`event-name-${index + 1}`}>
                              <input
                                className="week-grid-input"
                                onChange={(eventTarget) =>
                                  updateWeekEvent(index, 'eventName', eventTarget.target.value)
                                }
                                placeholder={index === parsedWeekCount - 1 ? 'Goal race' : ''}
                                type="text"
                                value={event.eventName}
                              />
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <th className="week-design-sticky-column week-design-label" scope="row">
                            Event Grade
                          </th>
                          <td className="week-design-sticky-column week-design-abbr-cell" />
                          {weekDesign.events.map((event, index) => (
                            <td key={`event-grade-${index + 1}`}>
                              <select
                                className="week-grid-select"
                                onChange={(eventTarget) =>
                                  updateWeekEvent(index, 'eventGrade', eventTarget.target.value)
                                }
                                value={event.eventGrade}
                              >
                                <option value="">-</option>
                                <option value="A">A</option>
                                <option value="B">B</option>
                                <option value="C">C</option>
                              </select>
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <th className="week-design-sticky-column week-design-label" scope="row">
                            Phase Goal
                          </th>
                          <td className="week-design-sticky-column week-design-abbr-cell" />
                          {phaseSegments.map((segment, index) => (
                            <td
                              className={`week-design-phase-cell ${
                                segment.isEmpty ? 'week-design-phase-empty' : ''
                              }`}
                              colSpan={segment.span}
                              key={`phase-segment-${index + 1}`}
                            >
                              {segment.label || ' '}
                            </td>
                          ))}
                        </tr>

                        {weekDesign.focusRows.map((row) => (
                          <tr key={row.id}>
                            <th className="week-design-sticky-column week-design-label" scope="row">
                              {row.isCustom ? (
                                <div className="custom-row-editor">
                                  <input
                                    className="custom-row-input"
                                    onChange={(event) =>
                                      updateFocusRowLabel(row.id, event.target.value)
                                    }
                                    type="text"
                                    value={row.label}
                                  />
                                  <button
                                    className="custom-row-remove"
                                    onClick={() => removeCustomFocusRow(row.id)}
                                    type="button"
                                  >
                                    x
                                  </button>
                                </div>
                              ) : (
                                row.label
                              )}
                            </th>
                            <td className="week-design-sticky-column week-design-abbr-cell">
                              <input
                                className="week-grid-input week-grid-input-abbr"
                                maxLength={2}
                                onChange={(event) =>
                                  updateFocusRowAbbreviation(row.id, event.target.value)
                                }
                                type="text"
                                value={row.abbreviation}
                              />
                            </td>
                            {weekColumns.map((column, weekIndex) => (
                              <td
                                className={column.isRaceWeek ? 'week-design-race-week-cell' : ''}
                                key={`${row.id}-${weekIndex + 1}`}
                              >
                                <label className="week-checkbox">
                                  <input
                                    checked={weekDesign.focusSelections[row.id][weekIndex] ?? false}
                                    onChange={() => toggleFocusCell(row.id, weekIndex)}
                                    type="checkbox"
                                  />
                                  <span />
                                </label>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ) : parsedWeekCount === 0 ? (
            <div className="empty-state">
              Set a positive week count in Week Focus to build the calendar.
            </div>
          ) : !weekDesign.raceDate ? (
            <div className="empty-state">
              Set a race date in Week Focus before using the calendar view.
            </div>
          ) : (
            <div className="calendar-layout">
              <div className="calendar-scroller">
                <table className="calendar-table">
                  <thead>
                    <tr>
                      <th className="calendar-sticky-column calendar-week-head" scope="col">
                        Week
                      </th>
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayLabel) => (
                        <th className="calendar-head-cell" key={dayLabel} scope="col">
                          {dayLabel}
                        </th>
                      ))}
                      <th className="calendar-head-cell calendar-summary-head" scope="col">
                        Scheduled
                      </th>
                      <th className="calendar-head-cell calendar-summary-head" scope="col">
                        Prescribed
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekColumns.map((column, weekIndex) => {
                      const weekDates = getWeekDates(column.startDate);
                      const scheduledSummary = summarizeWeekSchedule(weekDates, scheduledWorkouts);
                      const prescribedWeek = getPrescribedWeek(parsedWeeks, weekIndex);

                      return (
                        <tr key={`calendar-week-${weekIndex + 1}`}>
                          <th className="calendar-sticky-column calendar-week-label" scope="row">
                            <div className="calendar-week-meta">
                              <strong>Week {weekIndex + 1}</strong>
                              <span>{column.weeksToRace} w to race</span>
                              {weekDates.length > 0 ? (
                                <span>{formatDateRange(weekDates[0], weekDates[6])}</span>
                              ) : null}
                            </div>
                          </th>

                          {weekDates.map((date) => {
                            const dateKey = formatDateKey(date);
                            const workout = scheduledWorkouts[dateKey];
                            const parsedWorkout = workout ? deriveDayWorkout(workout) : null;
                            const hasWorkout = workout ? hasDayWorkoutContent(workout) : false;

                            return (
                              <td className="calendar-day-cell" key={dateKey}>
                                <button
                                  className={`calendar-day-button ${
                                    hasWorkout ? 'calendar-day-button-filled' : ''
                                  }`}
                                  onClick={() => openCalendarDay(date)}
                                  type="button"
                                >
                                  <span className="calendar-day-date">{date.getDate()}</span>
                                  <span className="calendar-day-month">
                                    {date.toLocaleDateString(undefined, { month: 'short' })}
                                  </span>
                                  {hasWorkout && parsedWorkout ? (
                                    <>
                                      {workout?.recovery ? (
                                        <span className="calendar-day-recovery">Recovery</span>
                                      ) : (
                                        <>
                                          <span className="calendar-day-metric">
                                            {formatMinutes(parsedWorkout.totalMinutes)}
                                          </span>
                                          {parsedWorkout.elevationMeters > 0 ? (
                                            <span className="calendar-day-submetric">
                                              {formatMeters(parsedWorkout.elevationMeters)}
                                            </span>
                                          ) : null}
                                        </>
                                      )}
                                      {workout?.notes.trim() ? (
                                        <span className="calendar-day-note">Note</span>
                                      ) : null}
                                    </>
                                  ) : (
                                    <span className="calendar-day-add">Add</span>
                                  )}
                                </button>
                              </td>
                            );
                          })}

                          <td className="calendar-summary-cell">
                            <div className="calendar-summary-grid">
                              <span>Total {formatMinutes(scheduledSummary.totalMinutes)}</span>
                              <span>Z1 {formatMinutes(scheduledSummary.z1Minutes)}</span>
                              <span>Z2 {formatMinutes(scheduledSummary.z2Minutes)}</span>
                              <span>Z3 {formatMinutes(scheduledSummary.z3Minutes)}</span>
                              <span>Elev {formatMeters(scheduledSummary.elevationMeters)}</span>
                              <span>Sessions {scheduledSummary.workoutCount}</span>
                            </div>
                          </td>

                          <td className="calendar-summary-cell calendar-prescribed-cell">
                            <div className="calendar-summary-grid">
                              <span>Total {formatMinutes(prescribedWeek.totalMinutes)}</span>
                              <span>Z1 {formatMinutes(prescribedWeek.z1Minutes)}</span>
                              <span>Z2 {formatMinutes(prescribedWeek.z2Minutes)}</span>
                              <span>Z3 {formatMinutes(prescribedWeek.z3Minutes)}</span>
                              <span>Elev {formatMeters(prescribedWeek.elevationMeters)}</span>
                              <span>
                                Long {formatPercent(
                                  prescribedWeek.totalMinutes > 0
                                    ? (prescribedWeek.longRunMinutes / prescribedWeek.totalMinutes) *
                                        100
                                    : 0,
                                )}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </section>
        </section>
      </main>

      <div aria-hidden="true" className="export-sandbox">
        <div className="export-card" ref={weekDesignExportRef}>
          <div className="export-card-head">
            <h2>Week Focus</h2>
            <span>{weekDesign.raceDate ? `Race Date ${weekDesign.raceDate}` : 'Race Date not set'}</span>
          </div>

          {parsedWeekCount === 0 ? (
            <div className="export-empty">Set a week count in Week Focus to export Week Focus.</div>
          ) : (
            <table className="week-design-table week-design-export-table">
              <thead>
                <tr>
                  <th className="week-design-label" scope="col">
                    Month
                  </th>
                  <th className="week-design-abbr-label" scope="col" />
                  {monthSegments.map((segment, index) => (
                    <th
                      className="week-design-header-group"
                      colSpan={segment.span}
                      key={`export-month-${segment.label}-${index + 1}`}
                      scope="colgroup"
                    >
                      {segment.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="week-design-label" scope="col">
                    Start of Week
                  </th>
                  <th className="week-design-abbr-label" scope="col" />
                  {weekColumns.map((column, index) => (
                    <th className="week-design-header-cell" key={`export-start-${index + 1}`} scope="col">
                      {formatWeekStart(column.startDate)}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="week-design-label" scope="col">
                    Weeks to Race
                  </th>
                  <th className="week-design-abbr-label" scope="col" />
                  {weekColumns.map((column, index) => (
                    <th className="week-design-header-cell" key={`export-count-${index + 1}`} scope="col">
                      {column.weeksToRace}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th className="week-design-label" scope="row">
                    Event Name
                  </th>
                  <td className="week-design-abbr-cell" />
                  {weekDesign.events.map((event, index) => (
                    <td key={`export-event-name-${index + 1}`}>{event.eventName}</td>
                  ))}
                </tr>
                <tr>
                  <th className="week-design-label" scope="row">
                    Event Grade
                  </th>
                  <td className="week-design-abbr-cell" />
                  {weekDesign.events.map((event, index) => (
                    <td key={`export-event-grade-${index + 1}`}>{event.eventGrade}</td>
                  ))}
                </tr>
                <tr>
                  <th className="week-design-label" scope="row">
                    Phase Goal
                  </th>
                  <td className="week-design-abbr-cell" />
                  {phaseSegments.map((segment, index) => (
                    <td
                      className={`week-design-phase-cell ${
                        segment.isEmpty ? 'week-design-phase-empty' : ''
                      }`}
                      colSpan={segment.span}
                      key={`export-phase-${index + 1}`}
                    >
                      {segment.label || ' '}
                    </td>
                  ))}
                </tr>
                {weekDesign.focusRows.map((row) => (
                  <tr key={`export-focus-${row.id}`}>
                    <th className="week-design-label" scope="row">
                      {row.label}
                    </th>
                    <td className="week-design-abbr-cell">{row.abbreviation}</td>
                    {weekColumns.map((column, weekIndex) => (
                      <td key={`export-focus-cell-${row.id}-${weekIndex + 1}`}>
                        {weekDesign.focusSelections[row.id][weekIndex] ? (
                          <span className="export-checkmark">x</span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {activeCalendarDate ? (
        <div className="modal-backdrop" onClick={closeCalendarModal} role="presentation">
          <div
            aria-labelledby="calendar-modal-title"
            aria-modal="true"
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Daily Workout</p>
                <h3 id="calendar-modal-title" className="modal-title">
                  {activeCalendarTitle}
                </h3>
              </div>
              <button className="modal-close" onClick={closeCalendarModal} type="button">
                x
              </button>
            </div>

            <div className="modal-grid">
              <label className="checkbox-row">
                <input
                  checked={calendarDraft.recovery}
                  onChange={(event) => toggleCalendarRecovery(event.target.checked)}
                  type="checkbox"
                />
                <span>Recovery</span>
              </label>
            </div>

            <div className="modal-grid">
              <label className="field-group">
                <span className="field-label">Time</span>
                <input
                  className="text-input"
                  disabled={calendarDraft.recovery}
                  onChange={(event) => updateCalendarDraft('totalTime', event.target.value)}
                  type="text"
                  value={calendarDraft.totalTime}
                />
              </label>

              <label className="field-group">
                <span className="field-label">Time in Z3</span>
                <input
                  className="text-input"
                  disabled={calendarDraft.recovery}
                  onChange={(event) => updateCalendarDraft('z3Time', event.target.value)}
                  type="text"
                  value={calendarDraft.z3Time}
                />
              </label>

              <label className="field-group">
                <span className="field-label">Time in Z2</span>
                <input
                  className="text-input"
                  disabled={calendarDraft.recovery}
                  onChange={(event) => updateCalendarDraft('z2Time', event.target.value)}
                  type="text"
                  value={calendarDraft.z2Time}
                />
              </label>

              <label className="field-group">
                <span className="field-label">Elevation (m)</span>
                <input
                  className="text-input"
                  disabled={calendarDraft.recovery}
                  onChange={(event) => updateCalendarDraft('elevation', event.target.value)}
                  type="number"
                  value={calendarDraft.elevation}
                />
              </label>
            </div>

            <label className="field-group">
              <span className="field-label">Notes</span>
              <textarea
                className="text-area-input"
                onChange={(event) => updateCalendarDraft('notes', event.target.value)}
                rows={5}
                value={calendarDraft.notes}
              />
            </label>

            {calendarDraftErrors.length > 0 ? (
              <ul className="error-list modal-error-list">
                {calendarDraftErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}

            <div className="modal-actions">
              <button className="icon-button" onClick={clearCalendarDay} type="button">
                Clear Day
              </button>
              <div className="modal-actions-right">
                <button className="secondary-button" onClick={closeCalendarModal} type="button">
                  Cancel
                </button>
                <button className="primary-button" onClick={saveCalendarDay} type="button">
                  Save Workout
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
