import { useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { staffApi, type Role, type RoleScopeLevel } from '../../api';
import { LoadState, Modal, PageHeading, useConfirm } from '../../components';
import { levelLabels, permissionGroups, permissionLabel } from '../../lib/permission-labels';
import { useLoad } from '../../lib/use-load';
import { useAdmin } from '../workspace/AdminLayout';

const levels = Object.keys(levelLabels) as RoleScopeLevel[];

export function RolesPage() {
  const { token, can, reportError, reportSuccess } = useAdmin();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('role.manage');
  const {
    data: roles,
    error,
    reload,
    refresh,
  } = useLoad(
    useCallback(() => staffApi.roles(token), [token]),
    { failure: 'Could not load roles.', onUnauthorized: reportError },
  );

  async function remove(role: Role) {
    if (!(await confirm(`Delete the role “${role.name}”?`))) return;
    setBusy(true);
    try {
      await staffApi.deleteRole(token, role.id);
      reportSuccess(`${role.name} deleted.`);
      await refresh();
    } catch (cause) {
      reportError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Roles & access"
        description="A role is a set of things a person may do. Give someone a role for the whole hospital, or for one floor, ward, or department."
      >
        {canManage && (
          <button type="button" onClick={() => setEditing('new')}>
            Create role
          </button>
        )}
      </PageHeading>

      <ol className="hierarchy" aria-label="Who manages whom">
        <li>
          <strong>Hospital Manager</strong>
          <span>Runs the whole hospital: setup, staff, roles, QR labels.</span>
        </li>
        <li>
          <strong>Floor Manager · Ward Manager · Department Supervisor</strong>
          <span>Admit patients and assign requests in their own floor, ward, or department.</span>
        </li>
        <li>
          <strong>Care Staff</strong>
          <span>Accept, start, and complete the work assigned to them.</span>
        </li>
      </ol>

      {!roles ? (
        <LoadState loading={!error} error={error} label="Loading roles…" onRetry={reload} />
      ) : (
        <div className="role-grid">
          {roles.map((role) => {
            const keys = role.permissionKeys ?? [];
            return (
              <article key={role.id} className={`card role-card${role.active ? '' : ' inactive'}`}>
                <header>
                  <h2>{role.name}</h2>
                  <div className="request-badges">
                    {role.builtIn && <span className="badge badge-occupied">built-in</span>}
                    <span className="badge">{levelLabels[role.scopeLevel ?? 'HOSPITAL'].name}</span>
                    {!role.active && <span className="badge">inactive</span>}
                  </div>
                </header>
                {role.description && <p className="muted small">{role.description}</p>}
                <p className="small">
                  <strong>{role.memberCount ?? 0}</strong>{' '}
                  {(role.memberCount ?? 0) === 1 ? 'person' : 'people'} ·{' '}
                  {role.locked ? 'every permission' : `${keys.length} permissions`}
                </p>
                {!role.locked && keys.length > 0 && (
                  <ul className="chips compact-chips">
                    {keys.slice(0, 5).map((key) => (
                      <li key={key} className="chip">
                        {permissionLabel(key)}
                      </li>
                    ))}
                    {keys.length > 5 && <li className="chip">+{keys.length - 5} more</li>}
                  </ul>
                )}
                {canManage && !role.locked && (
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => setEditing(role)}
                    >
                      Edit
                    </button>
                    {!role.builtIn && (role.memberCount ?? 0) === 0 && (
                      <button
                        type="button"
                        className="danger compact"
                        disabled={busy}
                        onClick={() => void remove(role)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
                {role.locked && (
                  <p className="muted small">
                    Always has every permission, so nobody is locked out.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <p className="muted small">
        To give someone a role, open <Link to="/admin/staff">Staff &amp; coverage</Link>, choose{' '}
        <strong>Manage</strong>, and pick the role and the place it applies to. New departments are
        added under <Link to="/admin/departments">Departments</Link>.
      </p>

      {editing && roles && (
        <RoleEditor
          role={editing === 'new' ? null : editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            reportSuccess(message);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function RoleEditor({
  role,
  roles,
  onClose,
  onSaved,
}: {
  role: Role | null;
  roles: Role[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const { token, can, reportError } = useAdmin();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [level, setLevel] = useState<RoleScopeLevel>(role?.scopeLevel ?? 'HOSPITAL');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissionKeys ?? []));
  const [saving, setSaving] = useState(false);
  const builtIn = Boolean(role?.builtIn);
  const assigned = (role?.memberCount ?? 0) > 0;

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function copyFrom(roleId: string) {
    const source = roles.find((item) => item.id === roleId);
    if (!source) return;
    setSelected(new Set((source.permissionKeys ?? []).filter((key) => can(key))));
    if (!role && source.scopeLevel) setLevel(source.scopeLevel);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const permissionKeys = [...selected];
      if (role) {
        await staffApi.updateRole(token, role.id, {
          ...(builtIn ? {} : { name: name.trim(), scopeLevel: level }),
          description: description.trim() || null,
          permissionKeys,
        });
        await onSaved(`${role.name} updated.`);
      } else {
        await staffApi.createRole(token, {
          name: name.trim(),
          description: description.trim() || null,
          scopeLevel: level,
          permissionKeys,
        });
        await onSaved(`${name.trim()} created. Give it to people from Staff & coverage.`);
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={role ? `Edit ${role.name}` : 'Create a role'} onClose={onClose} wide>
      <form className="create-form role-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving}>
          <div className="field-grid">
            <label>
              Role name
              <input
                value={name}
                required
                minLength={2}
                maxLength={100}
                disabled={builtIn}
                placeholder="Night Supervisor"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Applies to
              <select
                value={level}
                disabled={builtIn || assigned}
                onChange={(event) => setLevel(event.target.value as RoleScopeLevel)}
              >
                {levels.map((item) => (
                  <option key={item} value={item}>
                    {levelLabels[item].name}
                  </option>
                ))}
              </select>
              <small className="muted">
                {assigned && !builtIn
                  ? 'Remove it from everyone to change this.'
                  : levelLabels[level].help}
              </small>
            </label>
            {!role && (
              <label>
                <span>
                  Start from <em>(optional)</em>
                </span>
                <select defaultValue="" onChange={(event) => copyFrom(event.target.value)}>
                  <option value="">Empty</option>
                  {roles
                    .filter((item) => !item.locked)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          <label>
            <span>
              Description <em>(optional)</em>
            </span>
            <input
              value={description}
              maxLength={500}
              placeholder="What this person does"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <div className="permission-groups">
            {permissionGroups.map((group) => (
              <fieldset key={group.title} className="permission-group">
                <legend>{group.title}</legend>
                {group.permissions.map((permission) => (
                  <label key={permission.key} className="checkbox">
                    <input
                      type="checkbox"
                      checked={selected.has(permission.key)}
                      // Nobody can hand out a permission they do not hold themselves.
                      disabled={!can(permission.key)}
                      onChange={() => toggle(permission.key)}
                    />
                    {permission.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">
              {saving ? 'Saving…' : role ? 'Save changes' : `Create role (${selected.size})`}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
