import {
  CircleCheck,
  Clock,
  MapPin,
  RefreshCw,
  TriangleAlert,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  staffApi,
  type Bed,
  type Department,
  type EligibleStaff,
  type Floor,
  type StaffMember,
  type Ward,
} from '../../api';
import { LoadState, PageHeading } from '../../components';
import { useLoad } from '../../lib/use-load';
import { useAdmin } from '../workspace/AdminLayout';
import {
  blockersFor,
  blockerText,
  coverageFor,
  coverageText,
  groupBeds,
  initials,
  type BedGroup,
  type BedPlace,
  type Blocker,
} from './eligibility';

interface Options {
  groups: BedGroup[];
  beds: Map<string, BedPlace>;
  departments: Department[];
}

interface Result {
  bedId: string;
  departmentId: string;
  eligible: EligibleStaff[];
  // Everyone the manager can see; null if the list could not be loaded, in
  // which case only the eligible people are shown.
  staff: StaffMember[] | null;
}

async function loadOptions(token: string): Promise<Options> {
  const [beds, wards, floors, departments] = await Promise.all([
    staffApi.list<Bed>(token, 'beds'),
    staffApi.list<Ward>(token, 'wards'),
    staffApi.list<Floor>(token, 'floors'),
    staffApi.list<Department>(token, 'departments'),
  ]);
  const groups = groupBeds(beds, wards, floors);
  return {
    groups,
    beds: new Map(groups.flatMap((group) => group.beds.map((bed) => [bed.id, bed]))),
    departments: [...departments].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const rules = [
  { icon: UserRoundCheck, title: 'Account active', detail: 'Not suspended' },
  { icon: Clock, title: 'On duty', detail: 'Marked on duty right now' },
  { icon: UsersRound, title: 'In the department', detail: 'For example Nursing' },
  { icon: MapPin, title: 'Covers the bed', detail: 'The whole hospital, its floor, or its ward' },
];

const blockerTone: Record<Blocker, string> = {
  SUSPENDED: 'badge-danger',
  INACTIVE: 'badge-danger',
  OFF_DUTY: 'badge-maintenance',
  NOT_COVERING: '',
};

// Shows who would receive a request for one bed and department right now, and
// why everyone else in that department would not. Assignment uses the same rule.
export function EligibilityPage() {
  const { token, can, reportError, reportSuccess } = useAdmin();
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
  const [result, setResult] = useState<Result | null>(null);
  const [checking, setChecking] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const dutyPending = useRef(false);
  const bedField = useId();
  const departmentField = useId();

  // Every new choice replaces the previous answer; a slower, older answer is ignored.
  async function check(nextBedId: string, nextDepartmentId: string) {
    const current = ++requestVersion.current;
    setResult(null);
    if (!nextBedId || !nextDepartmentId) {
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const [eligible, staff] = await Promise.all([
        staffApi.eligible(token, nextBedId, nextDepartmentId),
        staffApi.list<StaffMember>(token, 'staff').catch(() => null),
      ]);
      if (current === requestVersion.current) {
        setResult({ bedId: nextBedId, departmentId: nextDepartmentId, eligible, staff });
      }
    } catch (cause) {
      if (current === requestVersion.current) reportError(cause);
    } finally {
      if (current === requestVersion.current) setChecking(false);
    }
  }

  async function putOnDuty(member: StaffMember) {
    if (dutyPending.current) return;
    dutyPending.current = true;
    setBusyMemberId(member.id);
    try {
      await staffApi.setDuty(token, member.id, 'ON_DUTY');
      reportSuccess(`${member.displayName} is now on duty.`);
      await check(bedId, departmentId);
    } catch (cause) {
      reportError(cause);
    } finally {
      dutyPending.current = false;
      setBusyMemberId(null);
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

  const missingSetup = options.groups.length === 0 || options.departments.length === 0;

  return (
    <>
      <PageHeading
        title="Who can respond?"
        description="Choose a bed and the kind of help a patient needs. You’ll see who would get that request right now, and what is stopping everyone else. Nothing is sent to anyone."
      />
      <LoadState loading={false} error={loadError} onRetry={reload} />

      <section className="card eligibility-rules" aria-labelledby="eligibility-rules-title">
        <h2 id="eligibility-rules-title">Staff can respond when all four are true</h2>
        <ol>
          {rules.map(({ icon: Icon, title, detail }) => (
            <li key={title}>
              <Icon aria-hidden="true" size={20} />
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card eligibility-picker" aria-label="Choose a bed and department">
        {missingSetup && (
          <p className="notice notice-warning">
            Add at least one bed (Location setup) and one department (Departments) first.
          </p>
        )}
        <div className="eligibility-fields">
          <div className="eligibility-field">
            <label htmlFor={bedField}>
              <span className="step-number" aria-hidden="true">
                1
              </span>
              Bed
            </label>
            <select
              id={bedField}
              value={bedId}
              aria-describedby={`${bedField}-hint`}
              onChange={(event) => {
                setBedId(event.target.value);
                void check(event.target.value, departmentId);
              }}
            >
              <option value="">Choose a bed…</option>
              {options.groups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.beds.map((bed) => (
                    <option key={bed.id} value={bed.id}>
                      {bed.name}
                      {bed.active ? '' : ' (out of service)'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <small id={`${bedField}-hint`} className="muted">
              Where the patient is. Beds are grouped by floor and ward.
            </small>
          </div>
          <div className="eligibility-field">
            <label htmlFor={departmentField}>
              <span className="step-number" aria-hidden="true">
                2
              </span>
              Department
            </label>
            <select
              id={departmentField}
              value={departmentId}
              aria-describedby={`${departmentField}-hint`}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                void check(bedId, event.target.value);
              }}
            >
              <option value="">Choose a department…</option>
              {options.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                  {department.active ? '' : ' (turned off)'}
                </option>
              ))}
            </select>
            <small id={`${departmentField}-hint`} className="muted">
              The team that handles the request, for example Nursing or Housekeeping.
            </small>
          </div>
        </div>
        {(!bedId || !departmentId) && !missingSetup && (
          <p className="eligibility-prompt muted">
            {bedId || departmentId
              ? `Now choose ${bedId ? 'a department' : 'a bed'} to see who can respond.`
              : 'Choose a bed and a department. The answer appears right away.'}
          </p>
        )}
      </section>

      {bedId && departmentId && (
        <section className="card eligibility-results" aria-live="polite" aria-busy={checking}>
          {!result ? (
            <p className="muted" role="status">
              Checking who can respond…
            </p>
          ) : (
            <Answer
              result={result}
              bed={options.beds.get(result.bedId)}
              department={options.departments.find((item) => item.id === result.departmentId)}
              checking={checking}
              canManageDuty={can('staff.manage')}
              busyMemberId={busyMemberId}
              onRecheck={() => void check(bedId, departmentId)}
              onPutOnDuty={(member) => void putOnDuty(member)}
            />
          )}
        </section>
      )}
    </>
  );
}

function Answer({
  result,
  bed,
  department,
  checking,
  canManageDuty,
  busyMemberId,
  onRecheck,
  onPutOnDuty,
}: {
  result: Result;
  bed: BedPlace | undefined;
  department: Department | undefined;
  checking: boolean;
  canManageDuty: boolean;
  busyMemberId: string | null;
  onRecheck: () => void;
  onPutOnDuty: (member: StaffMember) => void;
}) {
  if (!bed || !department) return null;
  const eligibleIds = new Set(result.eligible.map((person) => person.membershipId));
  const others =
    result.staff
      ?.filter((member) => member.departmentIds.includes(department.id))
      .filter((member) => !eligibleIds.has(member.id))
      .map((member) => ({ member, blockers: blockersFor(member, bed) }))
      .sort(
        (a, b) =>
          a.blockers.length - b.blockers.length ||
          a.member.displayName.localeCompare(b.member.displayName),
      ) ?? [];
  const count = result.eligible.length;
  const where = `${bed.name} (${bed.wardName}, ${bed.floorName})`;

  let headline: string;
  let detail: string;
  if (count > 0) {
    headline = `${count} ${count === 1 ? 'person' : 'people'} can respond`;
    detail = `to ${department.name} requests at ${where}.`;
  } else if (!department.active) {
    headline = `Nobody: ${department.name} is turned off`;
    detail = `Patients cannot ask for ${department.name} services until it is turned back on in Departments.`;
  } else if (result.staff && others.length === 0) {
    headline = `Nobody is in ${department.name} yet`;
    detail = 'Add people to this department on the Staff page.';
  } else {
    headline = 'Nobody can respond right now';
    detail = `A ${department.name} request at ${where} could not be assigned until someone below is available.`;
  }

  return (
    <>
      <div className="eligibility-answer">
        <div className={`eligibility-summary ${count > 0 ? 'is-ok' : 'is-none'}`} role="status">
          {count > 0 ? (
            <CircleCheck aria-hidden="true" size={28} />
          ) : (
            <TriangleAlert aria-hidden="true" size={28} />
          )}
          <div>
            <strong>{headline}</strong>
            <p>{detail}</p>
          </div>
        </div>
        <button type="button" className="secondary compact" disabled={checking} onClick={onRecheck}>
          <RefreshCw aria-hidden="true" size={14} /> {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {count > 0 && (
        <>
          <h2 className="eligibility-list-title">
            Can respond <span className="badge badge-available">{count}</span>
          </h2>
          <ul className="person-list" aria-label="Can respond">
            {result.eligible.map((person) => {
              const member = result.staff?.find((item) => item.id === person.membershipId);
              const scope = member && coverageFor(member, bed);
              return (
                <li key={person.membershipId} className="person-row">
                  <span className="person-avatar is-ok" aria-hidden="true">
                    {initials(person.displayName)}
                  </span>
                  <span className="person-info">
                    <strong>{person.displayName}</strong>
                    <span className="muted small">
                      On duty{scope ? ` · ${coverageText(scope, bed)}` : ''}
                    </span>
                  </span>
                  <span className="badge badge-available">Can respond</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {others.length > 0 && (
        <>
          <h2 className="eligibility-list-title">
            Can’t respond right now <span className="badge">{others.length}</span>
          </h2>
          <ul className="person-list" aria-label="Can’t respond right now">
            {others.map(({ member, blockers }) => (
              <li key={member.id} className="person-row">
                <span className="person-avatar" aria-hidden="true">
                  {initials(member.displayName)}
                </span>
                <span className="person-info">
                  <strong>{member.displayName}</strong>
                  <span className="person-reasons">
                    {blockers.length > 0 ? (
                      blockers.map((blocker) => (
                        <span key={blocker} className={`badge ${blockerTone[blocker]}`}>
                          {blockerText(blocker, bed)}
                        </span>
                      ))
                    ) : (
                      <span className="badge">Not available right now</span>
                    )}
                  </span>
                </span>
                <span className="person-actions">
                  {canManageDuty && blockers.length === 1 && blockers[0] === 'OFF_DUTY' && (
                    <button
                      type="button"
                      className="compact"
                      disabled={busyMemberId !== null || checking}
                      onClick={() => onPutOnDuty(member)}
                    >
                      {busyMemberId === member.id ? (
                        'Saving…'
                      ) : (
                        <>
                          Put <span className="visually-hidden">{member.displayName} </span>on duty
                        </>
                      )}
                    </button>
                  )}
                  <Link
                    className="button secondary compact"
                    to={`/admin/staff?search=${encodeURIComponent(member.displayName)}`}
                  >
                    Open <span className="visually-hidden">{member.displayName} </span>in Staff
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {result.staff && count + others.length > 0 && (
        <p className="muted small eligibility-footnote">
          Only people in {department.name} are listed. Everyone else never receives{' '}
          {department.name} requests.
        </p>
      )}
    </>
  );
}
