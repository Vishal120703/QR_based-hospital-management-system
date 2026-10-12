import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, credentials, staffApi, type Me, type StaffMember } from '../src/api';
import { newPasswordProblem } from '../src/features/auth/ChangePassword';
import { ChangePasswordPage } from '../src/features/auth/ChangePasswordPage';
import { StaffDialog } from '../src/features/people/StaffDialog';
import { AdminLayout, type AdminContext } from '../src/features/workspace/AdminLayout';

const me: Me = {
  user: { id: 'user', email: 'ravi@example.test', displayName: 'Ravi' },
  membershipId: 'ravi',
  tenant: {
    hospitalId: 'hospital',
    code: 'TEST',
    name: 'Test Hospital',
    logoUrl: null,
    timezone: 'Asia/Kolkata',
  },
  mustChangePassword: false,
  permissions: ['service.read'],
  scopedPermissions: ['service.read'],
};

function inPage(page: ReactNode, permissions: string[], reportSuccess = vi.fn()) {
  const context: AdminContext = {
    token: 'token',
    me: { ...me, permissions, scopedPermissions: permissions },
    can: (permission) => permissions.includes(permission),
    canAnywhere: (permission) => permissions.includes(permission),
    reportError: vi.fn(),
    reportSuccess,
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

describe('Choosing a new password', () => {
  it('checks the new password before sending it', () => {
    const ok = {
      current: 'old one',
      next: 'a long new passphrase',
      repeat: 'a long new passphrase',
    };
    expect(newPasswordProblem(ok)).toBeNull();
    expect(newPasswordProblem({ ...ok, current: '' })).toBe('Enter your current password.');
    expect(newPasswordProblem({ ...ok, next: 'short', repeat: 'short' })).toBe(
      'The new password needs at least 12 characters.',
    );
    expect(newPasswordProblem({ ...ok, repeat: 'a long new passphrasf' })).toBe(
      'The two new passwords do not match.',
    );
    expect(
      newPasswordProblem({
        current: 'same long phrase',
        next: 'same long phrase',
        repeat: 'same long phrase',
      }),
    ).toBe('Choose a new password, not the current one.');
  });

  it('changes the password and says other devices were signed out', async () => {
    const user = userEvent.setup();
    const change = vi.spyOn(staffApi, 'changePassword').mockResolvedValue(null);
    const reportSuccess = vi.fn();
    inPage(<ChangePasswordPage />, [], reportSuccess);

    await user.type(screen.getByLabelText('Current password'), 'old password here');
    await user.type(screen.getByLabelText('New password'), 'a long new passphrase');
    await user.type(screen.getByLabelText('New password again'), 'a different phrase!!');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText('The two new passwords do not match.')).toBeTruthy();
    expect(change).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('New password again'));
    await user.type(screen.getByLabelText('New password again'), 'a long new passphrase');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(change).toHaveBeenCalledWith('token', {
      currentPassword: 'old password here',
      newPassword: 'a long new passphrase',
    });
    await waitFor(() => expect(reportSuccess).toHaveBeenCalled());
    expect(String(reportSuccess.mock.calls[0]?.[0])).toContain('Other devices');
  });

  it('shows the server’s reason, such as a wrong current password, without signing out', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'changePassword').mockRejectedValue(
      new ApiError(400, 'INVALID_INPUT', 'Your current password is not right.'),
    );
    const context = inPage(<ChangePasswordPage />, []);
    await user.type(screen.getByLabelText('Current password'), 'wrong password');
    await user.type(screen.getByLabelText('New password'), 'a long new passphrase');
    await user.type(screen.getByLabelText('New password again'), 'a long new passphrase');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password is not right.')).toBeTruthy();
    expect(context.reportError).not.toHaveBeenCalled();
  });
});

describe('After an administrator’s reset', () => {
  it('opens nothing until the person chooses a new password', async () => {
    const user = userEvent.setup();
    credentials.setStaff('staff-token');
    const load = vi
      .spyOn(staffApi, 'me')
      .mockResolvedValueOnce({ ...me, mustChangePassword: true })
      .mockResolvedValue(me);
    const change = vi.spyOn(staffApi, 'changePassword').mockResolvedValue(null);
    render(
      <MemoryRouter initialEntries={['/admin/services']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="services" element={<p>Catalog content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    expect(screen.queryByText('Catalog content')).toBeNull();
    expect(screen.queryByRole('link', { name: /Service catalog/ })).toBeNull();

    await user.type(screen.getByLabelText('Temporary password'), 'Temporary passphrase 1');
    await user.type(screen.getByLabelText('New password'), 'My own passphrase 22');
    await user.type(screen.getByLabelText('New password again'), 'My own passphrase 22');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(change).toHaveBeenCalledWith('staff-token', {
      currentPassword: 'Temporary passphrase 1',
      newPassword: 'My own passphrase 22',
    });
    expect(await screen.findByText('Catalog content')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('Resetting someone’s password', () => {
  const member: StaffMember = {
    id: 'meena',
    email: 'meena@example.test',
    displayName: 'Meena',
    status: 'ACTIVE',
    dutyStatus: 'OFF_DUTY',
    dutyChangedAt: null,
    departmentIds: [],
    coverage: [],
    roleIds: [],
  };
  const directory = { staff: [member], departments: [], roles: [], floors: [], wards: [] };

  it('needs 12 characters and a confirmation, then resets', async () => {
    const user = userEvent.setup();
    vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const reset = vi.spyOn(staffApi, 'resetStaffPassword').mockResolvedValue({ staff: member });
    const reportSuccess = vi.fn();
    inPage(
      <StaffDialog
        member={member}
        directory={directory}
        isSelf={false}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
      ['staff.read', 'staff.manage'],
      reportSuccess,
    );
    const button = await screen.findByRole('button', { name: 'Reset password' });
    await user.type(screen.getByLabelText('Temporary password'), 'too short');
    expect(button).toHaveProperty('disabled', true);
    await user.type(screen.getByLabelText('Temporary password'), ' but longer');
    await user.click(button);
    expect(reset).toHaveBeenCalledWith('token', 'meena', 'too short but longer');
    await waitFor(() => expect(reportSuccess).toHaveBeenCalled());
    expect(String(reportSuccess.mock.calls[0]?.[0])).toContain('in person');
  });

  it('is not offered for one’s own account or without staff.manage', () => {
    vi.spyOn(staffApi, 'list').mockResolvedValue([]);
    inPage(
      <StaffDialog
        member={member}
        directory={directory}
        isSelf
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
      ['staff.read', 'staff.manage'],
    );
    expect(screen.queryByRole('button', { name: 'Reset password' })).toBeNull();
  });
});
