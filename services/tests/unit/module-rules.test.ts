import { describe, expect, it } from 'vitest';
import { permissionsExceedCaller, scopeTypeForLevel } from '../../src/modules/roles/role-rules.js';
import { requireActiveStaffLocation } from '../../src/modules/staff/staff-rules.js';

function contextWith(...permissions: string[]) {
  return { hospitalPermissions: new Set(permissions) };
}

describe('module domain rules', () => {
  it('maps every role level to its stored scope type', () => {
    expect(scopeTypeForLevel('HOSPITAL')).toBe('HOSPITAL');
    expect(scopeTypeForLevel('FLOOR')).toBe('FLOOR');
    expect(scopeTypeForLevel('WARD')).toBe('WARD');
    expect(scopeTypeForLevel('DEPARTMENT')).toBe('DEPARTMENT');
  });

  it('detects role permissions the caller cannot manage', () => {
    const context = contextWith('staff.read', 'staff.manage');

    expect(
      permissionsExceedCaller(context, [
        { permissionKey: 'staff.read' },
        { permissionKey: 'staff.manage' },
      ]),
    ).toBe(false);
    expect(
      permissionsExceedCaller(context, [
        { permissionKey: 'staff.read' },
        { permissionKey: 'hospital.manage' },
      ]),
    ).toBe(true);
  });

  it('accepts only active staff coverage locations', () => {
    expect(() => requireActiveStaffLocation({ active: true }, 'floor')).not.toThrow();
    expect(() => requireActiveStaffLocation({ active: false }, 'ward')).toThrow(
      'The ward is inactive.',
    );
    expect(() => requireActiveStaffLocation(null, 'floor')).toThrow(
      'The referenced floor was not found.',
    );
  });
});
