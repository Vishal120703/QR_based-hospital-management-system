import { useEffect, useRef, useState, type FormEvent } from 'react';
import { assetUrl, staffApi, type Hospital } from '../api';
import { LoadState, PageHeading } from '../components';
import { acceptedLogoTypes, prepareLogo } from '../logo-image';
import { useAdmin } from './AdminLayout';

export function HospitalProfilePage() {
  const { token, reportError, reportSuccess, refreshMe } = useAdmin();
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<{ url: string; blob: Blob; size: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    staffApi.hospital(token).then(
      (loaded) => {
        if (cancelled) return;
        setHospital(loaded);
        setName(loaded.name);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the hospital.');
        reportError(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, version, reportError]);

  // Release the preview's object URL when it is replaced or the page closes.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      setHospital(await staffApi.hospital(token));
      refreshMe?.();
      reportSuccess(success);
      return true;
    } catch (cause) {
      reportError(cause);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      const prepared = await prepareLogo(file);
      setPreview({
        url: URL.createObjectURL(prepared.blob),
        blob: prepared.blob,
        size: `${prepared.width} × ${prepared.height} px`,
      });
    } catch (cause) {
      reportError(cause);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function saveName(event: FormEvent) {
    event.preventDefault();
    if (!hospital || name.trim() === hospital.name) return;
    void run(() => staffApi.updateHospital(token, { name: name.trim() }), 'Hospital name saved.');
  }

  if (!hospital) {
    return (
      <LoadState
        loading={!loadError}
        error={loadError}
        label="Loading hospital profile…"
        onRetry={() => {
          setLoadError(null);
          setVersion((value) => value + 1);
        }}
      />
    );
  }

  const current = hospital.logoUrl ? assetUrl(hospital.logoUrl) : null;

  return (
    <>
      <PageHeading
        title="Hospital profile"
        description="Your hospital's name and logo appear in the staff app, on the patient page, and on every printed QR label."
      />
      <div className="profile-grid">
        <section className="card" aria-labelledby="logo-title">
          <h2 id="logo-title">Logo</h2>
          <div className="logo-stage">
            {preview || current ? (
              <img
                src={preview?.url ?? current ?? ''}
                alt={`${hospital.name} logo${preview ? ' (preview)' : ''}`}
              />
            ) : (
              <span className="muted">No logo yet</span>
            )}
          </div>
          {preview ? (
            <>
              <p className="small muted">
                Preview · {preview.size}. Check it looks right, then save.
              </p>
              <div className="actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() => staffApi.uploadLogo(token, preview.blob), 'Logo saved.').then(
                      (saved) => {
                        if (saved) setPreview(null);
                      },
                    )
                  }
                >
                  {busy ? 'Saving…' : 'Save logo'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setPreview(null)}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="actions">
              <label className={`button${current ? ' secondary' : ''} file-button`}>
                {current ? 'Replace logo' : 'Upload logo'}
                <input
                  ref={fileInput}
                  type="file"
                  accept={acceptedLogoTypes}
                  disabled={busy}
                  onChange={(event) => void choose(event.target.files?.[0])}
                />
              </label>
              {current && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Remove the logo? New QR labels will print without it.')) {
                      void run(() => staffApi.removeLogo(token), 'Logo removed.');
                    }
                  }}
                >
                  Remove logo
                </button>
              )}
            </div>
          )}
          <p className="small muted">
            PNG, JPEG, WebP, or SVG. A wide or square logo on a transparent or white background
            works best. It is resized to at most 512 px and saved as PNG. Already-printed labels
            keep their old logo.
          </p>
        </section>

        <section className="card" aria-labelledby="details-title">
          <h2 id="details-title">Details</h2>
          <form className="create-form" onSubmit={saveName}>
            <label>
              Hospital name
              <input
                value={name}
                required
                minLength={2}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || name.trim() === hospital.name}>
              Save name
            </button>
          </form>
          <dl className="profile-facts">
            <div>
              <dt>Hospital code</dt>
              <dd className="code">{hospital.code}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{hospital.timezone}</dd>
            </div>
          </dl>
          <p className="small muted">
            Staff enter the hospital code when they sign in. It cannot be changed here.
          </p>
        </section>
      </div>
    </>
  );
}
