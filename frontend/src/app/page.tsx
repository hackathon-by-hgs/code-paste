import { Header } from '../components/Header';
import { SyncStatus } from '../components/SyncStatus';
import { DeviceList } from '../components/DeviceList';
import { SharingSession } from '../components/SharingSession';

const Home = () => {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans">
      <Header />
      <main className="flex-1 grid grid-cols-3 divide-x divide-white/20">
        <SyncStatus />
        <DeviceList />
        <SharingSession />
      </main>
    </div>
  );
}

export default Home;
