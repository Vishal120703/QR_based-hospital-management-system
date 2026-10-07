import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PoweredBy } from '../src/components';

describe('Company mark', () => {
  it('says the product is powered by Healio Healthtech, in English and Hindi', () => {
    const { unmount } = render(<PoweredBy />);
    expect(screen.getByText(/Powered by/).textContent).toBe('Powered by Healio Healthtech');
    unmount();
    render(<PoweredBy language="hi" />);
    expect(screen.getByText('Healio Healthtech').closest('p')?.textContent).toBe(
      'Healio Healthtech द्वारा संचालित',
    );
  });
});
