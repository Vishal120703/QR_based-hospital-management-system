import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  staffApi,
  type Bed,
  type Department,
  type EligibleStaff,
  type Floor,
  type Ward,
} from '../api';
import { LoadState, PageHeading } from '../components';
import { useAdmin } from './AdminLayout';

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
        label: `${bed.displayName} — ${[ward?.name, floor?.name].filter(Boolean).join(', ')}`,
      };
    }),
    departments,
  };
}

// Shows who would receive a request right now. Routing (a later phase) uses
// exactly this rule.
export function EligibilityPage() {
  const { token, reportError } = useAdmin();
  const [options, setOptions] = useState<Options | null>(null);
  const [bedId, setBedId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [result, setResult] = useState<EligibleStaff[] | null>(null);
  const [version, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const requestVersion = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadOptions(token).then(
      (loaded) => {
        if (!cancelled) {
          setOptions(loaded);
          setLoading(false);
          setLoadError(null);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setLoadError(
            cause instanceof Error ? cause.message : 'Unable to load beds and departments.',
          );
          if (cause instanceof ApiError && cause.status === 401) reportError(cause);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, reportError]);

  const reload = () => {
    setLoading(true);
    setLoadError(null);
    setVersion((value) => value + 1);
  };

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
