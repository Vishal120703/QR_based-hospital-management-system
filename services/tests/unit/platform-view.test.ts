import { describe, expect, it } from 'vitest';
import {
  clientAuditSnapshot,
  countsByHospital,
  hospitalAuditSnapshot,
  withClientTotals,
} from '../../src/modules/platform/platform-view.js';

describe('platform API and audit views', () => {
  it('indexes aggregate counts once and defaults missing hospitals to zero', () => {
    const counts = countsByHospital([
      { hospitalId: 'one', _count: 3 },
      { hospitalId: 'two', _count: 5 },
    ]);

    expect(counts.get('one')).toBe(3);
    expect(counts.get('missing') ?? 0).toBe(0);
  });

  it('adds hospital totals to a client without changing the client fields', () => {
    expect(
      withClientTotals({ id: 'client', name: 'City Health' }, [
        { activeBeds: 10, activeStaff: 5, openRequests: 2 },
        { activeBeds: 20, activeStaff: 8, openRequests: 4 },
      ]),
    ).toEqual({
      id: 'client',
      name: 'City Health',
      hospitalCount: 2,
      activeBeds: 30,
      activeStaff: 13,
      openRequests: 6,
    });
  });

  it('keeps audit snapshots deliberately small and stable', () => {
    expect(
      clientAuditSnapshot({
        name: 'City Health',
        status: 'ACTIVE',
        contactName: 'Asha',
        contactEmail: 'asha@example.test',
        contactPhone: null,
      }),
    ).toEqual({
      name: 'City Health',
      status: 'ACTIVE',
      contactName: 'Asha',
      contactEmail: 'asha@example.test',
      contactPhone: null,
    });
    expect(
      hospitalAuditSnapshot({
        name: 'Sunrise',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        clientId: 'client',
      }),
    ).toEqual({
      name: 'Sunrise',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      clientId: 'client',
    });
  });
});
