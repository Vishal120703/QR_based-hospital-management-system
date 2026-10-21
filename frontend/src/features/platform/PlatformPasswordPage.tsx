import { platformApi } from '../../api';
import { PageHeading } from '../../components';
import { ChangePasswordForm } from '../auth/ChangePassword';
import { usePlatform } from './PlatformLayout';

export function PlatformPasswordPage() {
  const { token, reportSuccess } = usePlatform();
  return (
    <>
      <PageHeading
        title="Change password"
        description="Choose a new password for your platform account. You stay signed in here; every other platform or staff session for this account is signed out."
      />
      <ChangePasswordForm
        token={token}
        forced={false}
        changePassword={platformApi.changePassword}
        onChanged={() =>
          reportSuccess('Password changed. Other devices you were signed in on were signed out.')
        }
      />
    </>
  );
}
