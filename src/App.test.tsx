const {
  htmlToImageToBlobMock,
  jsZipFileMock,
  jsZipGenerateAsyncMock,
  xlsxBookNewMock,
  xlsxAoaToSheetMock,
  xlsxBookAppendSheetMock,
  xlsxWriteMock,
} = vi.hoisted(() => ({
  htmlToImageToBlobMock: vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })),
  jsZipFileMock: vi.fn(),
  jsZipGenerateAsyncMock: vi.fn(async () => new Blob(['zip'], { type: 'application/zip' })),
  xlsxBookNewMock: vi.fn(() => ({ sheets: [] })),
  xlsxAoaToSheetMock: vi.fn(() => ({})),
  xlsxBookAppendSheetMock: vi.fn(),
  xlsxWriteMock: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

vi.mock('html-to-image', () => ({
  toBlob: htmlToImageToBlobMock,
}));

vi.mock('jszip', () => ({
  default: vi.fn().mockImplementation(() => ({
    file: jsZipFileMock,
    generateAsync: jsZipGenerateAsyncMock,
  })),
}));

vi.mock('xlsx', () => ({
  utils: {
    book_new: xlsxBookNewMock,
    aoa_to_sheet: xlsxAoaToSheetMock,
    book_append_sheet: xlsxBookAppendSheetMock,
  },
  write: xlsxWriteMock,
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { sanitizePlannerSnapshot } from './App';

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: vi.fn(() => 'blob:planner-state'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
  htmlToImageToBlobMock.mockResolvedValue({
    arrayBuffer: async () => new ArrayBuffer(8),
  });
  jsZipGenerateAsyncMock.mockResolvedValue(new Blob(['zip'], { type: 'application/zip' }));
});

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read blob text.'));
    reader.readAsText(blob);
  });
}

describe('planner snapshot restore', () => {
  it('sanitizes partial snapshot data with nulls and infers week count', () => {
    const snapshot = sanitizePlannerSnapshot({
      version: 1,
      activeTab: 'calendar',
      weeksInput: null,
      weeks: [null, { totalTime: '4h', z3Time: null, z2Time: '', elevation: null, longRunPercent: '25' }],
      weekDesign: {
        raceDate: '2027-02-14',
        events: [{ eventName: null, eventGrade: 'C' }, null, null],
        focusRows: [{ id: 'recovery', label: 'Recovery', isCustom: false }],
        focusSelections: {
          recovery: [true, false, false],
        },
        phaseBlocks: [
          {
            id: 'phase-1',
            label: 'Base',
            abbreviation: 'BA',
            startWeekIndex: 0,
            endWeekIndex: 1,
          },
        ],
      },
      scheduledWorkouts: {
        '2026-10-29': {
          recovery: true,
          title: null,
          totalTime: null,
          z3Time: null,
          z2Time: null,
          elevation: null,
          notes: null,
        },
        '2026-10-30': {
          recovery: false,
          totalTime: '1h',
          z3Time: '',
          z2Time: '',
          elevation: '',
          notes: 'Legacy workout',
          intervalsIcuId: 48566307,
        },
      },
      pendingIntervalsDeletes: [
        { dateKey: '2026-10-31', intervalsIcuId: 48566308 },
        { dateKey: 'invalid', intervalsIcuId: '' },
      ],
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.unitSystem).toBe('metric');
    expect(snapshot?.weeksInput).toBe('3');
    expect(snapshot?.weeks).toHaveLength(3);
    expect(snapshot?.weekDesign.events).toHaveLength(3);
    expect(snapshot?.weekDesign.events[0].eventGrade).toBe('C');
    expect(snapshot?.weekDesign.focusRows[0].abbreviation).toBe('R');
    expect(snapshot?.weekDesign.phaseBlocks[0].abbreviation).toBe('BA');
    expect(snapshot?.scheduledWorkouts['2026-10-29']).toEqual({
      title: '',
      type: 'rest',
      totalTime: '',
      z3Time: '',
      z2Time: '',
      elevation: '',
      notes: '',
      intervalsIcuId: '',
    });
    expect(snapshot?.scheduledWorkouts['2026-10-30']?.type).toBe('road-run');
    expect(snapshot?.scheduledWorkouts['2026-10-30']?.intervalsIcuId).toBe('48566307');
    expect(snapshot?.pendingIntervalsDeletes).toEqual([
      { dateKey: '2026-10-31', intervalsIcuId: '48566308' },
    ]);
  });

  it('uploads a saved json state without crashing and restores calendar values', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Upload JSON' }));

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(
      [
        JSON.stringify({
          version: 1,
          activeTab: 'calendar',
          unitSystem: 'imperial',
          weeksInput: '2',
          weeks: [
            {
              totalTime: '4h',
              z3Time: '30m',
              z2Time: '1h',
              elevation: '500',
              longRunPercent: '25',
            },
            null,
          ],
          weekDesign: {
            raceDate: '2027-02-14',
            events: [null, null],
            focusRows: [{ id: 'recovery', label: 'Recovery', abbreviation: 'R', isCustom: false }],
            focusSelections: { recovery: [false, true] },
            phaseBlocks: [
              {
                id: 'phase-1',
                label: 'Base',
                abbreviation: 'BA',
                startWeekIndex: 0,
                endWeekIndex: 1,
              },
            ],
          },
          scheduledWorkouts: {
            '2027-02-08': {
              type: 'rest',
              title: 'Off',
              totalTime: '',
              z3Time: '',
              z2Time: '',
              elevation: '',
              notes: '',
              intervalsIcuId: '',
            },
            '2027-02-09': {
              type: 'trail-run',
              title: 'Tempo Climb',
              totalTime: '2h',
              z3Time: '30m',
              z2Time: '45m',
              elevation: '200',
              notes: 'Tempo day',
              intervalsIcuId: 48566309,
            },
          },
          pendingIntervalsDeletes: [{ dateKey: '2027-02-10', intervalsIcuId: 48566310 }],
        }),
      ],
      'training-plan-state.json',
      { type: 'application/json' },
    );

    await user.upload(fileInput as HTMLInputElement, file);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Imperial' })).toHaveClass(
        'unit-switch-button-active',
      );
    });

    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('Trail Run')).toBeInTheDocument();
    expect(screen.getByText('Tempo Climb')).toBeInTheDocument();
    expect(screen.getByText('Note')).toBeInTheDocument();

    await user.click(screen.getByText('Tempo Climb'));
    expect(screen.getByDisplayValue('48566309')).toBeInTheDocument();
  });
});

describe('planner snapshot download', () => {
  it('downloads the current planner state as json', async () => {
    const user = userEvent.setup();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Imperial' }));

    await user.click(screen.getByRole('button', { name: 'Download JSON' }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    const json = await readBlobText(blob as Blob);
    expect(json).toContain('"unitSystem": "imperial"');
    expect(json).toContain('"weeksInput": "6"');
    expect(json).toContain('"abbreviation": "R"');
    expect(json).toContain('"scheduledWorkouts": {}');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:planner-state');
    clickSpy.mockRestore();
  });

  it('preserves typed calendar workouts when downloading json after upload', async () => {
    const user = userEvent.setup();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Upload JSON' }));

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(
      [
        JSON.stringify({
          version: 1,
          activeTab: 'calendar',
          unitSystem: 'metric',
          weeksInput: '1',
          weeks: [
            {
              totalTime: '5h',
              z3Time: '45m',
              z2Time: '1h 30m',
              elevation: '800',
              longRunPercent: '30',
            },
          ],
          weekDesign: {
            raceDate: '2027-02-14',
            events: [null],
            focusRows: [{ id: 'z1-focus', label: 'Z1', abbreviation: 'Z1', isCustom: false }],
            focusSelections: { 'z1-focus': [true] },
            phaseBlocks: [],
          },
          scheduledWorkouts: {
            '2027-02-08': {
              type: 'trail-run',
              title: 'Hill Reps',
              totalTime: '1h 20m',
              z3Time: '20m',
              z2Time: '25m',
              elevation: '450',
              notes: 'Steep climb repeats',
              intervalsIcuId: 48566311,
            },
          },
          pendingIntervalsDeletes: [{ dateKey: '2027-02-09', intervalsIcuId: 48566312 }],
        }),
      ],
      'training-plan-state.json',
      { type: 'application/json' },
    );

    await user.upload(fileInput as HTMLInputElement, file);
    await waitFor(() => expect(screen.getByText('Hill Reps')).toBeInTheDocument());

    vi.mocked(URL.createObjectURL).mockClear();
    vi.mocked(URL.revokeObjectURL).mockClear();

    await user.click(screen.getByRole('button', { name: 'Download JSON' }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0];
    const json = await readBlobText(blob as Blob);

    expect(json).toContain('"title": "Hill Reps"');
    expect(json).toContain('"type": "trail-run"');
    expect(json).toContain('"notes": "Steep climb repeats"');
    expect(json).toContain('"intervalsIcuId": "48566311"');
    expect(json).toContain('"pendingIntervalsDeletes"');
    expect(json).toContain('"dateKey": "2027-02-09"');
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('includes the planner json inside the download package', async () => {
    const user = userEvent.setup();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Upload JSON' }));

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    const file = new File(
      [
        JSON.stringify({
          version: 1,
          activeTab: 'calendar',
          unitSystem: 'metric',
          weeksInput: '1',
          weeks: [
            {
              totalTime: '5h',
              z3Time: '45m',
              z2Time: '1h 30m',
              elevation: '800',
              longRunPercent: '30',
            },
          ],
          weekDesign: {
            raceDate: '2027-02-14',
            events: [null],
            focusRows: [{ id: 'z1-focus', label: 'Z1', abbreviation: 'Z1', isCustom: false }],
            focusSelections: { 'z1-focus': [true] },
            phaseBlocks: [],
          },
          scheduledWorkouts: {
            '2027-02-08': {
              type: 'trail-run',
              title: 'Hill Reps',
              totalTime: '1h 20m',
              z3Time: '20m',
              z2Time: '25m',
              elevation: '450',
              notes: 'Steep climb repeats',
              intervalsIcuId: 48566311,
            },
          },
          pendingIntervalsDeletes: [{ dateKey: '2027-02-09', intervalsIcuId: 48566312 }],
        }),
      ],
      'training-plan-state.json',
      { type: 'application/json' },
    );

    await user.upload(fileInput as HTMLInputElement, file);
    await waitFor(() => expect(screen.getByText('Hill Reps')).toBeInTheDocument());

    vi.mocked(URL.createObjectURL).mockClear();
    vi.mocked(URL.revokeObjectURL).mockClear();

    await user.click(screen.getByRole('button', { name: 'Download Package' }));

    await waitFor(() => {
      expect(jsZipFileMock).toHaveBeenCalledWith(
        'training-plan-state.json',
        expect.stringContaining('"title": "Hill Reps"'),
      );
    });

    expect(jsZipFileMock).toHaveBeenCalledWith('training-plan-chart.png', expect.any(ArrayBuffer));
    expect(jsZipFileMock).toHaveBeenCalledWith('week-focus.png', expect.any(ArrayBuffer));
    expect(jsZipFileMock).toHaveBeenCalledWith('calendar.xlsx', expect.any(Uint8Array));
    expect(jsZipFileMock).toHaveBeenCalledWith(
      'training-plan-state.json',
      expect.stringContaining('"pendingIntervalsDeletes"'),
    );
    expect(jsZipGenerateAsyncMock).toHaveBeenCalledWith({ type: 'blob' });
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
