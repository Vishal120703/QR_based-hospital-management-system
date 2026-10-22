import type { BulkStaffRow, CoverageInput, RoleScopeLevel } from '../../api';
import type { Directory } from './staff-directory';

type Cell = string | number | boolean | Date | null;
type Column =
  'displayName' | 'email' | 'password' | 'role' | 'roleScope' | 'departments' | 'coverage';

export interface StaffImportPreview {
  rowNumber: number;
  displayName: string;
  email: string;
  role: string;
  departments: string;
  coverage: string;
}

export interface StaffImportResult {
  rows: BulkStaffRow[];
  preview: StaffImportPreview[];
  errors: string[];
}

const headerAliases: Record<string, Column> = {
  fullname: 'displayName',
  displayname: 'displayName',
  name: 'displayName',
  email: 'email',
  emailaddress: 'email',
  temporarypassword: 'password',
  temppassword: 'password',
  password: 'password',
  role: 'role',
  rolescope: 'roleScope',
  scope: 'roleScope',
  department: 'departments',
  departments: 'departments',
  coverage: 'coverage',
};

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const text = (value: Cell | undefined) =>
  value instanceof Date
    ? value.toISOString()
    : value === null || value === undefined
      ? ''
      : String(value).trim();

function lookup<T extends { id: string; name: string; code?: string }>(
  items: T[],
  value: string,
): T | undefined {
  const wanted = value.trim().toLowerCase();
  return items.find(
    (item) =>
      item.id.toLowerCase() === wanted ||
      item.name.trim().toLowerCase() === wanted ||
      item.code?.trim().toLowerCase() === wanted,
  );
}

function rolePlaces(directory: Directory, level: RoleScopeLevel) {
  if (level === 'FLOOR') return directory.floors;
  if (level === 'WARD') return directory.wards;
  if (level === 'DEPARTMENT') return directory.departments;
  return [];
}

function parseCoverage(
  value: string,
  directory: Directory,
): { values: CoverageInput[]; error?: string } {
  if (!value) return { values: [] };
  const values: CoverageInput[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/[;,|]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    if (/^(hospital|whole hospital)$/i.test(entry)) {
      if (!seen.has('HOSPITAL')) values.push({ scopeType: 'HOSPITAL' });
      seen.add('HOSPITAL');
      continue;
    }
    const match = /^(floor|ward)\s*:\s*(.+)$/i.exec(entry);
    if (!match) {
      return { values, error: `Coverage “${entry}” must be Hospital, Floor: code, or Ward: code.` };
    }
    const kind = match[1]!.toUpperCase() as 'FLOOR' | 'WARD';
    const place =
      kind === 'FLOOR' ? lookup(directory.floors, match[2]!) : lookup(directory.wards, match[2]!);
    if (!place?.active)
      return {
        values,
        error: `${kind === 'FLOOR' ? 'Floor' : 'Ward'} “${match[2]}” was not found or is inactive.`,
      };
    const key = `${kind}:${place.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(
      kind === 'FLOOR'
        ? { scopeType: kind, floorId: place.id }
        : { scopeType: kind, wardId: place.id },
    );
  }
  return { values };
}

export function parseStaffTable(cells: Cell[][], directory: Directory): StaffImportResult {
  const errors: string[] = [];
  const rows: BulkStaffRow[] = [];
  const preview: StaffImportPreview[] = [];
  const table = cells.filter((row) => row.some((cell) => text(cell) !== ''));
  if (table.length === 0) return { rows, preview, errors: ['The file is empty.'] };
  if (table.length - 1 > 50) errors.push('A file can contain at most 50 staff rows.');

  const columns = new Map<Column, number>();
  table[0]!.forEach((cell, index) => {
    const label = text(cell);
    if (!label) return;
    const column = headerAliases[normalize(label)];
    if (!column) {
      errors.push(`Unsupported column “${label}”. Download the template for the accepted columns.`);
    } else if (columns.has(column)) {
      errors.push(`Column “${label}” appears more than once.`);
    } else {
      columns.set(column, index);
    }
  });
  for (const [column, label] of [
    ['displayName', 'Full name'],
    ['email', 'Email'],
    ['password', 'Temporary password'],
  ] as const) {
    if (!columns.has(column)) errors.push(`Missing required column “${label}”.`);
  }
  if (errors.length > 0) return { rows, preview, errors };

  const seenEmails = new Map<string, number>();
  table.slice(1, 51).forEach((source, index) => {
    const rowNumber = index + 2;
    const value = (column: Column) => text(source[columns.get(column) ?? -1]);
    const displayName = value('displayName');
    const email = value('email').toLowerCase();
    const password = value('password');
    const roleName = value('role');
    const roleScope = value('roleScope');
    const departmentNames = value('departments');
    const coverageText = value('coverage');
    const problems: string[] = [];

    if (displayName.length < 2 || displayName.length > 120)
      problems.push('Full name must be 2–120 characters.');
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      problems.push('Enter a valid email address.');
    if (password.length < 12 || password.length > 200)
      problems.push('Temporary password must be 12–200 characters.');
    const firstEmailRow = seenEmails.get(email);
    if (email && firstEmailRow !== undefined)
      problems.push(`Email duplicates row ${firstEmailRow}.`);
    else if (email) seenEmails.set(email, rowNumber);

    const role = roleName ? lookup(directory.roles, roleName) : undefined;
    if (roleName && !role?.active)
      problems.push(`Role “${roleName}” was not found or is inactive.`);
    const level = role?.scopeLevel ?? 'HOSPITAL';
    const scopePlace = roleScope ? lookup(rolePlaces(directory, level), roleScope) : undefined;
    if (role && level !== 'HOSPITAL' && !roleScope)
      problems.push(`Role scope is required for the ${role.name} role.`);
    if (roleScope && level === 'HOSPITAL')
      problems.push('Role scope must be blank for a hospital-wide role.');
    if (roleScope && level !== 'HOSPITAL' && !scopePlace?.active)
      problems.push(`Role scope “${roleScope}” was not found or is inactive.`);

    const departmentIds: string[] = [];
    for (const departmentName of departmentNames
      .split(/[;,|]/)
      .map((item) => item.trim())
      .filter(Boolean)) {
      const department = lookup(directory.departments, departmentName);
      if (!department?.active)
        problems.push(`Department “${departmentName}” was not found or is inactive.`);
      else if (!departmentIds.includes(department.id)) departmentIds.push(department.id);
    }
    const coverage = parseCoverage(coverageText, directory);
    if (coverage.error) problems.push(coverage.error);

    if (problems.length > 0) {
      errors.push(...problems.map((problem) => `Row ${rowNumber}: ${problem}`));
      return;
    }
    rows.push({
      displayName,
      email,
      password,
      ...(role ? { roleId: role.id } : {}),
      ...(scopePlace ? { roleScopeId: scopePlace.id } : {}),
      departmentIds,
      coverage: coverage.values,
    });
    preview.push({
      rowNumber,
      displayName,
      email,
      role: role?.name ?? 'No role',
      departments: departmentNames || 'None',
      coverage: coverageText || 'None',
    });
  });
  return { rows, preview, errors };
}

export async function readStaffImport(
  file: File,
  directory: Directory,
): Promise<StaffImportResult> {
  if (file.size > 2 * 1024 * 1024) throw new Error('The file must be 2 MB or smaller.');
  const extension = file.name.toLowerCase().split('.').pop();
  let cells: Cell[][];
  if (extension === 'csv') {
    cells = parseCsv(await readText(file));
  } else if (extension === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser');
    cells = (await readSheet(file)) as unknown as Cell[][];
  } else {
    throw new Error('Choose an .xlsx or .csv file.');
  }
  return parseStaffTable(cells, directory);
}

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The file could not be read as text.'));
    });
    reader.addEventListener('error', () => reject(new Error('The file could not be read.')));
    reader.readAsText(file);
  });
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === '') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('The CSV file has an unclosed quoted field.');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
