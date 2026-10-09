import { describe, expect, it } from 'vitest';
import {
  describeAuditEntry,
  type NamedKind,
  referencesIn,
} from '../../src/modules/audit/audit-details.js';

const names: Record<string, string> = {
  'membership:m-neha': 'Neha Gupta',
  'membership:m-pavan': 'Pavan Kumar',
  'role:r-care': 'Care Staff',
  'ward:w-surgical': 'Surgical Ward',
  'department:d-nursing': 'Nursing',
};
const nameOf = (kind: NamedKind, id: string) => names[`${kind}:${id}`] ?? null;
const lines = (result: ReturnType<typeof describeAuditEntry>) => ({
  details: result.details.map((item) => `${item.label}: ${item.value}`),
  changes: result.changes.map((item) => `${item.field}: ${item.before} → ${item.after}`),
});

describe('audit entry descriptions', () => {
  it('names the people and things an entry points at', () => {
    expect(
      lines(
        describeAuditEntry(
          'request.assign',
          { status: 'ASSIGNED', previousStatus: 'SUBMITTED', assigneeId: 'm-neha' },
          nameOf,
        ),
      ),
    ).toEqual({ details: ['Assigned to: Neha Gupta'], changes: ['Status: submitted → assigned'] });

    expect(
      lines(
        describeAuditEntry(
          'request.transfer',
          {
            status: 'ASSIGNED',
            previousStatus: 'ACCEPTED',
            assigneeId: 'm-neha',
            previousAssigneeId: 'm-pavan',
            reason: 'Busy with another patient',
          },
          nameOf,
        ),
      ),
    ).toEqual({
      details: ['Reason: Busy with another patient'],
      changes: ['Status: accepted → assigned', 'Assigned to: Pavan Kumar → Neha Gupta'],
    });
  });

  it('lists only the fields that changed, keeping codes as typed', () => {
    const result = describeAuditEntry(
      'ward.update',
      {
        before: { code: 'ICU', name: 'ICU', unitType: 'ICU', active: true, floorId: 'f1' },
        after: {
          code: 'SW',
          name: 'Surgical Ward',
          unitType: 'GENERAL',
          active: true,
          floorId: 'f1',
        },
      },
      nameOf,
    );
    expect(lines(result).changes).toEqual([
      'Code: ICU → SW',
      'Name: ICU → Surgical Ward',
      'Unit type: icu → general',
    ]);
  });

  it('describes duty, roles with where they apply, and counts permissions', () => {
    expect(
      lines(describeAuditEntry('staff.duty', { from: 'ON_DUTY', to: 'OFF_DUTY' }, nameOf)).changes,
    ).toEqual(['Duty: on duty → off duty']);
    expect(
      lines(
        describeAuditEntry(
          'role.assign',
          { roleId: 'r-care', scopeType: 'WARD', scopeId: 'w-surgical' },
          nameOf,
        ),
      ).details,
    ).toEqual(['Role: Care Staff', 'Where: Surgical Ward']);
    expect(
      lines(
        describeAuditEntry(
          'role.update',
          {
            before: { permissionKeys: ['a', 'b', 'c'] },
            after: { permissionKeys: ['a', 'b', 'd', 'e'] },
          },
          nameOf,
        ),
      ).changes,
    ).toEqual(['Permissions: 3 → 4 (2 added, 1 removed)']);
  });

  it('never shows raw ids, and says when a referenced item was removed', () => {
    const result = lines(
      describeAuditEntry(
        'staff.department.add',
        { departmentId: 'd-gone', userId: 'u1', hospitalId: 'h1' },
        nameOf,
      ),
    );
    expect(result.details).toEqual(['Department: a removed item']);
    expect(JSON.stringify(result)).not.toMatch(/u1|h1/);
  });

  it('collects every reference to look up at once', () => {
    expect(
      referencesIn({
        assigneeId: 'm-neha',
        scopeType: 'DEPARTMENT',
        scopeId: 'd-nursing',
        after: { wardId: 'w-surgical' },
      }),
    ).toEqual([
      { kind: 'membership', id: 'm-neha' },
      { kind: 'ward', id: 'w-surgical' },
      { kind: 'department', id: 'd-nursing' },
    ]);
  });
});
