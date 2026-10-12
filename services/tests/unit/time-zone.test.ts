import { describe, expect, it } from 'vitest';
import { addDays, dayIn, isCalendarDay, startOfDay } from '../../src/common/time-zone.js';

describe('Hospital calendar days', () => {
  it('starts a day at local midnight', () => {
    expect(startOfDay('2026-10-12', 'Asia/Kolkata').toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(startOfDay('2026-01-01', 'Asia/Kathmandu').toISOString()).toBe(
      '2025-12-31T18:15:00.000Z',
    );
    expect(startOfDay('2026-01-01', 'Pacific/Kiritimati').toISOString()).toBe(
      '2025-12-31T10:00:00.000Z',
    );
    expect(startOfDay('2026-07-01', 'UTC').toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('handles daylight-saving changes', () => {
    // New York springs forward at 02:00 on 8 March 2026: a 23-hour day.
    const march8 = startOfDay('2026-03-08', 'America/New_York');
    const march9 = startOfDay('2026-03-09', 'America/New_York');
    expect(march8.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(march9.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(march9.getTime() - march8.getTime()).toBe(23 * 3_600_000);
    // London falls back on 25 October 2026: a 25-hour day.
    const october25 = startOfDay('2026-10-25', 'Europe/London');
    const october26 = startOfDay('2026-10-26', 'Europe/London');
    expect(october25.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(october26.getTime() - october25.getTime()).toBe(25 * 3_600_000);
  });

  it('starts a day that skipped midnight at the first moment it has', () => {
    // São Paulo jumped from 00:00 to 01:00 on 4 November 2018.
    expect(startOfDay('2018-11-04', 'America/Sao_Paulo').toISOString()).toBe(
      '2018-11-04T03:00:00.000Z',
    );
  });

  it('names the local day of an instant', () => {
    expect(dayIn(new Date('2026-10-11T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-10-11');
    expect(dayIn(new Date('2026-10-11T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-12');
    expect(dayIn(new Date('2026-10-12T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-11');
  });

  it('checks and counts calendar days', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true);
    for (const value of ['2026-02-29', '2026-13-01', '2026-1-1', '', '12/10/2026']) {
      expect(isCalendarDay(value)).toBe(false);
    }
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-12', -6)).toBe('2026-10-06');
  });
});
