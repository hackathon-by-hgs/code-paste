import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DeviceList } from '../../src/components/DeviceList';

describe('Device Management Integration', () => {
  it('loads and displays devices', async () => {
    render(<DeviceList />);
    
    // Initially shows loading state
    expect(screen.getByText(/Loading devices.../i)).toBeDefined();

    // Eventually loads the mock devices
    await waitFor(() => {
      expect(screen.getByText(/MacBook Pro/i)).toBeDefined();
    });
    expect(screen.getByText(/iPhone 15/i)).toBeDefined();
  });

  it('allows revoking a device', async () => {
    // Mock the global confirm to auto-accept
    vi.stubGlobal('confirm', () => true);

    render(<DeviceList />);
    
    // Wait for load
    await waitFor(() => {
      expect(screen.getByText(/MacBook Pro/i)).toBeDefined();
    });

    const revokeButtons = screen.getAllByText(/Revoke/i);
    // Revoke the first one
    revokeButtons[0].click();

    // Wait for the device to be removed from the UI
    await waitFor(() => {
      expect(screen.queryByText(/MacBook Pro/i)).toBeNull();
    });

    vi.unstubAllGlobals();
  });
});
