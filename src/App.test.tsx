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
      },
      scheduledWorkouts: {
        '2026-10-29': {
          recovery: true,
          totalTime: null,
          z3Time: null,
          z2Time: null,
          elevation: null,
          notes: null,
        },
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.weeksInput).toBe('3');
    expect(snapshot?.weeks).toHaveLength(3);
    expect(snapshot?.weekDesign.events).toHaveLength(3);
    expect(snapshot?.weekDesign.events[0].eventGrade).toBe('C');
    expect(snapshot?.scheduledWorkouts['2026-10-29']).toEqual({
      recovery: true,
      totalTime: '',
      z3Time: '',
      z2Time: '',
      elevation: '',
      notes: '',
    });
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
            focusRows: [{ id: 'recovery', label: 'Recovery', isCustom: false }],
            focusSelections: { recovery: [false, true] },
            phaseBlocks: [],
          },
          scheduledWorkouts: {
            '2027-02-08': {
              recovery: true,
              totalTime: '',
              z3Time: '',
              z2Time: '',
              elevation: '',
              notes: '',
            },
            '2027-02-09': {
              recovery: false,
              totalTime: '2h',
              z3Time: '30m',
              z2Time: '45m',
              elevation: '200',
              notes: 'Tempo day',
            },
          },
        }),
      ],
      'training-plan-state.json',
      { type: 'application/json' },
    );

    await user.upload(fileInput as HTMLInputElement, file);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Schedule daily sessions against each race week' }),
      ).toBeInTheDocument();
    });

    expect(screen.getAllByText('Recovery').length).toBeGreaterThan(0);
    expect(screen.getByText('2h')).toBeInTheDocument();
    expect(screen.getByText('Note')).toBeInTheDocument();
  });
});

describe('planner snapshot download', () => {
  it('downloads the current planner state as json', async () => {
    const user = userEvent.setup();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Download JSON' }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    await expect(readBlobText(blob as Blob)).resolves.toContain('"weeksInput": "6"');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:planner-state');
    clickSpy.mockRestore();
  });
});
