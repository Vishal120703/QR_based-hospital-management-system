import { PageHeading } from '../../components';
import { useAdmin } from '../workspace/AdminLayout';
import { ChangePasswordForm } from './ChangePassword';

// The page behind "Change password" in the top bar.
export function ChangePasswordPage() {
  const { token, reportSuccess } = useAdmin();
  return (
    <>
      <PageHeading
        title="Change password"
        description="Choose a new password for your staff account. You stay signed in here; any other device you are signed in on is signed out."
      />
      <ChangePasswordForm
        token={token}
        forced={false}
        onChanged={() =>
          reportSuccess('Password changed. Other devices you were signed in on were signed out.')
        }
      />
    </>
  );
}
