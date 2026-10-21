import { QrCode } from 'lucide-react';

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
