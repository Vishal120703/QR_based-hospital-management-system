import { CircleHelp, TriangleAlert } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { onEscape, useModalDialog } from './Modal';

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
