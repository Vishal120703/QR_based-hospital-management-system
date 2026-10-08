import { CircleHelp, QrCode, TriangleAlert } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type SyntheticEvent,
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

// Opens a native <dialog> as a modal while mounted. The browser handles focus
// trapping, Escape, and background inertness; closing restores focus to the
// control that opened the dialog.
function useModalDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
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
  return dialog;
}

// Escape closes a dialog. Closing a file picker without choosing a file also
// fires "cancel", which bubbles up from the file input; only Escape on the
// dialog itself should close it, or a half-filled form would be lost.
function onEscape(close: () => void) {
  return (event: SyntheticEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    close();
  };
}

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
  const dialog = useModalDialog();
  const titleId = useId();
  return (
    <dialog
      ref={dialog}
      className={`card dialog${wide ? ' dialog-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={onEscape(onClose)}
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

// A question before an action, shown in the app's own dialog instead of the
// browser's confirm box. Write it as "<Action> <what>? <What happens.>": the
// question becomes the title, the rest the explanation, and the first word the
// button ("Deactivate"). Pass an object to choose the title or button yourself.
export type ConfirmQuestion =
  string | { title: string; message?: string; confirmLabel?: string; danger?: boolean };

interface ConfirmRequest {
  title: string;
  message: string | null;
  confirmLabel: string;
  danger: boolean;
}

// Actions that end, remove, or replace something get a red button.
const dangerousActions = new Set([
  'Close',
  'Deactivate',
  'Delete',
  'Remove',
  'Replace',
  'Revoke',
  'Suspend',
]);

function toConfirmRequest(question: ConfirmQuestion): ConfirmRequest {
  const asked =
    typeof question === 'string'
      ? {
          title: question.includes('?') ? question.slice(0, question.indexOf('?') + 1) : question,
          message: question.includes('?') ? question.slice(question.indexOf('?') + 1).trim() : '',
        }
      : question;
  const action = asked.title.split(' ')[0] ?? 'OK';
  return {
    title: asked.title,
    message: asked.message || null,
    confirmLabel: asked.confirmLabel ?? action,
    danger: asked.danger ?? dangerousActions.has(action),
  };
}

type Confirm = (question: ConfirmQuestion) => Promise<boolean>;

// Outside ConfirmProvider (for example in a component test) the browser's own
// confirm box answers instead.
const ConfirmContext = createContext<Confirm>((question) =>
  Promise.resolve(
    window.confirm(
      typeof question === 'string'
        ? question
        : [question.title, question.message].filter(Boolean).join(' '),
    ),
  ),
);

// Resolves true when the person confirms, false on Cancel or Escape.
export function useConfirm(): Confirm {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const answer = useRef<((confirmed: boolean) => void) | null>(null);
  const confirm = useCallback<Confirm>(
    (question) =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false);
        answer.current = resolve;
        setRequest(toConfirmRequest(question));
      }),
    [],
  );
  const respond = useCallback((confirmed: boolean) => {
    answer.current?.(confirmed);
    answer.current = null;
    setRequest(null);
  }, []);
  return (
    <ConfirmContext value={confirm}>
      {children}
      {request && <ConfirmDialog request={request} onAnswer={respond} />}
    </ConfirmContext>
  );
}

function ConfirmDialog({
  request,
  onAnswer,
}: {
  request: ConfirmRequest;
  onAnswer: (confirmed: boolean) => void;
}) {
  const dialog = useModalDialog();
  const titleId = useId();
  const messageId = useId();
  const Icon = request.danger ? TriangleAlert : CircleHelp;
  // Cancel comes first, so it has focus when the dialog opens and Enter never
  // confirms a destructive action by accident.
  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      className="card dialog confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={request.message ? messageId : undefined}
      onCancel={onEscape(() => onAnswer(false))}
    >
      <span className={`confirm-icon${request.danger ? ' danger' : ''}`} aria-hidden="true">
        <Icon size={20} strokeWidth={2.2} />
      </span>
      <div className="confirm-text">
        <h2 id={titleId}>{request.title}</h2>
        {request.message && (
          <p id={messageId} className="muted">
            {request.message}
          </p>
        )}
      </div>
      <div className="confirm-actions">
        <button type="button" className="secondary" onClick={() => onAnswer(false)}>
          Cancel
        </button>
        <button
          type="button"
          className={request.danger ? 'danger-solid' : undefined}
          onClick={() => onAnswer(true)}
        >
          {request.confirmLabel}
        </button>
      </div>
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
