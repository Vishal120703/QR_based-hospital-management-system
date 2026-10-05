import { useEffect, useState } from 'react';
import {
  staffApi,
  type Bed,
  type Department,
  type EligibleStaff,
  type Floor,
  type Ward,
} from '../api';
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

  useEffect(() => {
    let cancelled = false;
    loadOptions(token).then(
      (loaded) => {
        if (!cancelled) setOptions(loaded);
      },
      (cause: unknown) => {
        if (!cancelled) reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, reportError]);

  async function check() {
    try {
      setResult(await staffApi.eligible(token, bedId, departmentId));
    } catch (cause) {
      reportError(cause);
    }
  }

  if (!options) {
    return <p className="muted">Loading…</p>;
  }

  return (
    <>
      <h1>Who can respond?</h1>
      <p className="muted">
        Staff are eligible when they are active, on duty, in the department, and their coverage
        includes the bed’s ward, its floor, or the whole hospital.
      </p>
      <section className="card">
        <div className="inline-form">
          <select
            value={bedId}
            aria-label="Bed"
            onChange={(event) => {
              setBedId(event.target.value);
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
            aria-label="Department"
            onChange={(event) => {
              setDepartmentId(event.target.value);
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
          <button type="button" disabled={!bedId || !departmentId} onClick={() => void check()}>
            Check
          </button>
        </div>

        {result && (
          <div className="result">
            {result.length === 0 ? (
              <p>
                <strong>Nobody</strong> is eligible right now. Check duty, departments, and coverage
                on the Staff page.
              </p>
            ) : (
              <>
                <p>
                  <strong>{result.length}</strong> staff member{result.length === 1 ? '' : 's'}{' '}
                  would receive this request:
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
