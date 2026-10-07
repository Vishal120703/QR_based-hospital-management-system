import { useCallback, useRef, useState } from 'react';
import {
  staffApi,
  type Bed,
  type Department,
  type EligibleStaff,
  type Floor,
  type Ward,
} from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useLoad } from '../../lib/use-load';
import { useAdmin } from '../workspace/AdminLayout';

interface Options {
  beds: { id: string; label: string }[];
  departments: Department[];
}

async function loadOptions(token: string): Promise<Options> {
  const [beds, wards, floors, departments] = await Promise.all([
    staffApi.list<Bed>(token, 'beds'),
    staffApi.list<Ward>(token, 'wards'),
    staffApi.list<Floor>(token, 'floors'),
    staffApi.list<Department>(token, 'departments'),
  ]);
  return {
    beds: beds.map((bed) => {
      const ward = wards.find((item) => item.id === bed.wardId);
      const floor = floors.find((item) => item.id === ward?.floorId);
      return {
        id: bed.id,
        label: `${bed.displayName} — ${[ward?.name, floor?.name].filter(Boolean).join(', ')}${bed.active ? '' : ' (inactive)'}`,
      };
    }),
    departments,
  };
}

// Shows who can receive a request right now. Assignment uses the same rule.
export function EligibilityPage() {
  const { token, reportError } = useAdmin();
  const {
    data: options,
    loading,
    error: loadError,
    reload,
  } = useLoad(
    useCallback(() => loadOptions(token), [token]),
    { failure: 'Unable to load beds and departments.', onUnauthorized: reportError },
  );
  const [bedId, setBedId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [result, setResult] = useState<EligibleStaff[] | null>(null);
  const [checking, setChecking] = useState(false);
  const requestVersion = useRef(0);
  const pending = useRef(false);

  async function check() {
    if (pending.current || !bedId || !departmentId) return;
    pending.current = true;
    setChecking(true);
    setResult(null);
    const current = ++requestVersion.current;
    try {
      const staff = await staffApi.eligible(token, bedId, departmentId);
      if (current === requestVersion.current) setResult(staff);
    } catch (cause) {
      reportError(cause);
    } finally {
      pending.current = false;
      setChecking(false);
    }
  }

  if (!options) {
    return (
      <LoadState
        loading={loading}
        error={loadError}
        onRetry={reload}
        label="Loading beds and departments…"
      />
    );
  }

  return (
    <>
      <PageHeading
        title="Who can respond?"
        description="Check eligibility for one bed and department. Staff must be active, on duty, belong to that department, and cover the bed’s location. This check does not send a request."
      />
      <LoadState loading={false} error={loadError} onRetry={reload} />
      <section className="card">
        {(options.beds.length === 0 || options.departments.length === 0) && (
          <p className="muted">
            Add at least one bed and department before checking staff eligibility.
          </p>
        )}
        <div className="inline-form">
          <select
            value={bedId}
            disabled={checking}
            aria-label="Bed"
            onChange={(event) => {
              setBedId(event.target.value);
              requestVersion.current += 1;
              setResult(null);
            }}
          >
            <option value="">Choose a bed…</option>
            {options.beds.map((bed) => (
              <option key={bed.id} value={bed.id}>
                {bed.label}
              </option>
            ))}
          </select>
          <select
            value={departmentId}
            disabled={checking}
            aria-label="Department"
            onChange={(event) => {
              setDepartmentId(event.target.value);
              requestVersion.current += 1;
              setResult(null);
            }}
          >
            <option value="">Choose a department…</option>
            {options.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
                {department.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={checking || !bedId || !departmentId}
            onClick={() => void check()}
          >
            {checking ? 'Checking…' : 'Check eligibility'}
          </button>
        </div>

        {result && (
          <div className="result" role="status">
            {result.length === 0 ? (
              <p>
                <strong>Nobody</strong> is eligible right now. Check duty, departments, and coverage
                on the Staff page.
              </p>
            ) : (
              <>
                <p>
                  <strong>{result.length}</strong> staff member{result.length === 1 ? '' : 's'}{' '}
                  eligible for this bed and department:
                </p>
                <ul>
                  {result.map((member) => (
                    <li key={member.membershipId}>{member.displayName}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}
