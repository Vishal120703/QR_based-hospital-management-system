import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { staffApi, type Role, type StaffMember } from '../src/api';
import { type AdminContext } from '../src/pages/AdminLayout';
import { RolesPage } from '../src/pages/RolesPage';
import { StaffDialog } from '../src/pages/StaffDialog';

const roles: Role[] = [
  {
    id: 'manager',
    name: 'Hospital Manager',
    active: true,
    scopeLevel: 'HOSPITAL',
    systemKey: 'HOSPITAL_MANAGER',
    permissionKeys: ['request.read'],
    memberCount: 1,
    builtIn: true,
    locked: true,
  },
  {
    id: 'floor',
    name: 'Floor Manager',
    active: true,
    scopeLevel: 'FLOOR',
    systemKey: 'FLOOR_MANAGER',
    permissionKeys: ['request.read', 'request.assign', 'bed.read'],
    memberCount: 0,
    builtIn: true,
    locked: false,
  },
];

function show(page: ReactNode, permissions: string[]) {
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
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/" element={page} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return context;
}

const manager = ['role.read', 'role.manage', 'request.read', 'request.assign', 'staff.read'];

describe('Roles & access', () => {
  it('shows the hierarchy and keeps the Hospital Manager role locked', async () => {
    vi.spyOn(staffApi, 'roles').mockResolvedValue(roles);
    show(<RolesPage />, manager);
    const managerCard = (
      await screen.findByRole('heading', { name: 'Hospital Manager', level: 2 })
    ).closest('article')!;
    expect(within(managerCard).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(managerCard.textContent).toContain('every permission');
    const floorCard = screen
      .getByRole('heading', { name: 'Floor Manager', level: 2 })
      .closest('article')!;
    expect(within(floorCard).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(floorCard.textContent).toContain('One floor');
  });

  it('creates a department-level role with only permissions the creator holds', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'roles').mockResolvedValue(roles);
    const create = vi.spyOn(staffApi, 'createRole').mockResolvedValue({
      id: 'new',
      name: 'Physio Lead',
      active: true,
    });
    show(<RolesPage />, manager);
    await user.click(await screen.findByRole('button', { name: 'Create role' }));
    await user.type(screen.getByRole('textbox', { name: 'Role name' }), 'Physio Lead');
    await user.selectOptions(screen.getByRole('combobox', { name: /Applies to/ }), 'DEPARTMENT');
    await user.click(screen.getByRole('checkbox', { name: 'See requests' }));
    await user.click(screen.getByRole('checkbox', { name: 'Assign requests to staff' }));
    // Not held by this manager, so it cannot be handed out.
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Change the hospital layout' })
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Create role (2)' }));
    expect(create).toHaveBeenCalledWith('token', {
      name: 'Physio Lead',
      description: null,
      scopeLevel: 'DEPARTMENT',
      permissionKeys: ['request.read', 'request.assign'],
    });
  });
});

describe('Giving a role for one place', () => {
  const member: StaffMember = {
    id: 'meera',
    email: 'meera@example.test',
    displayName: 'Meera',
    status: 'ACTIVE',
    dutyStatus: 'OFF_DUTY',
    dutyChangedAt: null,
    departmentIds: [],
    coverage: [],
    roleIds: ['floor'],
    roleAssignments: [{ roleId: 'floor', scopes: [{ type: 'FLOOR', id: 'floor-a' }] }],
  };
  const directory = {
    staff: [member],
    departments: [],
    roles,
    floors: [
      { id: 'floor-a', code: 'FA', name: 'Floor A', active: true, buildingId: null, level: 1 },
      { id: 'floor-b', code: 'FB', name: 'Floor B', active: true, buildingId: null, level: 2 },
    ],
    wards: [],
  };

  it('asks which floor, offers only floors not held yet, and removes one place', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    const assign = vi.spyOn(staffApi, 'assignRole').mockResolvedValue({});
    const remove = vi.spyOn(staffApi, 'removeRole').mockResolvedValue(null);
    show(
      <StaffDialog
        member={member}
        directory={directory}
        isSelf={false}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
      [...manager, 'staff.manage', 'location.read'],
    );
    expect(await screen.findByText('Floor Manager · Floor A')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role to add' }), 'floor');
    const place = screen.getByRole('combobox', { name: 'Where the role applies' });
    expect(within(place).queryByRole('option', { name: 'Floor A' })).toBeNull();
    await user.selectOptions(place, 'floor-b');
    await user.click(within(place.closest('.inline-form')!).getByRole('button', { name: 'Add' }));
    expect(assign).toHaveBeenCalledWith('token', 'meera', 'floor', 'floor-b');

    await user.click(screen.getByRole('button', { name: 'Remove Floor Manager · Floor A' }));
    expect(remove).toHaveBeenCalledWith('token', 'meera', 'floor', 'floor-a');
  });
});
