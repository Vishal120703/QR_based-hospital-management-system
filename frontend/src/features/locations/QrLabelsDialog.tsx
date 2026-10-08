import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState, type ReactNode } from 'react';
import { assetUrl, type QrBatch, type QrIssue } from '../../api';
import { Modal, useConfirm } from '../../components';
import {
  downloadLabelsPdf,
  labelSizes,
  labelsFileName,
  openLabelsPdf,
  type Label,
  type LabelSize,
} from '../../lib/qr-pdf';
import { logoForPdf } from '../../lib/logo-image';
import { useAdmin } from '../workspace/AdminLayout';

export interface LabelItem extends Label {
  id: string;
}

export function labelsFromBatch(batch: QrBatch): LabelItem[] {
  return batch.issues.map((issue) => labelFromIssue(issue, issue));
}

export function labelFromIssue(
  issue: QrIssue,
  bed: { bedName: string; bedCode: string; location: string },
): LabelItem {
  return {
    id: issue.qrCode.id,
    url: issue.url,
    version: issue.qrCode.version,
    bedName: bed.bedName,
    bedCode: bed.bedCode,
    location: bed.location,
  };
}

const previewLimit = 6;

// Shows newly issued QR codes once, and turns them into a printable PDF.
export function QrLabelsDialog({
  items,
  area,
  onClose,
  children,
}: {
  items: LabelItem[];
  area: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { me } = useAdmin();
  const confirm = useConfirm();
  const [size, setSize] = useState<LabelSize>(items.length === 1 ? 'large' : 'medium');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [logo, setLogo] = useState<Awaited<ReturnType<typeof logoForPdf>>>(null);
  const logoUrl = me.tenant.logoUrl ? assetUrl(me.tenant.logoUrl) : null;
  // Loaded up front, so opening the PDF tab still counts as the user's click.
  useEffect(() => {
    if (!logoUrl) return;
    let current = true;
    void logoForPdf(logoUrl).then((loaded) => {
      if (current) setLogo(loaded);
    });
    return () => {
      current = false;
    };
  }, [logoUrl]);
  const options = { size, hospitalName: me.tenant.name, logo };
  const pages = Math.ceil(items.length / (labelSizes[size].cols * labelSizes[size].rows));

  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      await downloadLabelsPdf(items, { ...options, fileName: labelsFileName(area) });
      setSaved(true);
      setMessage('PDF downloaded. Print it at 100% scale (“Actual size”) on A4 paper.');
    } catch {
      setMessage('Could not create the PDF. Try again, or use a different browser.');
    } finally {
      setBusy(false);
    }
  }

  async function openToPrint() {
    setBusy(true);
    setMessage(null);
    try {
      if (await openLabelsPdf(items, options)) {
        setSaved(true);
        setMessage('The PDF opened in a new tab. Print it from there at 100% scale.');
      } else {
        setMessage('Your browser blocked the new tab. Use Download PDF instead.');
      }
    } catch {
      setMessage('Could not create the PDF. Try Download PDF instead.');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (
      !saved &&
      !(await confirm({
        title: 'Close without saving these labels?',
        message:
          'You have not downloaded or printed them. Their QR codes cannot be shown again; you would have to replace them.',
        confirmLabel: 'Close anyway',
        danger: true,
      }))
    ) {
      return;
    }
    onClose();
  }

  return (
    <Modal
      title={
        items.length === 1 ? `QR label for ${items[0]!.bedName}` : `${items.length} QR labels ready`
      }
      onClose={() => void close()}
      wide
    >
      <p className="notice notice-warning">
        These QR codes are shown only once. Download or print them now. Keep the PDF private and
        delete it after printing: anyone with it could print a working label.
      </p>
      <p className="muted small">
        {area} · sorted by location, so you can stick them on bed by bed.
      </p>

      <fieldset className="size-picker">
        <legend>Label size</legend>
        {(Object.keys(labelSizes) as LabelSize[]).map((option) => (
          <label key={option} className={size === option ? 'active' : ''}>
            <input
              type="radio"
              name="label-size"
              checked={size === option}
              onChange={() => setSize(option)}
            />
            <strong>{labelSizes[option].name}</strong>
            <span className="muted small">{labelSizes[option].help}</span>
          </label>
        ))}
      </fieldset>

      <div className="label-preview" aria-label="Label preview">
        {items.slice(0, previewLimit).map((item) => (
          <figure key={item.id} className="label-card">
            {logoUrl && <img className="label-logo" src={logoUrl} alt="" />}
            <QRCodeSVG value={item.url} size={112} marginSize={2} />
            <figcaption>
              <strong>{item.bedName}</strong>
              <span className="muted small">{item.location}</span>
            </figcaption>
          </figure>
        ))}
        {items.length > previewLimit && (
          <p className="muted small label-more">+ {items.length - previewLimit} more in the PDF</p>
        )}
      </div>

      <div className="actions">
        <button type="button" disabled={busy} onClick={() => void download()}>
          {busy ? 'Preparing PDF…' : `Download PDF (${pages} page${pages === 1 ? '' : 's'})`}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void openToPrint()}
        >
          Open PDF to print
        </button>
        {children}
        <button type="button" className="secondary" onClick={() => void close()}>
          Done
        </button>
      </div>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </Modal>
  );
}
