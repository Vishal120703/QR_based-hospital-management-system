import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateForm, Modal, normalizeFormValues, type FieldSpec } from '../src/components';

const fields = (values: Record<string, string>): FieldSpec[] => [
  {
    name: 'wardId',
    label: 'Ward',
    options: [
      { value: 'a', label: 'Ward A' },
      { value: 'b', label: 'Ward B' },
    ],
  },
  {
    name: 'roomId',
    label: 'Room',
    optional: true,
    options:
      values.wardId === 'a'
        ? [{ value: 'a1', label: 'Room A1' }]
        : [{ value: 'b1', label: 'Room B1' }],
  },
];

describe('CreateForm interactions', () => {
  it('clears a room when the selected ward changes', async () => {
    const user = userEvent.setup();
    const create = vi.fn().mockResolvedValue(undefined);
    render(
      <CreateForm fields={fields} submitLabel="Add bed" onCreate={create} onError={vi.fn()} />,
    );
    await user.selectOptions(screen.getByLabelText('Ward'), 'a');
    await user.selectOptions(screen.getByLabelText('Room (optional)'), 'a1');
    await user.selectOptions(screen.getByLabelText('Ward'), 'b');
    expect(screen.getByLabelText<HTMLSelectElement>('Room (optional)').value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Add bed' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ wardId: 'b', roomId: '' }));
  });

  it('blocks repeated submission while saving and reports success', async () => {
    let finish: (() => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <CreateForm
        fields={() => [{ name: 'name', label: 'Name' }]}
        submitLabel="Add ward"
        onCreate={create}
        onError={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'General' } });
    const form = screen.getByRole('button', { name: 'Add ward' }).closest('form');
    if (!form) throw new Error('Expected create form.');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Saving…' }).disabled).toBe(true);
    finish?.();
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Saved successfully.');
  });

  it('normalizes dependent selections without modifying password whitespace', () => {
    expect(
      normalizeFormValues({ wardId: 'b', roomId: 'a1', password: '  secure password  ' }, fields),
    ).toEqual({ wardId: 'b', roomId: '', password: '  secure password  ' });
  });
});

describe('Modal', () => {
  it('opens a named native dialog and handles Escape cancellation', () => {
    const close = vi.fn();
    render(
      <Modal title="Manage staff" onClose={close}>
        <p>Staff details</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Manage staff' });
    expect(dialog.hasAttribute('open')).toBe(true);
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open when a file picker inside it is cancelled', () => {
    const close = vi.fn();
    render(
      <Modal title="Add hospital" onClose={close}>
        <input type="file" aria-label="Logo" />
      </Modal>,
    );
    // Browsers fire a bubbling "cancel" on the input when its picker closes
    // without a file; that must not close the dialog and lose the form.
    fireEvent(screen.getByLabelText('Logo'), new Event('cancel', { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Add hospital' }).hasAttribute('open')).toBe(true);
  });
});
