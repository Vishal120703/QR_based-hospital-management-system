import { describe, expect, it } from 'vitest';
import { parseCsv, parseStaffTable } from '../src/features/people/staff-import';
import type { Directory } from '../src/features/people/staff-directory';

const directory: Directory = {
  staff: [],
  departments: [
    { id: 'department-nursing', code: 'NURSING', name: 'Nursing', active: true },
    { id: 'department-housekeeping', code: 'HOUSEKEEPING', name: 'Housekeeping', active: true },
  ],
  roles: [
    { id: 'role-nurse', name: 'Nurse', active: true, scopeLevel: 'HOSPITAL' },
    { id: 'role-floor-manager', name: 'Floor Manager', active: true, scopeLevel: 'FLOOR' },
  ],
  floors: [
    {
      id: 'floor-first',
      code: 'F1',
      name: 'First Floor',
      level: 1,
      buildingId: null,
      active: true,
    },
  ],
  wards: [
    {
      id: 'ward-general',
      floorId: 'floor-first',
      code: 'GENERAL',
      name: 'General Ward',
      unitType: 'GENERAL',
      active: true,
    },
  ],
};

describe('staff spreadsheet import', () => {
  it('parses quoted CSV fields and resolves names or codes to trusted IDs', () => {
    const table = parseCsv(
      'Full name,Email,Temporary password,Role,Role scope,Departments,Coverage\r\n' +
        'Asha Kumar,asha@example.test,StrongPass123!,Nurse,,"Nursing; Housekeeping","Hospital; Ward: GENERAL"\r\n' +
        'Ravi Shah,ravi@example.test,AnotherPass123!,Floor Manager,F1,NURSING,Floor: First Floor\r\n',
    );
    const result = parseStaffTable(table, directory);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        displayName: 'Asha Kumar',
        email: 'asha@example.test',
        password: 'StrongPass123!',
        roleId: 'role-nurse',
        departmentIds: ['department-nursing', 'department-housekeeping'],
        coverage: [{ scopeType: 'HOSPITAL' }, { scopeType: 'WARD', wardId: 'ward-general' }],
      },
      {
        displayName: 'Ravi Shah',
        email: 'ravi@example.test',
        password: 'AnotherPass123!',
        roleId: 'role-floor-manager',
        roleScopeId: 'floor-first',
        departmentIds: ['department-nursing'],
        coverage: [{ scopeType: 'FLOOR', floorId: 'floor-first' }],
      },
    ]);
  });

  it('reports row-level mistakes and never returns a partially importable batch', () => {
    const result = parseStaffTable(
      [
        ['Full name', 'Email', 'Temporary password', 'Role', 'Role scope', 'Departments'],
        ['A', 'bad-email', 'short', 'Missing role', '', 'Missing department'],
        ['Valid Name', 'bad-email', 'LongEnoughPassword', 'Floor Manager', '', 'Nursing'],
      ],
      directory,
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Row 2: Full name must be 2–120 characters.',
        'Row 2: Enter a valid email address.',
        'Row 2: Temporary password must be 12–200 characters.',
        'Row 2: Role “Missing role” was not found or is inactive.',
        'Row 2: Department “Missing department” was not found or is inactive.',
        'Row 3: Email duplicates row 2.',
        'Row 3: Role scope is required for the Floor Manager role.',
      ]),
    );
  });

  it('rejects unsupported or missing columns before reading staff data', () => {
    const result = parseStaffTable(
      [
        ['Name', 'Email', 'Phone'],
        ['Asha Kumar', 'asha@example.test', '123'],
      ],
      directory,
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Unsupported column “Phone”. Download the template for the accepted columns.',
        'Missing required column “Temporary password”.',
      ]),
    );
  });
});
