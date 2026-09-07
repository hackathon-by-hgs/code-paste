import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SharingSession } from '../../src/components/SharingSession';

describe('Sharing Session Integration', () => {
  it('shows no session initially and can start sharing', async () => {
    render(<SharingSession />);
    
    // Wait for the null session to load
    await waitFor(() => {
      expect(screen.getByText(/Not currently sharing with others./i)).toBeDefined();
    });

    const startButton = screen.getByText(/Start Sharing/i);
    // Suppress alert for test
    vi.stubGlobal('alert', () => {});
    startButton.click();

    await waitFor(() => {
      expect(screen.getByText(/Sharing active./i)).toBeDefined();
      // Expect owner to be in the list
      expect(screen.getByText(/hello@example.com/i)).toBeDefined();
    });

    vi.unstubAllGlobals();
  });
});
