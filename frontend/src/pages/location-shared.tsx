import { useState, type FormEvent, type ReactNode } from 'react';
import {
  staffApi,
  type Bed,
  type Building,
  type Floor,
  type LocationKind,
  type QrBatch,
  type QrBatchScope,
  type QrCode,
  type Room,
  type Ward,
} from '../api';
import { Modal } from '../components';
import { labelsFromBatch, QrLabelsDialog } from './QrLabelsDialog';
import { useAdmin } from './AdminLayout';

export interface Layout {
  buildings: Building[];
  floors: Floor[];
  wards: Ward[];
  rooms: Room[];
  beds: Bed[];
  qrCodes: QrCode[];
}

export type Selection = { kind: 'hospital' } | { kind: 'building' | 'floor' | 'ward'; id: string };

// Shared by every panel: run a change, report the result, and reload.
export interface PanelTools {
  layout: Layout;
  select: (next: Selection) => void;
  run: (action: () => Promise<unknown>, success: string, confirmText?: string) => Promise<boolean>;
  busy: boolean;
  canManage: boolean;
  canManageBeds: boolean;
  canReadBeds: boolean;
  // Hospital managers can issue and print bedside QR labels.
  canPrintQr: boolean;
}

export function bedStats(beds: Bed[]) {
  const active = beds.filter((bed) => bed.active);
  return {
    total: active.length,
    occupied: active.filter((bed) => bed.status === 'OCCUPIED').length,
    available: active.filter((bed) => bed.status === 'AVAILABLE').length,
    maintenance: active.filter((bed) => bed.status === 'MAINTENANCE').length,
  };
}

// Shared panel pieces

export interface EditField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select';
  options?: { value: string; label: string }[];
  optional?: boolean;
  help?: string;
}

export function EditDialog({
  title,
  fields,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  fields: EditField[];
  initial: Record<string, string>;
  onClose: () => void;
  onSave: (changes: Record<string, string>) => Promise<boolean>;
}) {
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const changes = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => value.trim() !== (initial[key] ?? '')),
    );
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    const saved = await onSave(changes);
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form className="create-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving}>
          {fields.map((field) => (
            <label key={field.name}>
              <span>
                {field.label}
                {field.optional && <em> (optional)</em>}
              </span>
              {field.type === 'select' ? (
                <select
                  value={values[field.name] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                >
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={values[field.name] ?? ''}
                  required={!field.optional}
                  maxLength={120}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                />
              )}
              {field.help && <small className="muted">{field.help}</small>}
            </label>
          ))}
          <div className="actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

// Edit, activate/deactivate, and delete controls for one location.
export function LocationActions({
  tools,
  kind,
  item,
  label,
  editFields,
  editInitial,
  toPatch,
  canEdit,
  canDelete,
  deleteHint,
  compact = false,
}: {
  tools: PanelTools;
  kind: LocationKind;
  item: { id: string; active: boolean };
  label: string;
  editFields: EditField[];
  editInitial: Record<string, string>;
  toPatch?: (changes: Record<string, string>) => object;
  canEdit: boolean;
  canDelete: boolean;
  deleteHint?: string;
  compact?: boolean;
}) {
  const { token } = useAdmin();
  const [editing, setEditing] = useState(false);
  if (!canEdit) return null;
  const size = compact ? 'secondary compact' : 'secondary';
  return (
    <div className="actions location-actions">
      <button
        type="button"
        className={size}
        disabled={tools.busy}
        aria-label={compact ? `Edit ${label}` : undefined}
        onClick={() => setEditing(true)}
      >
        Edit
      </button>
      <button
        type="button"
        className={size}
        disabled={tools.busy}
        aria-label={compact ? `${item.active ? 'Deactivate' : 'Activate'} ${label}` : undefined}
        onClick={() =>
          void tools.run(
            () => staffApi.updateLocation(token, kind, item.id, { active: !item.active }),
            `${label} ${item.active ? 'deactivated' : 'activated'}.`,
            item.active
              ? `Deactivate ${label}? It stays in history but cannot be used for new patients.`
              : undefined,
          )
        }
      >
        {item.active ? 'Deactivate' : 'Activate'}
      </button>
      {canDelete && (
        <button
          type="button"
          className={compact ? 'danger compact' : 'danger'}
          disabled={tools.busy}
          title={deleteHint}
          aria-label={compact ? `Delete ${label}` : undefined}
          onClick={() =>
            void tools.run(
              () => staffApi.deleteLocation(token, kind, item.id),
              `${label} deleted.`,
              `Delete ${label} permanently? This cannot be undone.`,
            )
          }
        >
          Delete
        </button>
      )}
      {editing && (
        <EditDialog
          title={`Edit ${label}`}
          fields={editFields}
          initial={editInitial}
          onClose={() => setEditing(false)}
          onSave={(changes) =>
            tools.run(
              () =>
                staffApi.updateLocation(token, kind, item.id, toPatch ? toPatch(changes) : changes),
              `${label} updated.`,
            )
          }
        />
      )}
    </div>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  code,
  active,
  children,
}: {
  eyebrow: string;
  title: string;
  code?: string;
  active?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="panel-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>
          {title} {code && <span className="code muted">{code}</span>}{' '}
          {active === false && <span className="badge">inactive</span>}
        </h2>
      </div>
      {children && <div className="panel-header-actions">{children}</div>}
    </header>
  );
}

export function hasActiveQr(layout: Layout, bedId: string): boolean {
  return layout.qrCodes.some((qr) => qr.bedId === bedId && qr.status === 'ACTIVE');
}

// Issues QR codes for the beds in one place that do not have one yet, then
// opens the labels for download.
export function QrLabelsButton({
  tools,
  scope,
  beds,
  area,
  compact = false,
  primary = false,
}: {
  tools: PanelTools;
  scope: QrBatchScope;
  beds: Bed[];
  area: string;
  compact?: boolean;
  primary?: boolean;
}) {
  const { token } = useAdmin();
  const [batch, setBatch] = useState<QrBatch | null>(null);
  if (!tools.canPrintQr) return null;
  const need = beds.filter((bed) => bed.active && !hasActiveQr(tools.layout, bed.id)).length;
  const classes = [primary ? '' : 'secondary', compact ? 'compact' : ''].filter(Boolean).join(' ');

  async function generate() {
    const box: { value?: QrBatch } = {};
    await tools.run(
      async () => {
        box.value = await staffApi.generateQrBatch(token, scope);
      },
      `${need} QR label${need === 1 ? '' : 's'} created. Download them now.`,
    );
    if (box.value && box.value.issues.length > 0) setBatch(box.value);
  }

  return (
    <>
      <button
        type="button"
        className={classes || undefined}
        disabled={tools.busy || need === 0}
        title={
          need === 0
            ? 'Every active bed here already has a QR label. To reprint, use Beds & QR → Print QR labels → reprint existing.'
            : undefined
        }
        aria-label={compact ? `Print QR labels for ${area}` : undefined}
        onClick={() => void generate()}
      >
        {need === 0 ? 'QR labels done' : `Print QR labels (${need})`}
      </button>
      {batch && (
        <QrLabelsDialog items={labelsFromBatch(batch)} area={area} onClose={() => setBatch(null)} />
      )}
    </>
  );
}
