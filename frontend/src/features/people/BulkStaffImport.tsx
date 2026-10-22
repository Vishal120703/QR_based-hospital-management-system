import { useRef, useState } from 'react';
import { ApiError, staffApi } from '../../api';
import { ErrorNotice } from '../../components';
import { useAdmin } from '../workspace/AdminLayout';
import type { Directory } from './staff-directory';
import { readStaffImport, type StaffImportResult } from './staff-import';

const templateHeaders = [
  'Full name',
  'Email',
  'Temporary password',
  'Role',
  'Role scope',
  'Departments',
  'Coverage',
];

export function BulkStaffImport({
  directory,
  onImported,
}: {
  directory: Directory;
  onImported: () => void;
}) {
  const { token, reportError, reportSuccess, can } = useAdmin();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<StaffImportResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAssignRoles = can('role.manage') && can('role.read');

  async function chooseFile(file: File | undefined) {
    setResult(null);
    setError(null);
    setFileName(file?.name ?? '');
    if (!file) return;
    setParsing(true);
    try {
      setResult(await readStaffImport(file, directory));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be read.');
    } finally {
      setParsing(false);
    }
  }

  async function importRows() {
    if (!result || result.errors.length > 0 || result.rows.length === 0 || importing) return;
    setImporting(true);
    setError(null);
    try {
      const response = await staffApi.bulkCreateStaff(token, result.rows);
      reportSuccess(
        `${response.created} staff ${response.created === 1 ? 'member was' : 'members were'} added.`,
      );
      setResult(null);
      setFileName('');
      if (input.current) input.current.value = '';
      onImported();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) reportError(cause);
      else setError(cause instanceof Error ? cause.message : 'The staff import failed.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="card add-staff" aria-labelledby="bulk-staff-title">
      <div className="section-heading">
        <div>
          <h2 id="bulk-staff-title">Import staff from a file</h2>
          <p className="muted small">
            Upload the first sheet of an .xlsx file or a .csv file. Review every row before the
            accounts are created together.
          </p>
        </div>
        <button type="button" className="secondary" onClick={downloadTemplate}>
          Download CSV template
        </button>
      </div>
      <p className="muted small">
        Required: Full name, Email, Temporary password. Optional lists use semicolons. Coverage can
        be Hospital, Floor: F1, or Ward: GENERAL. Role scope is required for a floor, ward, or
        department role.
      </p>
      {!canAssignRoles && (
        <p className="notice notice-warning small">
          Leave Role and Role scope blank because your account cannot assign roles.
        </p>
      )}
      {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}
      <label>
        Staff spreadsheet
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={parsing || importing}
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
      </label>
      {parsing && <p role="status">Reading {fileName}…</p>}
      {result && result.errors.length > 0 && (
        <div className="notice notice-error" role="alert">
          <strong>Fix these rows and upload the file again:</strong>
          <ul>
            {result.errors.slice(0, 20).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          {result.errors.length > 20 && <p>{result.errors.length - 20} more errors were found.</p>}
        </div>
      )}
      {result && result.errors.length === 0 && (
        <>
          <div className="table-wrap">
            <table className="responsive-table" aria-label="Staff import preview">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Departments</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {result.preview.map((row) => (
                  <tr key={row.rowNumber}>
                    <td data-label="Row">{row.rowNumber}</td>
                    <td data-label="Name">{row.displayName}</td>
                    <td data-label="Email">{row.email}</td>
                    <td data-label="Role">{row.role}</td>
                    <td data-label="Departments">{row.departments}</td>
                    <td data-label="Coverage">{row.coverage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button type="button" disabled={importing} onClick={() => void importRows()}>
              {importing
                ? 'Importing…'
                : `Import ${result.rows.length} staff ${result.rows.length === 1 ? 'member' : 'members'}`}
            </button>
            <span className="muted small">
              Temporary passwords are not shown here. Share them privately and ask each person to
              change theirs after signing in.
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function downloadTemplate() {
  const csv = `\uFEFF${templateHeaders.join(',')}\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'care-qr-staff-import.csv';
  link.click();
  URL.revokeObjectURL(url);
}
