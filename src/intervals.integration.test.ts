/**
 * @vitest-environment node
 *
 * Live Intervals.icu integration tests.
 *
 * Usage:
 * 1. Export `RUN_LIVE_INTERVALS_ICU_TESTS=true`.
 * 2. Export `INTERVALS_ICU_API_KEY=your_real_key`.
 * 3. Run `npm run test:intervals`.
 *
 * These tests create real calendar events on the account that owns the API key.
 * They also clean up after themselves by deleting any created test events.
 */

import { afterAll, describe, expect, it } from 'vitest';

const PROCESS_ENV = (
  globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  }
).process?.env ?? {};

type FileReaderModule = {
  readFileSync(path: string, encoding: string): string;
};

function loadDotEnvLocal(): Record<string, string> {
  const nodeRequire = (
    globalThis as {
      require?: (id: string) => unknown;
    }
  ).require;

  if (!nodeRequire) {
    return {};
  }

  try {
    const fs = nodeRequire('node:fs') as FileReaderModule;
    const source = fs.readFileSync('.env.local', 'utf8');

    return Object.fromEntries(
      source
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line) => {
          const separatorIndex = line.indexOf('=');

          if (separatorIndex === -1) {
            return ['', ''];
          }

          const key = line.slice(0, separatorIndex).trim();
          const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/gu, '');

          return [key, value];
        })
        .filter(([key]) => key !== ''),
    );
  } catch {
    return {};
  }
}

const FILE_ENV = loadDotEnvLocal();
const ENV = {
  ...FILE_ENV,
  ...PROCESS_ENV,
};

const RUN_LIVE_INTERVALS_ICU_TESTS = ENV.RUN_LIVE_INTERVALS_ICU_TESTS === 'true';
const INTERVALS_ICU_API_KEY = ENV.INTERVALS_ICU_API_KEY ?? '';
const INTERVALS_BASE_URL = 'https://intervals.icu/api/v1/athlete/0/events';

type IntervalsCreatePayload = {
  category: 'WORKOUT' | 'NOTE';
  start_date_local: string;
  name?: string;
  description?: string;
  type?: string;
  moving_time?: number;
  external_id: string;
};

type IntervalsEventResponse = {
  id: number | string;
  name?: string;
  description?: string;
  category?: string;
  type?: string;
  moving_time?: number;
  start_date_local?: string;
  external_id?: string;
};

const createdEventIds = new Set<string>();

function requireApiKey() {
  if (!INTERVALS_ICU_API_KEY.trim()) {
    throw new Error(
      'Set INTERVALS_ICU_API_KEY in the environment before running live Intervals.icu tests.',
    );
  }
}

function buildAuthHeader() {
  return `Basic ${globalThis.btoa(`API_KEY:${INTERVALS_ICU_API_KEY}`)}`;
}

async function requestIntervals<T>(
  path: string,
  options: {
    method: 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
  },
): Promise<T> {
  requireApiKey();

  const headers = new Headers({
    Authorization: buildAuthHeader(),
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
    const errorMessage =
      typeof parsed === 'string'
        ? parsed
        : typeof parsed === 'object' &&
            parsed !== null &&
            'error' in parsed &&
            typeof parsed.error === 'string'
          ? parsed.error
          : `${options.method} ${path} failed with ${response.status}`;

    throw new Error(errorMessage);
  }

  return parsed as T;
}

function createUniqueMarker(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createWorkoutPayload(
  label: string,
  overrides: Partial<IntervalsCreatePayload> = {},
): IntervalsCreatePayload {
  const marker = createUniqueMarker(label);

  return {
    category: 'WORKOUT',
    start_date_local: '2027-02-08T00:00:00',
    name: marker,
    description: `Z3 10m / Z2 20m / Z1 30m\nElevation 300 m\nIntegration test ${marker}`,
    moving_time: 3600,
    external_id: `training-plan-overview:test:${marker}`,
    ...overrides,
  };
}

async function createEvent(payload: IntervalsCreatePayload) {
  const response = await requestIntervals<IntervalsEventResponse>('', {
    method: 'POST',
    body: payload,
  });

  const id = String(response.id);
  createdEventIds.add(id);
  return response;
}

async function updateEvent(eventId: string, payload: IntervalsCreatePayload) {
  return requestIntervals<IntervalsEventResponse>(`/${eventId}`, {
    method: 'PUT',
    body: payload,
  });
}

async function deleteEvent(eventId: string) {
  await requestIntervals<unknown>(`/${eventId}`, {
    method: 'DELETE',
  });
  createdEventIds.delete(eventId);
}

afterAll(async () => {
  if (!RUN_LIVE_INTERVALS_ICU_TESTS || !INTERVALS_ICU_API_KEY.trim()) {
    return;
  }

  for (const eventId of [...createdEventIds]) {
    try {
      await deleteEvent(eventId);
    } catch {
      // Best-effort cleanup for live tests.
    }
  }
});

const describeLive = RUN_LIVE_INTERVALS_ICU_TESTS ? describe : describe.skip;

describeLive('Intervals.icu live integration', () => {
  it('creates one event for every supported workout mapping, including rest as a note', async () => {
    const scenarios: Array<{
      label: string;
      payload: IntervalsCreatePayload;
      expected: {
        category: string;
        type?: string;
        movingTime?: number;
      };
    }> = [
      {
        label: 'road-run',
        payload: createWorkoutPayload('road-run', { type: 'Run' }),
        expected: { category: 'WORKOUT', type: 'Run', movingTime: 3600 },
      },
      {
        label: 'trail-run',
        payload: createWorkoutPayload('trail-run', { type: 'Trail Run' }),
        expected: { category: 'WORKOUT', type: 'Trail Run', movingTime: 3600 },
      },
      {
        label: 'cycling',
        payload: createWorkoutPayload('cycling', { type: 'Ride' }),
        expected: { category: 'WORKOUT', type: 'Ride', movingTime: 3600 },
      },
      {
        label: 'hiking',
        payload: createWorkoutPayload('hiking', { type: 'Other Workout' }),
        expected: { category: 'WORKOUT', type: 'Other Workout', movingTime: 3600 },
      },
      {
        label: 'strength',
        payload: createWorkoutPayload('strength', { type: 'WeightTraining' }),
        expected: { category: 'WORKOUT', type: 'WeightTraining', movingTime: 3600 },
      },
      {
        label: 'other',
        payload: createWorkoutPayload('other', { type: 'Other Workout' }),
        expected: { category: 'WORKOUT', type: 'Other Workout', movingTime: 3600 },
      },
      {
        label: 'rest',
        payload: {
          category: 'NOTE',
          start_date_local: '2027-02-09T00:00:00',
          name: 'Rest Day',
          description: `Integration test ${createUniqueMarker('rest-note')}`,
          external_id: `training-plan-overview:test:${createUniqueMarker('rest-external')}`,
        },
        expected: { category: 'NOTE' },
      },
    ];

    for (const scenario of scenarios) {
      const response = await createEvent(scenario.payload);

      expect(response.id).toBeTruthy();
      expect(response.category).toBe(scenario.expected.category);

      if (scenario.expected.type) {
        expect(response.type).toBe(scenario.expected.type);
      }

      if (scenario.expected.movingTime !== undefined) {
        expect(response.moving_time).toBe(scenario.expected.movingTime);
      }

      expect(response.external_id).toBe(scenario.payload.external_id);
    }
  });

  it('updates an existing event using its Intervals.icu id', async () => {
    const created = await createEvent(
      createWorkoutPayload('update-source', {
        type: 'Trail Run',
      }),
    );
    const eventId = String(created.id);
    const updatedPayload = createWorkoutPayload('update-target', {
      start_date_local: '2027-02-10T00:00:00',
      type: 'Ride',
      name: `Updated-${createUniqueMarker('name')}`,
      description: 'Z3 5m / Z2 15m / Z1 40m\nElevation 650 m\nUpdated by integration test',
      moving_time: 5400,
      external_id: created.external_id ?? `training-plan-overview:test:${createUniqueMarker('update')}`,
    });

    const updated = await updateEvent(eventId, updatedPayload);

    expect(String(updated.id)).toBe(eventId);
    expect(updated.name).toBe(updatedPayload.name);
    expect(updated.type).toBe('Ride');
    expect(updated.moving_time).toBe(5400);
    expect(updated.description).toContain('Updated by integration test');
  });

  it('deletes an existing event using its Intervals.icu id', async () => {
    const created = await createEvent(
      createWorkoutPayload('delete-source', {
        type: 'Run',
      }),
    );
    const eventId = String(created.id);

    await expect(deleteEvent(eventId)).resolves.toBeUndefined();
  });
});
