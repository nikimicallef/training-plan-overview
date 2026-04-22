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

type WorkoutType =
  | ''
  | 'road-run'
  | 'trail-run'
  | 'cycling'
  | 'hiking'
  | 'strength'
  | 'other'
  | 'rest';

type DayWorkout = {
  title: string;
  type: WorkoutType;
  totalTime: string;
  z3Time: string;
  z2Time: string;
  elevation: string;
  notes: string;
  intervalsIcuId: string;
};

type PendingIntervalsDelete = {
  dateKey: string;
  intervalsIcuId: string;
};

type IntervalsSyncState = {
  completed: number;
  total: number;
  created: number;
  updated: number;
  deleted: number;
  failed: number;
  failures: string[];
  statusMessage: string;
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

type UnitSystem = 'metric' | 'imperial';

type PlannerTab = 'volume' | 'week' | 'calendar';

type PlannerSnapshot = {
  version: number;
  activeTab: PlannerTab;
  unitSystem: UnitSystem;
  weeksInput: string;
  weeks: WeekFormState[];
  weekDesign: WeekDesignState;
  scheduledWorkouts: Record<string, DayWorkout>;
  pendingIntervalsDeletes: PendingIntervalsDelete[];
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
  title: '',
  type: '',
  totalTime: '',
  z3Time: '',
  z2Time: '',
  elevation: '',
  notes: '',
  intervalsIcuId: '',
};

const DEFAULT_WEEK_COUNT = 6;
const LEFT_AXIS_TICKS = 5;
const RIGHT_AXIS_TICKS = 5;
const FEET_PER_METER = 3.28084;
const INTERVALS_BASE_URL = 'https://intervals.icu/api/v1/athlete/0/events';
const INTERVALS_REQUEST_DELAY_MS = 120;
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
  eventGradeA: 'rgba(255, 92, 92, 0.24)',
  eventGradeB: 'rgba(255, 210, 72, 0.26)',
  eventGradeC: 'rgba(92, 201, 112, 0.24)',
  grid: '#d8dccf',
  axis: '#526052',
  text: '#223021',
};

const WORKOUT_TYPE_OPTIONS: Array<{ value: Exclude<WorkoutType, ''>; label: string }> = [
  { value: 'road-run', label: 'Road Run' },
  { value: 'trail-run', label: 'Trail Run' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'hiking', label: 'Hiking' },
  { value: 'strength', label: 'Strength' },
  { value: 'other', label: 'Other' },
  { value: 'rest', label: 'Rest' },
];

function createEmptyIntervalsSyncState(): IntervalsSyncState {
  return {
    completed: 0,
    total: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    failed: 0,
    failures: [],
    statusMessage: '',
  };
}

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

function metersToFeet(value: number): number {
  return value * FEET_PER_METER;
}

function feetToMeters(value: number): number {
  return value / FEET_PER_METER;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeNumericTextInput(value: string): string {
  let seenDecimal = false;

  return value
    .split('')
    .filter((character) => {
      if (/\d/.test(character)) {
        return true;
      }

      if (character === '.' && !seenDecimal) {
        seenDecimal = true;
        return true;
      }

      return false;
    })
    .join('');
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

function formatElevation(valueMeters: number, unitSystem: UnitSystem): string {
  const displayValue =
    unitSystem === 'imperial' ? Math.round(metersToFeet(valueMeters)) : Math.round(valueMeters);
  const unitLabel = unitSystem === 'imperial' ? 'ft' : 'm';

  return `${displayValue} ${unitLabel}`;
}

function getElevationUnitLabel(unitSystem: UnitSystem): string {
  return unitSystem === 'imperial' ? 'ft' : 'm';
}

function convertElevationInputValue(
  value: string,
  fromUnitSystem: UnitSystem,
  toUnitSystem: UnitSystem,
): string {
  if (fromUnitSystem === toUnitSystem || value.trim() === '') {
    return value;
  }

  const parsedValue = parseNonNegativeNumber(value);

  if (parsedValue === null) {
    return value;
  }

  const metersValue = fromUnitSystem === 'imperial' ? feetToMeters(parsedValue) : parsedValue;
  const nextValue = toUnitSystem === 'imperial' ? metersToFeet(metersValue) : metersValue;

  return String(Math.round(nextValue));
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

function sanitizeIntervalsIcuId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
}

function sanitizeBoolean(value: unknown): boolean {
  return value === true;
}

function sanitizeUnitSystem(value: unknown): UnitSystem {
  return value === 'imperial' ? 'imperial' : 'metric';
}

function sanitizeWorkoutType(value: unknown): WorkoutType {
  return WORKOUT_TYPE_OPTIONS.some((option) => option.value === value) ? (value as WorkoutType) : '';
}

function sanitizeWorkoutTitle(value: unknown): string {
  return sanitizeString(value).trim().slice(0, 30);
}

function getWorkoutTypeLabel(type: WorkoutType): string {
  return WORKOUT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? '';
}

function isEnduranceWorkoutType(type: WorkoutType): boolean {
  return type === 'road-run' || type === 'trail-run' || type === 'cycling' || type === 'hiking';
}

function isTimeOnlyWorkoutType(type: WorkoutType): boolean {
  return type === 'strength' || type === 'other';
}

function isRestWorkoutType(type: WorkoutType): boolean {
  return type === 'rest';
}

function getIntervalsExternalId(dateKey: string): string {
  return `training-plan-overview:${dateKey}`;
}

function getIntervalsEventType(type: WorkoutType): string | undefined {
  if (type === 'road-run') {
    return 'Run';
  }

  if (type === 'trail-run') {
    return 'Trail Run';
  }

  if (type === 'cycling') {
    return 'Ride';
  }

  if (type === 'strength') {
    return 'WeightTraining';
  }

  if (type === 'hiking' || type === 'other') {
    return 'Other Workout';
  }

  return undefined;
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
  const recovery = isRecord(value) ? sanitizeBoolean(value.recovery) : false;
  const type = isRecord(value) ? sanitizeWorkoutType(value.type) : '';
  const totalTime = isRecord(value) ? sanitizeString(value.totalTime) : '';
  const z3Time = isRecord(value) ? sanitizeString(value.z3Time) : '';
  const z2Time = isRecord(value) ? sanitizeString(value.z2Time) : '';
  const elevation = isRecord(value) ? sanitizeString(value.elevation) : '';
  const notes = isRecord(value) ? sanitizeString(value.notes) : '';
  const title = isRecord(value) ? sanitizeWorkoutTitle(value.title) : '';
  const inferredLegacyType: WorkoutType =
    type ||
    (recovery
      ? 'rest'
      : totalTime.trim() || z3Time.trim() || z2Time.trim() || elevation.trim()
        ? 'road-run'
        : title.trim() || notes.trim()
          ? 'other'
          : '');

  return {
    title,
    type: inferredLegacyType,
    totalTime,
    z3Time,
    z2Time,
    elevation,
    notes,
    intervalsIcuId: isRecord(value) ? sanitizeIntervalsIcuId(value.intervalsIcuId) : '',
  };
}

function sanitizePendingIntervalsDeletes(value: unknown): PendingIntervalsDelete[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenDateKeys = new Set<string>();

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const dateKey = sanitizeString(entry.dateKey);
      const intervalsIcuId = sanitizeIntervalsIcuId(entry.intervalsIcuId);

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !intervalsIcuId || seenDateKeys.has(dateKey)) {
        return null;
      }

      seenDateKeys.add(dateKey);

      return {
        dateKey,
        intervalsIcuId,
      };
    })
    .filter((entry): entry is PendingIntervalsDelete => entry !== null);
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
    unitSystem: sanitizeUnitSystem(value.unitSystem),
    weeksInput: normalizedWeeksInput,
    weeks: resizeWeeks(weekCount, uploadedWeeks),
    weekDesign: sanitizeWeekDesignState(value.weekDesign, weekCount),
    scheduledWorkouts: sanitizeScheduledWorkouts(value.scheduledWorkouts),
    pendingIntervalsDeletes: sanitizePendingIntervalsDeletes(value.pendingIntervalsDeletes),
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
  return (
    workout.title.trim() !== '' ||
    workout.type !== '' ||
    workout.totalTime.trim() !== '' ||
    workout.z3Time.trim() !== '' ||
    workout.z2Time.trim() !== '' ||
    workout.elevation.trim() !== '' ||
    workout.notes.trim() !== ''
  );
}

function deriveDayWorkout(workout: DayWorkout, unitSystem: UnitSystem): ParsedDayWorkout {
  if (!workout.type) {
    return {
      totalMinutes: 0,
      z1Minutes: 0,
      z2Minutes: 0,
      z3Minutes: 0,
      elevationMeters: 0,
      errors: hasDayWorkoutContent(workout) ? ['Select a workout type.'] : [],
    };
  }

  if (isRestWorkoutType(workout.type)) {
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
  const z3Minutes = isEnduranceWorkoutType(workout.type) ? parseTimeInput(workout.z3Time) : 0;
  const z2Minutes = isEnduranceWorkoutType(workout.type) ? parseTimeInput(workout.z2Time) : 0;
  const elevationValue = isEnduranceWorkoutType(workout.type)
    ? parseNonNegativeNumber(workout.elevation)
    : 0;

  if (totalMinutes === null) {
    errors.push('Time must use the format Xh Ym.');
  }

  if (isEnduranceWorkoutType(workout.type) && z3Minutes === null) {
    errors.push('Time in Z3 must use the format Xh Ym.');
  }

  if (isEnduranceWorkoutType(workout.type) && z2Minutes === null) {
    errors.push('Time in Z2 must use the format Xh Ym.');
  }

  if (isEnduranceWorkoutType(workout.type) && elevationValue === null) {
    errors.push('Elevation must be a non-negative number.');
  }

  const safeTotal = totalMinutes ?? 0;
  const safeZ3 = z3Minutes ?? 0;
  const safeZ2 = z2Minutes ?? 0;
  const safeElevationValue = elevationValue ?? 0;
  const safeElevation = unitSystem === 'imperial' ? feetToMeters(safeElevationValue) : safeElevationValue;

  if (isEnduranceWorkoutType(workout.type) && safeZ2 + safeZ3 > safeTotal) {
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
  unitSystem: UnitSystem,
): WeekScheduleSummary {
  return weekDates.reduce(
    (summary, date) => {
      const workout = workoutsByDate[formatDateKey(date)];

      if (!workout || !hasDayWorkoutContent(workout)) {
        return summary;
      }

      const parsedWorkout = deriveDayWorkout(workout, unitSystem);

      return {
        totalMinutes: summary.totalMinutes + parsedWorkout.totalMinutes,
        z1Minutes: summary.z1Minutes + parsedWorkout.z1Minutes,
        z2Minutes: summary.z2Minutes + parsedWorkout.z2Minutes,
        z3Minutes: summary.z3Minutes + parsedWorkout.z3Minutes,
        elevationMeters: summary.elevationMeters + parsedWorkout.elevationMeters,
        workoutCount: summary.workoutCount + (isRestWorkoutType(workout.type) ? 0 : 1),
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
  unitSystem: UnitSystem,
  extraLine?: string,
): string[] {
  const lines = [
    `Total ${formatMinutes(summary.totalMinutes)}`,
    `Z1 ${formatMinutes(summary.z1Minutes)}`,
    `Z2 ${formatMinutes(summary.z2Minutes)}`,
    `Z3 ${formatMinutes(summary.z3Minutes)}`,
    `Elev ${formatElevation(summary.elevationMeters, unitSystem)}`,
  ];

  if (extraLine) {
    lines.push(extraLine);
  }

  return lines;
}

function buildDayWorkoutMetricLine(parsedWorkout: ParsedDayWorkout): string {
  return [
    formatMinutes(parsedWorkout.totalMinutes),
    formatMinutes(parsedWorkout.z3Minutes),
    formatMinutes(parsedWorkout.z2Minutes),
    formatMinutes(parsedWorkout.z1Minutes),
  ].join(' / ');
}

function buildCalendarDayCellText(date: Date, workout: DayWorkout | undefined, unitSystem: UnitSystem): string {
  const lines = [formatShortDate(date)];

  if (!workout || !hasDayWorkoutContent(workout)) {
    lines.push('No workout');
    return lines.join('\n');
  }

  if (workout.title.trim()) {
    lines.push(workout.title.trim());
  }

  const typeLabel = getWorkoutTypeLabel(workout.type);
  if (typeLabel) {
    lines.push(typeLabel);
  }

  if (!isRestWorkoutType(workout.type)) {
    const parsedWorkout = deriveDayWorkout(workout, unitSystem);
    const showElevation = isEnduranceWorkoutType(workout.type) && workout.elevation.trim() !== '';

    lines.push(buildDayWorkoutMetricLine(parsedWorkout));
    lines.push(showElevation ? formatElevation(parsedWorkout.elevationMeters, unitSystem) : '-');
  }

  if (workout.notes.trim()) {
    lines.push(`Notes: ${workout.notes.trim()}`);
  }

  if (workout.intervalsIcuId) {
    lines.push(`ICU ${workout.intervalsIcuId}`);
  }

  return lines.join('\n');
}

function buildIntervalsEventDescription(workout: DayWorkout, unitSystem: UnitSystem): string | undefined {
  if (isRestWorkoutType(workout.type)) {
    return workout.notes.trim() || undefined;
  }

  const parsedWorkout = deriveDayWorkout(workout, unitSystem);
  const showElevation = isEnduranceWorkoutType(workout.type) && workout.elevation.trim() !== '';
  const lines = [
    `Z3 ${formatMinutes(parsedWorkout.z3Minutes)} / Z2 ${formatMinutes(parsedWorkout.z2Minutes)} / Z1 ${formatMinutes(parsedWorkout.z1Minutes)}`,
    `Elevation ${showElevation ? formatElevation(parsedWorkout.elevationMeters, unitSystem) : '-'}`,
  ];

  if (workout.notes.trim()) {
    lines.push(workout.notes.trim());
  }

  return lines.join('\n');
}

type IntervalsEventRequestBody = {
  category: 'WORKOUT' | 'NOTE';
  start_date_local: string;
  name?: string;
  description?: string;
  type?: string;
  moving_time?: number;
  external_id: string;
};

function buildIntervalsEventRequestBody(
  dateKey: string,
  workout: DayWorkout,
  unitSystem: UnitSystem,
): IntervalsEventRequestBody {
  const start_date_local = `${dateKey}T00:00:00`;
  const external_id = getIntervalsExternalId(dateKey);

  if (isRestWorkoutType(workout.type)) {
    return {
      category: 'NOTE',
      start_date_local,
      name: 'Rest Day',
      description: workout.notes.trim() || undefined,
      external_id,
    };
  }

  const parsedWorkout = deriveDayWorkout(workout, unitSystem);
  const payload: IntervalsEventRequestBody = {
    category: 'WORKOUT',
    start_date_local,
    type: getIntervalsEventType(workout.type),
    moving_time: parsedWorkout.totalMinutes * 60,
    description: buildIntervalsEventDescription(workout, unitSystem),
    external_id,
  };

  if (workout.title.trim()) {
    payload.name = workout.title.trim();
  }

  return payload;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function callIntervalsApi<T>(
  apiKey: string,
  path: string,
  options: {
    method: 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
  },
): Promise<T> {
  const headers = new Headers({
    Authorization: `Basic ${window.btoa(`API_KEY:${apiKey}`)}`,
  });

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${INTERVALS_BASE_URL}${path}`, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let parsed: unknown = null;

  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const message =
      isRecord(parsed) && typeof parsed.error === 'string'
        ? parsed.error
        : text || `${options.method} ${path} failed with ${response.status}.`;

    throw {
      status: response.status,
      message,
    };
  }

  return parsed as T;
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

function deriveWeek(week: WeekFormState, index: number, unitSystem: UnitSystem): ParsedWeek {
  const errors: string[] = [];

  const totalMinutes = parseTimeInput(week.totalTime);
  const z3Minutes = parseTimeInput(week.z3Time);
  const z2Minutes = parseTimeInput(week.z2Time);
  const elevationValue = parseNonNegativeNumber(week.elevation);
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

  if (elevationValue === null) {
    errors.push('Elevation must be a non-negative number.');
  }

  if (longRunPercent === null || longRunPercent > 100) {
    errors.push('Long run time must be between 0 and 100.');
  }

  const safeTotal = totalMinutes ?? 0;
  const safeZ3 = z3Minutes ?? 0;
  const safeZ2 = z2Minutes ?? 0;
  const safeElevationValue = elevationValue ?? 0;
  const safeElevation = unitSystem === 'imperial' ? feetToMeters(safeElevationValue) : safeElevationValue;
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
  return parsedWeeks[weekIndex] ?? deriveWeek({ ...EMPTY_WEEK }, weekIndex, 'metric');
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
  unitSystem,
}: {
  data: ParsedWeek[];
  eventGrades: EventGrade[];
  weekLabels: string[];
  focusAbbreviations: string[][];
  unitSystem: UnitSystem;
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
              {Math.round(unitSystem === 'imperial' ? metersToFeet(tick) : tick)}
            </text>
          );
        })}

        {data.map((week, index) => {
          const x = getX(index);
          const barX = x - barWidth / 2;
          const segmentRadius = 10;
          const z3Top = getLeftY(week.totalMinutes);
          const totalHeight = week.totalMinutes === 0 ? 0 : (week.totalMinutes / timeAxisMax) * plotHeight;
          const z3Height = week.totalMinutes === 0 ? 0 : (week.z3Minutes / timeAxisMax) * plotHeight;
          const z2Top = getLeftY(week.z1Minutes + week.z2Minutes);
          const z2Height = week.totalMinutes === 0 ? 0 : (week.z2Minutes / timeAxisMax) * plotHeight;
          const z1Top = getLeftY(week.z1Minutes);
          const z1Height = week.totalMinutes === 0 ? 0 : (week.z1Minutes / timeAxisMax) * plotHeight;
          const clipPathId = `week-stack-clip-${week.week}`;

          return (
            <g key={week.week}>
              {totalHeight > 0 ? (
                <>
                  <clipPath id={clipPathId}>
                    <path
                      d={getRoundedRectPath(
                        barX,
                        z3Top,
                        barWidth,
                        Math.max(totalHeight, 0),
                        segmentRadius,
                        { roundTop: true, roundBottom: true },
                      )}
                    />
                  </clipPath>
                  <g clipPath={`url(#${clipPathId})`}>
                    <rect fill={COLORS.z1} height={Math.max(z1Height, 0)} width={barWidth} x={barX} y={z1Top} />
                    <rect fill={COLORS.z2} height={Math.max(z2Height, 0)} width={barWidth} x={barX} y={z2Top} />
                    <rect fill={COLORS.z3} height={Math.max(z3Height, 0)} width={barWidth} x={barX} y={z3Top} />
                  </g>
                </>
              ) : null}
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
          {`Elevation (${getElevationUnitLabel(unitSystem)})`}
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
  const [pendingIntervalsDeletes, setPendingIntervalsDeletes] = useState<PendingIntervalsDelete[]>([]);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('metric');
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  const [activeTab, setActiveTab] = useState<PlannerTab>('week');
  const [activeCalendarDate, setActiveCalendarDate] = useState<Date | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<DayWorkout>({ ...EMPTY_DAY_WORKOUT });
  const [calendarDraftErrors, setCalendarDraftErrors] = useState<string[]>([]);
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState(false);
  const [isIntervalsModalOpen, setIsIntervalsModalOpen] = useState(false);
  const [intervalsApiKey, setIntervalsApiKey] = useState('');
  const [isSyncingIntervals, setIsSyncingIntervals] = useState(false);
  const [intervalsSyncState, setIntervalsSyncState] = useState<IntervalsSyncState>(
    createEmptyIntervalsSyncState(),
  );
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
  const parsedWeeks = deferredWeeks.map((week, index) => deriveWeek(week, index, unitSystem));
  const weekColumns = getWeekColumns(parsedWeekCount, weekDesign.raceDate);
  const visibleCalendarDateKeys = new Set(
    weekColumns.flatMap((column) => getWeekDates(column.startDate).map((date) => formatDateKey(date))),
  );
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
    const nextValue =
      field === 'elevation' || field === 'longRunPercent'
        ? sanitizeNumericTextInput(value)
        : value;

    setWeeks((previous) =>
      previous.map((week, weekIndex) =>
        weekIndex === index ? { ...week, [field]: nextValue } : week,
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

  function getPendingIntervalsDelete(dateKey: string): PendingIntervalsDelete | undefined {
    return pendingIntervalsDeletes.find((entry) => entry.dateKey === dateKey);
  }

  function queueIntervalsDelete(dateKey: string, intervalsIcuId: string) {
    if (!intervalsIcuId) {
      return;
    }

    setPendingIntervalsDeletes((previous) => {
      const next = previous.filter((entry) => entry.dateKey !== dateKey);
      next.push({
        dateKey,
        intervalsIcuId,
      });
      return next;
    });
  }

  function removePendingIntervalsDelete(dateKey: string) {
    setPendingIntervalsDeletes((previous) =>
      previous.filter((entry) => entry.dateKey !== dateKey),
    );
  }

  function handleUnitSystemChange(nextUnitSystem: UnitSystem) {
    if (nextUnitSystem === unitSystem) {
      return;
    }

    setWeeks((previous) =>
      previous.map((week) => ({
        ...week,
        elevation: convertElevationInputValue(week.elevation, unitSystem, nextUnitSystem),
      })),
    );
    setScheduledWorkouts((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([dateKey, workout]) => [
          dateKey,
          {
            ...workout,
            elevation: convertElevationInputValue(workout.elevation, unitSystem, nextUnitSystem),
          },
        ]),
      ),
    );
    setCalendarDraft((previous) => ({
      ...previous,
      elevation: convertElevationInputValue(previous.elevation, unitSystem, nextUnitSystem),
    }));
    setUnitSystem(nextUnitSystem);
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
    const queuedDelete = getPendingIntervalsDelete(dateKey);

    setActiveCalendarDate(date);
    setCalendarDraft(
      scheduledWorkouts[dateKey] ?? {
        ...EMPTY_DAY_WORKOUT,
        intervalsIcuId: queuedDelete?.intervalsIcuId ?? '',
      },
    );
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
      [field]: field === 'title' ? value.slice(0, 30) : value,
    }));
  }

  function updateCalendarWorkoutType(type: WorkoutType) {
    setCalendarDraft((previous) => ({
      ...previous,
      type,
      totalTime: isRestWorkoutType(type) ? '' : previous.totalTime,
      z3Time: isEnduranceWorkoutType(type) ? previous.z3Time : '',
      z2Time: isEnduranceWorkoutType(type) ? previous.z2Time : '',
      elevation: isEnduranceWorkoutType(type) ? previous.elevation : '',
    }));
    setCalendarDraftErrors([]);
  }

  function clearCalendarDay() {
    if (!activeCalendarDateKey) {
      return;
    }

    const existingWorkout = scheduledWorkouts[activeCalendarDateKey];
    const intervalsIcuId =
      existingWorkout?.intervalsIcuId || calendarDraft.intervalsIcuId || '';

    if (intervalsIcuId) {
      queueIntervalsDelete(activeCalendarDateKey, intervalsIcuId);
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

    const normalizedDraft: DayWorkout = {
      ...calendarDraft,
      title: sanitizeWorkoutTitle(calendarDraft.title),
      type: calendarDraft.type,
      z3Time: isEnduranceWorkoutType(calendarDraft.type) ? calendarDraft.z3Time : '',
      z2Time: isEnduranceWorkoutType(calendarDraft.type) ? calendarDraft.z2Time : '',
      elevation: isEnduranceWorkoutType(calendarDraft.type) ? calendarDraft.elevation : '',
      intervalsIcuId:
        scheduledWorkouts[activeCalendarDateKey]?.intervalsIcuId ||
        calendarDraft.intervalsIcuId ||
        getPendingIntervalsDelete(activeCalendarDateKey)?.intervalsIcuId ||
        '',
    };
    const parsedWorkout = deriveDayWorkout(normalizedDraft, unitSystem);

    if (parsedWorkout.errors.length > 0) {
      setCalendarDraftErrors(parsedWorkout.errors);
      return;
    }

    if (!hasDayWorkoutContent(normalizedDraft)) {
      if (normalizedDraft.intervalsIcuId) {
        queueIntervalsDelete(activeCalendarDateKey, normalizedDraft.intervalsIcuId);
      }
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
      [activeCalendarDateKey]: normalizedDraft,
    }));
    removePendingIntervalsDelete(activeCalendarDateKey);
    closeCalendarModal();
  }

  function buildCalendarWorkbookArray(): Array<Array<string>> {
    return [
      [
        'Week',
        'Prescribed',
        'Scheduled',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ],
      ...weekColumns.map((column, weekIndex) => {
        const weekDates = getWeekDates(column.startDate);
        const scheduledSummary = summarizeWeekSchedule(weekDates, scheduledWorkouts, unitSystem);
        const prescribedWeek = getPrescribedWeek(parsedWeeks, weekIndex);
        const focusSummary = chartFocusAbbreviations[weekIndex]?.join(' ') || '-';

        return [
          `Wk. ${column.weeksToRace}${
            weekDates.length > 0 ? `\n${formatDateRange(weekDates[0], weekDates[6])}` : ''
          }`,
          buildSummaryLines(
            prescribedWeek,
            unitSystem,
            `Long ${formatPercent(
              prescribedWeek.totalMinutes > 0
                ? (prescribedWeek.longRunMinutes / prescribedWeek.totalMinutes) * 100
                : 0,
            )}\nFocus ${focusSummary}`,
          ).join('\n'),
          buildSummaryLines(
            scheduledSummary,
            unitSystem,
            `Sessions ${scheduledSummary.workoutCount}`,
          ).join('\n'),
          ...weekDates.map((date) =>
            buildCalendarDayCellText(date, scheduledWorkouts[formatDateKey(date)], unitSystem),
          ),
        ];
      }),
    ];
  }

  function buildPlannerSnapshot(): PlannerSnapshot {
    return {
      version: 1,
      activeTab,
      unitSystem,
      weeksInput,
      weeks,
      weekDesign,
      scheduledWorkouts,
      pendingIntervalsDeletes,
    };
  }

  function handleDownloadJson() {
    setDownloadError('');
    const snapshot = buildPlannerSnapshot();

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
      setUnitSystem(snapshot.unitSystem);
      setWeeksInput(snapshot.weeksInput);
      setWeeks(snapshot.weeks);
      setWeekDesign(snapshot.weekDesign);
      setScheduledWorkouts(snapshot.scheduledWorkouts);
      setPendingIntervalsDeletes(snapshot.pendingIntervalsDeletes);
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

  function openIntervalsModal() {
    setDownloadError('');
    setIntervalsSyncState(createEmptyIntervalsSyncState());
    setIsIntervalsModalOpen(true);
  }

  function closeInstructionsModal() {
    setIsInstructionsModalOpen(false);
  }

  function closeIntervalsModal() {
    if (isSyncingIntervals) {
      return;
    }

    setIsIntervalsModalOpen(false);
    setIntervalsSyncState(createEmptyIntervalsSyncState());
  }

  async function handlePushToIntervals() {
    const trimmedApiKey = intervalsApiKey.trim();

    if (!trimmedApiKey || isSyncingIntervals) {
      return;
    }

    type IntervalsOperation =
      | {
          kind: 'upsert';
          dateKey: string;
          mode: 'create' | 'update';
          workout: DayWorkout;
        }
      | {
          kind: 'delete';
          dateKey: string;
          intervalsIcuId: string;
        };

    const sortedDateKeys = Array.from(visibleCalendarDateKeys).sort();
    const operations: IntervalsOperation[] = [
      ...sortedDateKeys.flatMap((dateKey) => {
        const workout = scheduledWorkouts[dateKey];

        if (!workout || !hasDayWorkoutContent(workout)) {
          return [];
        }

        const queuedDelete = getPendingIntervalsDelete(dateKey);
        const intervalsIcuId = workout.intervalsIcuId || queuedDelete?.intervalsIcuId || '';

        return [
          {
            kind: 'upsert' as const,
            dateKey,
            mode: (intervalsIcuId ? 'update' : 'create') as 'create' | 'update',
            workout: {
              ...workout,
              intervalsIcuId,
            },
          },
        ];
      }),
      ...pendingIntervalsDeletes
        .filter(
          (entry) =>
            visibleCalendarDateKeys.has(entry.dateKey) && !scheduledWorkouts[entry.dateKey],
        )
        .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
        .map((entry) => ({
          kind: 'delete' as const,
          dateKey: entry.dateKey,
          intervalsIcuId: entry.intervalsIcuId,
        })),
    ];

    if (operations.length === 0) {
      setIntervalsSyncState({
        ...createEmptyIntervalsSyncState(),
        statusMessage: 'No visible calendar changes to push.',
      });
      return;
    }

    setIsSyncingIntervals(true);
    setIntervalsSyncState({
      ...createEmptyIntervalsSyncState(),
      total: operations.length,
      statusMessage: 'Syncing with Intervals.icu...',
    });

    let completed = 0;
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let failed = 0;
    const failures: string[] = [];
    let nextScheduledWorkouts = { ...scheduledWorkouts };
    let nextPendingIntervalsDeletes = [...pendingIntervalsDeletes];
    let shouldAbort = false;

    for (const operation of operations) {
      try {
        if (operation.kind === 'delete') {
          try {
            await callIntervalsApi<unknown>(trimmedApiKey, `/${operation.intervalsIcuId}`, {
              method: 'DELETE',
            });
          } catch (error) {
            const status = isRecord(error) ? Number(error.status) : NaN;

            if (status !== 404) {
              throw error;
            }
          }

          deleted += 1;
          nextPendingIntervalsDeletes = nextPendingIntervalsDeletes.filter(
            (entry) => entry.dateKey !== operation.dateKey,
          );
        } else {
          const validationErrors = deriveDayWorkout(operation.workout, unitSystem).errors;

          if (validationErrors.length > 0) {
            throw {
              status: 400,
              message: validationErrors.join(' '),
            };
          }

          const payload = buildIntervalsEventRequestBody(
            operation.dateKey,
            operation.workout,
            unitSystem,
          );
          let response: { id?: unknown } | null = null;
          let savedAs: 'create' | 'update' = operation.mode;

          if (operation.mode === 'update' && operation.workout.intervalsIcuId) {
            try {
              response = await callIntervalsApi<{ id?: unknown }>(
                trimmedApiKey,
                `/${operation.workout.intervalsIcuId}`,
                {
                  method: 'PUT',
                  body: payload,
                },
              );
            } catch (error) {
              const status = isRecord(error) ? Number(error.status) : NaN;

              if (status === 404) {
                response = await callIntervalsApi<{ id?: unknown }>(trimmedApiKey, '', {
                  method: 'POST',
                  body: payload,
                });
                savedAs = 'create';
              } else {
                throw error;
              }
            }
          } else {
            response = await callIntervalsApi<{ id?: unknown }>(trimmedApiKey, '', {
              method: 'POST',
              body: payload,
            });
          }

          const nextIntervalsIcuId = sanitizeIntervalsIcuId(response?.id);

          if (!nextIntervalsIcuId) {
            throw {
              status: 500,
              message: 'Intervals.icu did not return an event id.',
            };
          }

          nextScheduledWorkouts[operation.dateKey] = {
            ...operation.workout,
            intervalsIcuId: nextIntervalsIcuId,
          };
          nextPendingIntervalsDeletes = nextPendingIntervalsDeletes.filter(
            (entry) => entry.dateKey !== operation.dateKey,
          );

          if (savedAs === 'create') {
            created += 1;
          } else {
            updated += 1;
          }
        }
      } catch (error) {
        failed += 1;
        const message = isRecord(error) && typeof error.message === 'string'
          ? error.message
          : 'Unknown Intervals.icu error.';
        const status = isRecord(error) ? Number(error.status) : NaN;

        failures.push(`${operation.dateKey}: ${message}`);

        if (status === 401 || status === 403 || status === 429) {
          shouldAbort = true;
        }
      }

      completed += 1;

      setIntervalsSyncState({
        completed,
        total: operations.length,
        created,
        updated,
        deleted,
        failed,
        failures: [...failures],
        statusMessage: shouldAbort
          ? 'Sync stopped due to an Intervals.icu API error.'
          : `Synced ${completed} of ${operations.length} calendar changes.`,
      });

      if (shouldAbort) {
        break;
      }

      if (completed < operations.length) {
        await delay(INTERVALS_REQUEST_DELAY_MS);
      }
    }

    setScheduledWorkouts(nextScheduledWorkouts);
    setPendingIntervalsDeletes(nextPendingIntervalsDeletes);
    setIsSyncingIntervals(false);
    setIntervalsSyncState({
      completed,
      total: operations.length,
      created,
      updated,
      deleted,
      failed,
      failures,
      statusMessage:
        failed > 0
          ? `Intervals.icu sync finished with ${failed} issue${failed === 1 ? '' : 's'}.`
          : 'Intervals.icu sync complete.',
    });
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
      const snapshot = buildPlannerSnapshot();

      const zip = new JSZip();

      zip.file('training-plan-chart.png', await chartBlob.arrayBuffer());
      zip.file('week-focus.png', await weekDesignBlob.arrayBuffer());
      zip.file('calendar.xlsx', workbookBytes);
      zip.file('training-plan-state.json', JSON.stringify(snapshot, null, 2));

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
                <div className="hero-action-stack">
                  <button
                    className="hero-help-button"
                    onClick={() => setIsInstructionsModalOpen(true)}
                    type="button"
                  >
                    How To Use
                  </button>
                  <button className="secondary-button" onClick={openIntervalsModal} type="button">
                    Push to Intervals.icu
                  </button>
                </div>
                <div className="hero-action-stack">
                  <button className="secondary-button" onClick={handleDownloadJson} type="button">
                    Download JSON
                  </button>
                  <button className="secondary-button" onClick={handleUploadJsonClick} type="button">
                    Upload JSON
                  </button>
                  <button
                    className="secondary-button"
                    disabled={isDownloadingPackage}
                    onClick={handleDownloadPackage}
                    type="button"
                  >
                    {isDownloadingPackage ? 'Preparing Package...' : 'Download Package'}
                  </button>
                </div>
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
                <strong>{formatElevation(totalElevationMeters, unitSystem)}</strong>
              </article>
            </div>
            <Chart
              data={parsedWeeks}
              eventGrades={weekDesign.events.map((event) => event.eventGrade)}
              focusAbbreviations={chartFocusAbbreviations}
              unitSystem={unitSystem}
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
            <div className="tab-toolbar">
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

              <div aria-label="Elevation units" className="unit-switch" role="group">
                <button
                  className={`unit-switch-button ${
                    unitSystem === 'metric' ? 'unit-switch-button-active' : ''
                  }`}
                  onClick={() => handleUnitSystemChange('metric')}
                  type="button"
                >
                  Metric
                </button>
                <button
                  className={`unit-switch-button ${
                    unitSystem === 'imperial' ? 'unit-switch-button-active' : ''
                  }`}
                  onClick={() => handleUnitSystemChange('imperial')}
                  type="button"
                >
                  Imperial
                </button>
              </div>
            </div>

            {activeTab === 'week' ? (
              <>
                <div className="planner-toolbar">
                  <label className="planner-chip planner-chip-input" htmlFor={weeksInputId}>
                    <span>Weeks</span>
                    <input
                      className="planner-chip-control weeks-input"
                      id={weeksInputId}
                      inputMode="numeric"
                      max={52}
                      min={0}
                      onChange={(event) => setWeeksInput(event.target.value)}
                      type="number"
                      value={weeksInput}
                    />
                  </label>
                  <label className="planner-chip planner-chip-input" htmlFor="race-date">
                    <span>Race Date</span>
                    <input
                      className="planner-chip-control"
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
                <div className="planner-toolbar">
                  <div className="planner-chip">
                    <span>Weeks</span>
                    <strong>{parsedWeekCount}</strong>
                  </div>
                  <div className="planner-chip">
                    <span>Race date</span>
                    <strong>{weekDesign.raceDate || 'Set in Week Focus'}</strong>
                  </div>
                </div>
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
                  const parsedWeek = deriveWeek(week, index, unitSystem);

                  return (
                    <article className="week-card" key={`week-${index + 1}`}>
                      <div className="week-card-header">
                        <div>
                          <p className="week-kicker">{`Wk. ${weekColumns[index]?.weeksToRace ?? index}`}</p>
                        </div>
                        <div className="week-badge-row">
                          <span className="week-badge">Z1 {formatMinutes(parsedWeek.z1Minutes)}</span>
                          <span className="week-badge">LR {formatMinutes(parsedWeek.longRunMinutes)}</span>
                        </div>
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

                        <label className="field-group">
                          <span className="field-label">{`Elevation (${getElevationUnitLabel(unitSystem)})`}</span>
                          <input
                            className="text-input"
                            min={0}
                            onChange={(event) => updateWeek(index, 'elevation', event.target.value)}
                            type="number"
                            value={week.elevation}
                          />
                        </label>
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
                      <button
                        className="secondary-button planner-panel-button"
                        onClick={addPhaseBlock}
                        type="button"
                      >
                        Add Phase Goal
                      </button>
                    </div>

                    {weekDesign.phaseBlocks.length === 0 ? null : (
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
                      <button
                        className="secondary-button planner-panel-button"
                        onClick={addCustomFocusRow}
                        type="button"
                      >
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
                      <th
                        className="calendar-sticky-column calendar-head-cell calendar-summary-head calendar-prescribed-head"
                        scope="col"
                      >
                        Prescribed
                      </th>
                      <th
                        className="calendar-sticky-column calendar-head-cell calendar-summary-head calendar-scheduled-head"
                        scope="col"
                      >
                        Scheduled
                      </th>
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayLabel) => (
                        <th className="calendar-head-cell" key={dayLabel} scope="col">
                          {dayLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weekColumns.map((column, weekIndex) => {
                      const weekDates = getWeekDates(column.startDate);
                      const scheduledSummary = summarizeWeekSchedule(weekDates, scheduledWorkouts, unitSystem);
                      const prescribedWeek = getPrescribedWeek(parsedWeeks, weekIndex);
                      const focusSummary = chartFocusAbbreviations[weekIndex]?.join(' ') || '-';

                      return (
                        <tr key={`calendar-week-${weekIndex + 1}`}>
                          <th className="calendar-sticky-column calendar-week-label" scope="row">
                            <div className="calendar-week-meta">
                              <strong>{`Wk. ${column.weeksToRace}`}</strong>
                              <span>{`${column.weeksToRace} w to race`}</span>
                              {weekDates.length > 0 ? (
                                <span>{formatDateRange(weekDates[0], weekDates[6])}</span>
                              ) : null}
                            </div>
                          </th>

                          <td className="calendar-sticky-column calendar-summary-cell calendar-prescribed-cell">
                            <div className="calendar-summary-grid">
                              <span className="calendar-summary-line">
                                <span className="calendar-summary-label">Total</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatMinutes(prescribedWeek.totalMinutes)}
                                </span>
                              </span>
                              <span className="calendar-summary-line">
                                <span className="calendar-summary-label">Z3</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatMinutes(prescribedWeek.z3Minutes)}
                                </span>{' '}
                                <span className="calendar-summary-label">Z2</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatMinutes(prescribedWeek.z2Minutes)}
                                </span>{' '}
                                <span className="calendar-summary-label">Z1</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatMinutes(prescribedWeek.z1Minutes)}
                                </span>
                              </span>
                              <span className="calendar-summary-line">
                                <span className="calendar-summary-label">Elev</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatElevation(prescribedWeek.elevationMeters, unitSystem)}
                                </span>
                              </span>
                              <span className="calendar-summary-line">
                                <span className="calendar-summary-label">Long</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatPercent(
                                    prescribedWeek.totalMinutes > 0
                                      ? (prescribedWeek.longRunMinutes / prescribedWeek.totalMinutes) *
                                          100
                                      : 0,
                                  )}
                                </span>
                              </span>
                              <span className="calendar-summary-line">
                                <span className="calendar-summary-label">Focus:</span>{' '}
                                <span className="calendar-summary-value">{focusSummary}</span>
                              </span>
                            </div>
                          </td>

                          <td className="calendar-sticky-column calendar-summary-cell calendar-scheduled-cell">
                            <div className="calendar-summary-grid">
                              <span className="calendar-summary-line">
                                <span className="calendar-summary-label">Total</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatMinutes(scheduledSummary.totalMinutes)}
                                </span>
                              </span>
                              <span className="calendar-summary-line">
                                <span className="calendar-summary-label">Z3</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatMinutes(scheduledSummary.z3Minutes)}
                                </span>{' '}
                                <span className="calendar-summary-label">Z2</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatMinutes(scheduledSummary.z2Minutes)}
                                </span>{' '}
                                <span className="calendar-summary-label">Z1</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatMinutes(scheduledSummary.z1Minutes)}
                                </span>
                              </span>
                              <span className="calendar-summary-line">
                                <span className="calendar-summary-label">Elev</span>{' '}
                                <span className="calendar-summary-value">
                                  {formatElevation(scheduledSummary.elevationMeters, unitSystem)}
                                </span>
                              </span>
                              <span className="calendar-summary-line">
                                <span className="calendar-summary-label">Sessions</span>{' '}
                                <span className="calendar-summary-value">
                                  {scheduledSummary.workoutCount}
                                </span>
                              </span>
                            </div>
                          </td>

                          {weekDates.map((date) => {
                            const dateKey = formatDateKey(date);
                            const workout = scheduledWorkouts[dateKey];
                            const parsedWorkout = workout ? deriveDayWorkout(workout, unitSystem) : null;
                            const hasWorkout = workout ? hasDayWorkoutContent(workout) : false;
                            const workoutTypeLabel = workout ? getWorkoutTypeLabel(workout.type) : '';
                            const showWorkoutElevation =
                              !!workout &&
                              isEnduranceWorkoutType(workout.type) &&
                              workout.elevation.trim() !== '';

                            return (
                              <td className="calendar-day-cell" key={dateKey}>
                                <button
                                  className={`calendar-day-button ${
                                    hasWorkout ? 'calendar-day-button-filled' : ''
                                  }`}
                                  onClick={() => openCalendarDay(date)}
                                  type="button"
                                >
                                  <span className="calendar-day-heading">
                                    <span className="calendar-day-date">{date.getDate()}</span>
                                    <span className="calendar-day-month">
                                      {date.toLocaleDateString(undefined, { month: 'short' })}
                                    </span>
                                  </span>
                                  {hasWorkout && parsedWorkout ? (
                                    <>
                                      {workout?.title.trim() ? (
                                        <span className="calendar-day-title">{workout.title.trim()}</span>
                                      ) : null}
                                      {workoutTypeLabel ? (
                                        <span className="calendar-day-type">{workoutTypeLabel}</span>
                                      ) : null}
                                      {!isRestWorkoutType(workout?.type ?? '') ? (
                                        <>
                                          <span className="calendar-day-metric">
                                            {buildDayWorkoutMetricLine(parsedWorkout)}
                                          </span>
                                          <span className="calendar-day-submetric">
                                            {showWorkoutElevation
                                              ? formatElevation(parsedWorkout.elevationMeters, unitSystem)
                                              : '-'}
                                          </span>
                                        </>
                                      ) : null}
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

      {isInstructionsModalOpen ? (
        <div className="modal-backdrop" onClick={closeInstructionsModal} role="presentation">
          <div
            aria-labelledby="instructions-modal-title"
            aria-modal="true"
            className="modal-card instructions-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">How To Use</p>
                <h3 id="instructions-modal-title" className="modal-title">
                  Training Plan Builder Instructions
                </h3>
              </div>
              <button className="modal-close" onClick={closeInstructionsModal} type="button">
                x
              </button>
            </div>

            <div className="instructions-copy">
              <section className="instructions-section">
                <h4>Week Focus</h4>
                <p>
                  Start here. Set the number of weeks in your build and your race date, then map out
                  what each week is meant to do.
                </p>
                <p>
                  Use <strong>Event Name</strong> and <strong>Event Grade</strong> to mark tune-up
                  races, key races, and lower-priority events. The event grade also feeds into the
                  left-side chart background so you can immediately see where the most important weeks
                  sit.
                </p>
                <p>
                  Add <strong>Phase Goals</strong> when you want several weeks grouped together under
                  one development block, for example base, climbing, race-specific work, or taper.
                </p>
                <p>
                  Use the <strong>Focus Rows</strong> grid to mark the main emphasis of each week.
                  You can keep the default rows or add custom ones. The abbreviations you select here
                  also appear underneath the chart columns on the left.
                </p>
              </section>

              <section className="instructions-section">
                <h4>Volume Design</h4>
                <p>
                  Once the structure is clear, move to Volume Design and enter the training load for
                  each week.
                </p>
                <p>
                  Total Time sets the full height of the weekly bar. Z3 and Z2 are entered directly,
                  while Z1 is calculated automatically from whatever time remains.
                </p>
                <p>
                  Long Run is entered as a percentage of total time, and elevation is tracked
                  separately on the right axis. As you enter the weekly targets, the left-side chart
                  updates immediately.
                </p>
                <p>
                  The summary strip above the chart gives you the total volume, total time, time in
                  zone, and total elevation across the full plan.
                </p>
                <p>
                  Use the <strong>Metric / Imperial</strong> toggle above the planner tabs whenever
                  you want elevation displayed in meters or feet. The app updates the elevation
                  labels and values across the planner when you switch.
                </p>
              </section>

              <section className="instructions-section">
                <h4>Calendar</h4>
                <p>
                  Use the Calendar tab to turn the weekly plan into day-by-day sessions. The
                  prescribed column stays tied to Volume Design, while the scheduled column rolls up
                  what you actually enter for each day.
                </p>
                <p>
                  Click any day to open the daily workout modal. You can give the session a title,
                  choose a workout type, enter time and zone details where relevant, add elevation,
                  and keep notes for context or reminders.
                </p>
                <p>
                  Rest days can be planned directly, and different workout types only show the fields
                  that matter for that type. The calendar cells then display the title, type, session
                  breakdown, and elevation in a compact format.
                </p>
              </section>

              <section className="instructions-section">
                <h4>Push to Intervals.icu</h4>
                <p>
                  Use the <strong>Push to Intervals.icu</strong> button when you want to send the
                  visible calendar plan to your Intervals account. Nothing is sent automatically. The
                  push only happens when you open that modal, enter your API key, and press
                  <strong> Update</strong>.
                </p>
                <p>
                  New calendar entries are created in Intervals.icu, previously synced entries are
                  updated using their stored ICU ID, and entries you removed locally can be deleted on
                  the next push.
                </p>
                <p>
                  The progress bar in the modal shows how many entries have already been processed and
                  how many remain. After a successful push, the returned Intervals.icu ID is stored in
                  the planner so future updates target the correct event.
                </p>
                <p>
                  The API key is only kept in memory for the session. If you need one, create it in
                  Intervals.icu under <strong>Settings &gt; Developer Settings</strong>.
                </p>
              </section>

              <section className="instructions-section">
                <h4>Feedback</h4>
                <p>
                  If you find a bug, report it on{' '}
                  <a
                    href="https://github.com/nikimicallef/training-plan-overview/issues"
                    rel="noreferrer"
                    target="_blank"
                  >
                    GitHub Issues
                  </a>{' '}
                  or contact me at{' '}
                  <a href="mailto:niki@bornonthetrail.com">niki@bornonthetrail.com</a>.
                </p>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {isIntervalsModalOpen ? (
        <div className="modal-backdrop" onClick={closeIntervalsModal} role="presentation">
          <div
            aria-labelledby="intervals-modal-title"
            aria-modal="true"
            className="modal-card intervals-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Intervals.icu</p>
                <h3 id="intervals-modal-title" className="modal-title">
                  Push Calendar Entries
                </h3>
              </div>
              <button className="modal-close" onClick={closeIntervalsModal} type="button">
                x
              </button>
            </div>

            <label className="field-group">
              <span className="field-label field-label-inline">
                API Key
                <span className="hover-help">
                  <button
                    aria-label="How to create an Intervals.icu API key"
                    className="hover-help-trigger"
                    type="button"
                  >
                    ?
                  </button>
                  <span className="hover-help-popover" role="tooltip">
                    Create an API Key under Settings &gt; Developer Settings.
                  </span>
                </span>
              </span>
              <input
                autoComplete="off"
                className="text-input"
                onChange={(event) => setIntervalsApiKey(event.target.value)}
                type="password"
                value={intervalsApiKey}
              />
            </label>

            <p className="helper-text">
              The API key is kept in memory only for this browser session.
            </p>

            <section className="intervals-progress-panel">
              <div
                aria-hidden="true"
                className="intervals-progress-bar"
              >
                <span
                  style={{
                    width:
                      intervalsSyncState.total > 0
                        ? `${(intervalsSyncState.completed / intervalsSyncState.total) * 100}%`
                        : '0%',
                  }}
                />
              </div>

              <div className="intervals-progress-meta">
                <span>{`${intervalsSyncState.completed} sent`}</span>
                <span>{`${Math.max(intervalsSyncState.total - intervalsSyncState.completed, 0)} remaining`}</span>
              </div>

              {intervalsSyncState.statusMessage ? (
                <p className="helper-text">{intervalsSyncState.statusMessage}</p>
              ) : null}

              {intervalsSyncState.total > 0 ? (
                <div className="intervals-progress-summary">
                  <span>{`Created ${intervalsSyncState.created}`}</span>
                  <span>{`Updated ${intervalsSyncState.updated}`}</span>
                  <span>{`Deleted ${intervalsSyncState.deleted}`}</span>
                  <span>{`Failed ${intervalsSyncState.failed}`}</span>
                </div>
              ) : null}
            </section>

            {intervalsSyncState.failures.length > 0 ? (
              <ul className="error-list modal-error-list">
                {intervalsSyncState.failures.map((failure) => (
                  <li key={failure}>{failure}</li>
                ))}
              </ul>
            ) : null}

            <div className="modal-actions">
              <button className="secondary-button" onClick={closeIntervalsModal} type="button">
                {isSyncingIntervals ? 'Syncing...' : 'Close'}
              </button>
              <div className="modal-actions-right">
                <button
                  className="primary-button"
                  disabled={!intervalsApiKey.trim() || isSyncingIntervals}
                  onClick={handlePushToIntervals}
                  type="button"
                >
                  {isSyncingIntervals ? 'Updating...' : 'Update'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
              <label className="field-group">
                <span className="field-label">Title</span>
                <input
                  className="text-input"
                  maxLength={30}
                  onChange={(event) => updateCalendarDraft('title', event.target.value)}
                  type="text"
                  value={calendarDraft.title}
                />
              </label>

              <label className="field-group">
                <span className="field-label">Intervals.icu ID</span>
                <input
                  className="text-input"
                  readOnly
                  type="text"
                  value={calendarDraft.intervalsIcuId || 'Not pushed yet'}
                />
              </label>
            </div>

            <fieldset className="modal-type-group">
              <legend className="field-label modal-type-legend">Type</legend>
              <div className="modal-type-options">
                {WORKOUT_TYPE_OPTIONS.map((option) => (
                  <label className="radio-pill" key={option.value}>
                    <input
                      checked={calendarDraft.type === option.value}
                      name="calendar-workout-type"
                      onChange={() => updateCalendarWorkoutType(option.value)}
                      type="radio"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {isEnduranceWorkoutType(calendarDraft.type) ? (
              <div className="modal-grid">
                <label className="field-group">
                  <span className="field-label">Time</span>
                  <input
                    className="text-input"
                    onChange={(event) => updateCalendarDraft('totalTime', event.target.value)}
                    type="text"
                    value={calendarDraft.totalTime}
                  />
                </label>

                <label className="field-group">
                  <span className="field-label">Time in Z3</span>
                  <input
                    className="text-input"
                    onChange={(event) => updateCalendarDraft('z3Time', event.target.value)}
                    type="text"
                    value={calendarDraft.z3Time}
                  />
                </label>

                <label className="field-group">
                  <span className="field-label">Time in Z2</span>
                  <input
                    className="text-input"
                    onChange={(event) => updateCalendarDraft('z2Time', event.target.value)}
                    type="text"
                    value={calendarDraft.z2Time}
                  />
                </label>

                <label className="field-group">
                  <span className="field-label">{`Elevation (${getElevationUnitLabel(unitSystem)})`}</span>
                  <input
                    className="text-input"
                    onChange={(event) => updateCalendarDraft('elevation', event.target.value)}
                    type="number"
                    value={calendarDraft.elevation}
                  />
                </label>
              </div>
            ) : null}

            {isTimeOnlyWorkoutType(calendarDraft.type) ? (
              <div className="modal-grid modal-grid-single">
                <label className="field-group">
                  <span className="field-label">Time</span>
                  <input
                    className="text-input"
                    onChange={(event) => updateCalendarDraft('totalTime', event.target.value)}
                    type="text"
                    value={calendarDraft.totalTime}
                  />
                </label>
              </div>
            ) : null}

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
