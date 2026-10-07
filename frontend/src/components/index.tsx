import { QrCode } from 'lucide-react';
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { textInputRules } from '../lib/field-rules';

export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function LoadState({
  loading,
  error,
  onRetry,
  label = 'Loading…',
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  label?: string;
}) {
  if (error) {
    return (
      <section className="card load-state">
        <ErrorNotice message={error} />
        <button type="button" className="secondary" onClick={onRetry}>
          Try again
        </button>
      </section>
    );
  }
  return loading ? (
    <p className="muted" role="status">
      {label}
    </p>
  ) : null;
}

// Shown while a screen's code downloads (screens load on demand).
export function RouteLoading() {
  return (
    <p className="route-loading muted" role="status">
      Loading…
    </p>
  );
}

// The browser handles focus trapping, Escape, background inertness, and
// restoring focus to the control that opened the dialog.
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      // Some actions replace their initiating button (Generate QR becomes
      // Replace QR). In that case restore focus to the workspace, not <body>.
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      } else {
        document.getElementById('main-content')?.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`card dialog${wide ? ' dialog-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-header no-print">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="secondary" aria-label="Close dialog" onClick={onClose}>
          Close
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function EmergencyNotice({ language = 'en' }: { language?: 'en' | 'hi' }) {
  return (
    <p className="emergency" role="note">
      {language === 'hi' ? (
        <>
          <strong>आपातकाल के लिए नहीं।</strong> चिकित्सा आपातकाल में नर्स-कॉल बटन दबाएँ या तुरंत
          किसी कर्मचारी को बताएँ।
        </>
      ) : (
        <>
          <strong>Not for emergencies.</strong> In a medical emergency, press the nurse-call button
          or tell any staff member immediately.
        </>
      )}
    </p>
  );
}

export function ErrorNotice({
  message,
  onDismiss,
  dismissLabel = 'Dismiss',
}: {
  message: string;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    <div className="notice notice-error" role="alert">
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className="link" onClick={onDismiss}>
          {dismissLabel}
        </button>
      )}
    </div>
  );
}

// The messages an action leaves behind, kept in view while scrolling so they
// are never missed. Success messages fade on their own after a few seconds;
// errors stay until dismissed.
export function NoticeStack({
  error,
  success,
  onDismissError,
  onDismissSuccess,
}: {
  error: string | null;
  success: string | null;
  onDismissError: () => void;
  onDismissSuccess: () => void;
}) {
  const fade = useEffectEvent(onDismissSuccess);
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => fade(), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  if (!error && !success) return null;
  return (
    <div className="notice-stack">
      {error && <ErrorNotice message={error} onDismiss={onDismissError} />}
      {success && (
        <div className="notice notice-success" role="status">
          <span>{success}</span>
          <button type="button" className="link" onClick={onDismissSuccess}>
            Dismiss
          </button>
        </div>
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

// The company behind CARE QR, shown quietly at the foot of every main screen.
// To show a logo instead of plain text, change only this component.
const companyName = 'Healio Healthtech';

export function PoweredBy({
  language = 'en',
  className,
}: {
  language?: 'en' | 'hi';
  className?: string;
}) {
  return (
    <p className={className ? `powered-by ${className}` : 'powered-by'} lang="en">
      {language === 'hi' ? (
        <>
          <strong>{companyName}</strong> <span lang="hi">द्वारा संचालित</span>
        </>
      ) : (
        <>
          Powered by <strong>{companyName}</strong>
        </>
      )}
    </p>
  );
}

// The CARE QR mark: one look for every sign-in page, top bar, and fallback logo.
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <QrCode size={18} strokeWidth={2.4} />
    </span>
  );
}
