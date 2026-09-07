import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page from '../src/app/page';

describe('Home Page', () => {
  it('renders the main heading', () => {
    render(<Page />);
    const heading = screen.getByRole('heading', { level: 1, name: /Clipboard/i });
    expect(heading).toBeDefined();
  });

  it('renders the sync status', () => {
    render(<Page />);
    expect(screen.getByText(/Sync is ON/i)).toBeDefined();
  });
});
