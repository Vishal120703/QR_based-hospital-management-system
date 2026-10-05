import { useState, type FormEvent } from 'react';

export function EmergencyNotice() {
  return (
    <p className="emergency" role="note">
      <strong>Not for emergencies.</strong> In a medical emergency, press the nurse-call button or
      tell any staff member immediately.
    </p>
  );
}

export function ErrorNotice({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className="link" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export interface FieldSpec {
  name: string;
  label: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
  placeholder?: string;
  type?: 'text' | 'email' | 'password';
}

// A small create form. `fields` receives the current values so one select can
// depend on another (for example, rooms of the chosen ward).
export function CreateForm({
  submitLabel,
  fields,
  onCreate,
  onError,
}: {
  submitLabel: string;
  fields: (values: Record<string, string>) => FieldSpec[];
  onCreate: (values: Record<string, string>) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onCreate(values);
      setValues({});
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="create-form" onSubmit={(event) => void submit(event)}>
      {fields(values).map((field) => (
        <label key={field.name}>
          <span>
            {field.label}
            {field.optional && <em> (optional)</em>}
          </span>
          {field.options ? (
            <select
              value={values[field.name] ?? ''}
              required={!field.optional}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            >
              <option value="">{field.optional ? 'None' : 'Choose…'}</option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type ?? 'text'}
              value={values[field.name] ?? ''}
              required={!field.optional}
              placeholder={field.placeholder}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
            />
          )}
        </label>
      ))}
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
