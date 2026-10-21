import { useEffect, useId, useRef, type ReactNode, type SyntheticEvent } from 'react';

// Opens a native <dialog> as a modal while mounted. The browser handles focus
// trapping, Escape, and background inertness; closing restores focus to the
// control that opened the dialog.
export function useModalDialog() {
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
export function onEscape(close: () => void) {
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
