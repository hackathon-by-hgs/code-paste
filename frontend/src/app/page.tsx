'use client';

import { Header } from '../components/Header';
import { SyncStatus } from '../components/SyncStatus';
import { DeviceList } from '../components/DeviceList';
import { SharingSession } from '../components/SharingSession';
import { SignInPanel } from '../components/SignInPanel';
import { AuthProvider, useAuth } from '../features/auth/AuthProvider';
import { DevicesProvider } from '../features/devices/DevicesProvider';

/**
 * The device and sharing panels are mounted only once there is a session — they
 * fetch on mount, and mounting them signed-out would fire guaranteed 401s.
 */
const Dashboard = () => {
  const { user } = useAuth();

  if (!user) return <SignInPanel />;

  return (
    <DevicesProvider>
      <main className="flex-1 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/20">
        <SyncStatus />
        <DeviceList />
        <SharingSession />
      </main>
    </DevicesProvider>
  );
};

const Home = () => {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-black text-white flex flex-col font-sans">
        <Header />
        <Dashboard />
      </div>
    </AuthProvider>
  );
};

export default Home;
