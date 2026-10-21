import { useRef, useState, type FormEvent } from 'react';
import { textInputRules } from '../lib/field-rules';

export interface FieldSpec {
  name: string;
  label: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
  placeholder?: string;
  type?: 'text' | 'email' | 'password' | 'number';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
}

export function normalizeFormValues(
  values: Record<string, string>,
  fields: (values: Record<string, string>) => FieldSpec[],
): Record<string, string> {
  const next = { ...values };
  // Re-evaluate after clearing a parent selection, so its descendants are
  // cleared too. Text fields (including passwords) are left untouched.
  const count = fields(next).length;
  for (let pass = 0; pass < count; pass += 1) {
    let changed = false;
    for (const field of fields(next)) {
      if (
        field.options &&
        next[field.name] &&
        !field.options.some((item) => item.value === next[field.name])
      ) {
        next[field.name] = '';
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
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
  const pending = useRef(false);
  const [saved, setSaved] = useState(false);

  function change(name: string, value: string) {
    setSaved(false);
    setValues((current) => normalizeFormValues({ ...current, [name]: value }, fields));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setSaved(false);
    try {
      const input = normalizeFormValues(values, fields);
      for (const field of fields(input)) {
        if (field.type !== 'password' && input[field.name])
          input[field.name] = input[field.name]?.trim() ?? '';
        if (!field.optional && !input[field.name])
          throw new Error(`Please enter ${field.label.toLowerCase()}.`);
      }
      await onCreate(input);
      setValues({});
      setSaved(true);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }

  return (
    <form className="create-form" aria-busy={busy} onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
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
                onChange={(event) => change(field.name, event.target.value)}
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
                {...textInputRules(field.name, field.type)}
                {...(field.minLength !== undefined ? { minLength: field.minLength } : {})}
                {...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {})}
                min={field.min}
                max={field.max}
                step={field.step}
                autoComplete={field.type === 'password' ? 'new-password' : undefined}
                onChange={(event) => change(field.name, event.target.value)}
              />
            )}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
      {saved && (
        <p className="success-text small" role="status">
          Saved successfully.
        </p>
      )}
    </form>
  );
}
