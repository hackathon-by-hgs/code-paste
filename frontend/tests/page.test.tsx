import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page from '../src/app/page';

describe('Home Page', () => {
  it('renders the main heading', () => {
    render(<Page />);
    const heading = screen.getByRole('heading', { level: 1, name: /Clipboard/i });
    expect(heading).toBeDefined();
  });

  it('asks for credentials before showing the dashboard', () => {
    // Tokens live in memory only, so a fresh mount is always signed out.
    render(<Page />);

    expect(screen.getByRole('heading', { name: /Sign In/i })).toBeDefined();
    expect(screen.getByText(/Not logged in/i)).toBeDefined();
  });

  it('does not mount the device or sharing panels while signed out', () => {
    // Those panels fetch on mount; rendering them without a session would fire
    // guaranteed 401s at the control plane.
    render(<Page />);

    expect(screen.queryByText(/My Devices/i)).toBeNull();
    expect(screen.queryByText(/Sharing Session/i)).toBeNull();
  });
});
