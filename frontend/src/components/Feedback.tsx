import { useEffect, useEffectEvent } from 'react';

// Notices: errors, successes, and the emergency reminder.

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
