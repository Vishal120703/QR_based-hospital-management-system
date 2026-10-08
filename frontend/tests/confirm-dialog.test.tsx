import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm, type ConfirmQuestion } from '../src/components';

function Asker({ question }: { question: ConfirmQuestion }) {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState('none');
  return (
    <>
      <button
        type="button"
        onClick={() => void confirm(question).then((ok) => setAnswer(String(ok)))}
      >
        Ask
      </button>
      <output>{answer}</output>
    </>
  );
}

function show(question: ConfirmQuestion) {
  render(
    <ConfirmProvider>
      <Asker question={question} />
    </ConfirmProvider>,
  );
}

const deactivate =
  'Deactivate Maintenance? Its services will be hidden from patients and its staff will not be eligible for that department.';

describe('Confirmation dialog', () => {
  it('shows the question as the title, the rest as the explanation, and the action as the button', async () => {
    const user = userEvent.setup();
    show(deactivate);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Deactivate Maintenance?' });
    expect(dialog.textContent).toContain('Its services will be hidden from patients');
    const action = screen.getByRole('button', { name: 'Deactivate' });
    expect(action.className).toBe('danger-solid');
    await user.click(action);
    expect(screen.getByRole('status').textContent).toBe('true');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('answers no on Cancel and on Escape', async () => {
    const user = userEvent.setup();
    show(deactivate);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('status').textContent).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('false');
  });

  it('uses a chosen title and button, and a calm button for safe actions', async () => {
    const user = userEvent.setup();
    show({ title: 'Reactivate Sunrise?', confirmLabel: 'Reactivate client' });
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByRole('alertdialog', { name: 'Reactivate Sunrise?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reactivate client' }).className).toBe('');
  });
});
