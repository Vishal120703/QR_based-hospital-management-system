import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { staffApi, type Bed, type Building, type Floor, type Ward } from '../src/api';
import { bedCodePrefix, planBulkBeds } from '../src/features/locations/location-types';
import { type AdminContext } from '../src/features/workspace/AdminLayout';
import { LocationsPage } from '../src/features/locations/LocationsPage';

const building: Building = { id: 'b1', code: 'MB', name: 'Main Block', active: true };
const floors: Floor[] = [
  { id: 'f1', code: 'F1', name: 'First Floor', level: 1, buildingId: 'b1', active: true },
  { id: 'f0', code: 'G', name: 'Ground Floor', level: 0, buildingId: 'b1', active: true },
];
const ward: Ward = {
  id: 'w1',
  floorId: 'f1',
  code: 'GW',
  name: 'General Ward',
  unitType: 'GENERAL',
  active: true,
};
const beds: Bed[] = [1, 2].map((number) => ({
  id: `bed-${number}`,
  wardId: 'w1',
  roomId: null,
  code: `GW-0${number}`,
  displayName: `Bed 0${number}`,
  bedType: 'STANDARD',
  status: number === 1 ? 'OCCUPIED' : 'AVAILABLE',
  active: true,
}));

function show(path: string, permissions: string[]) {
  vi.spyOn(staffApi, 'list').mockImplementation((_token, kind) =>
    Promise.resolve(
      (
        {
          buildings: [building],
          floors,
          wards: [ward],
          rooms: [],
          beds,
        } as Record<string, unknown[]>
      )[kind] ?? [],
    ),
  );
  const context: AdminContext = {
    token: 'token',
    me: {
      user: { id: 'user', email: 'admin@example.test', displayName: 'Admin' },
      membershipId: 'admin',
      tenant: { hospitalId: 'hospital', code: 'TEST', name: 'Test Hospital', logoUrl: null },
      permissions,
      scopedPermissions: permissions,
    },
    can: (permission) => permissions.includes(permission),
    canAnywhere: (permission) => permissions.includes(permission),
    reportError: vi.fn(),
    reportSuccess: vi.fn(),
  };
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={<LocationsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const manager = ['location.read', 'location.manage', 'bed.read', 'bed.manage'];

describe('Bed code prefix', () => {
  const main = { id: 'b1', code: 'MAIN' };
  const dayCare = { id: 'b2', code: 'DAY' };

  it('names the floor and unit, so two floors never share codes', () => {
    const general = { code: 'GW' };
    expect(bedCodePrefix(general, { code: 'G', buildingId: null }, [])).toBe('G-GW-');
    expect(bedCodePrefix(general, { code: 'F2', buildingId: null }, [])).toBe('F2-GW-');
  });

  it('adds the building only when the hospital has several', () => {
    const floor = { code: 'G', buildingId: 'b1' };
    expect(bedCodePrefix({ code: 'GW' }, floor, [main])).toBe('G-GW-');
    expect(bedCodePrefix({ code: 'GW' }, floor, [main, dayCare])).toBe('MAIN-G-GW-');
  });

  it('drops the building, then the floor, to stay within 24 characters', () => {
    const floor = { code: 'FIRST-FLOOR', buildingId: 'b1' };
    expect(bedCodePrefix({ code: 'GENERAL' }, floor, [main, dayCare])).toBe('FIRST-FLOOR-GENERAL-');
    expect(bedCodePrefix({ code: 'MALE-MEDICAL-WARD' }, floor, [main, dayCare])).toBe(
      'MALE-MEDICAL-WARD-',
    );
    expect(bedCodePrefix({ code: 'A'.repeat(32) }, floor, []).length).toBe(24);
  });
});

describe('Bulk bed numbering', () => {
  it('numbers beds with zero padding and rooms with a floor prefix', () => {
    const beds = planBulkBeds({
      mode: 'BEDS',
      codePrefix: 'gw-',
      namePrefix: 'Bed',
      start: 9,
      count: 3,
      bedType: 'STANDARD',
    });
    expect(beds.beds.map((bed) => bed.code)).toEqual(['GW-09', 'GW-10', 'GW-11']);
    expect(beds.beds[0]?.displayName).toBe('Bed 09');

    const rooms = planBulkBeds({
      mode: 'ROOMS',
      roomPrefix: '2',
      start: 1,
      count: 2,
      roomType: 'SEMI_PRIVATE',
      bedsPerRoom: 2,
      bedType: 'STANDARD',
    });
    expect(rooms.rooms).toEqual(['201', '202']);
    expect(rooms.beds.map((bed) => bed.code)).toEqual(['201-A', '201-B', '202-A', '202-B']);
    const single = planBulkBeds({
      mode: 'ROOMS',
      roomPrefix: '',
      start: 305,
      count: 1,
      roomType: 'PRIVATE',
      bedsPerRoom: 1,
      bedType: 'STANDARD',
    });
    expect(single.beds).toEqual([{ code: '305', displayName: 'Room 305' }]);
  });
});

describe('Hospital layout screen', () => {
  it('shows buildings, floors by level, and units in the tree', async () => {
    show('/', manager);
    const tree = await screen.findByRole('navigation', { name: 'Hospital layout' });
    const items = within(tree)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '');
    const ground = items.findIndex((text) => text.startsWith('Ground Floor'));
    const first = items.findIndex((text) => text.startsWith('First Floor'));
    expect(ground).toBeGreaterThan(-1);
    expect(ground).toBeLessThan(first);
    expect(items.some((text) => text.startsWith('General Ward'))).toBe(true);
  });

  it('adds numbered beds to a unit, continuing after the existing beds', async () => {
    const user = userEvent.setup();
    const bulk = vi.spyOn(staffApi, 'bulkBeds').mockResolvedValue({ rooms: [], beds: [] });
    show('/?at=ward:w1', manager);
    expect(await screen.findByRole('heading', { name: /General Ward/ })).toBeTruthy();
    const count = screen.getByRole('spinbutton', { name: 'How many beds' });
    await user.clear(count);
    await user.type(count, '3');
    // New codes name the floor too, so the same unit on two floors never repeats.
    expect(screen.getByRole('status').textContent).toContain('Bed 03 (F1-GW-03)');
    await user.click(screen.getByRole('button', { name: 'Add 3 beds' }));
    expect(bulk).toHaveBeenCalledWith('token', 'w1', {
      mode: 'BEDS',
      codePrefix: 'F1-GW-',
      namePrefix: 'Bed',
      start: 3,
      count: 3,
      bedType: 'STANDARD',
    });
  });

  it('fills a new unit from its type, so a maternity ward gets a sensible name and code', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(staffApi, 'create').mockResolvedValue({ ward: { id: 'w2' } });
    show('/?at=floor:f1', manager);
    const unitType = await screen.findByRole('combobox', { name: /Type of unit/ });
    await user.selectOptions(unitType, 'MATERNITY');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'Maternity Ward');
    await user.click(screen.getByRole('button', { name: 'Add unit' }));
    expect(create).toHaveBeenCalledWith('token', 'wards', {
      floorId: 'f1',
      unitType: 'MATERNITY',
      code: 'MAT',
      name: 'Maternity Ward',
    });
  });

  it('does not offer intensive care units', async () => {
    show('/?at=floor:f1', manager);
    const unitType = await screen.findByRole('combobox', { name: /Type of unit/ });
    const options = Array.from(unitType.querySelectorAll('option'), (option) => option.value);
    expect(options).toContain('GENERAL');
    for (const intensive of ['ICU', 'HDU', 'CCU', 'NICU', 'PICU']) {
      expect(options).not.toContain(intensive);
    }
  });

  it('is read-only without manage permissions', async () => {
    show('/?at=ward:w1', ['location.read', 'bed.read']);
    expect(await screen.findByText('You have read-only access to locations.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add \d+ beds/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByText('Bed 02')).toBeTruthy();
  });
});
