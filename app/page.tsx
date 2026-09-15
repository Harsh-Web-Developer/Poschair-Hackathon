'use client';

import dynamic from 'next/dynamic';

const Dashboard = dynamic(() => import('../components/Dashboard'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[#06090e] text-cyan-400 font-mono flex flex-col items-center justify-center">
      <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mb-4" />
      <div className="text-sm font-bold tracking-widest uppercase">INITIALIZING NEURAL SENTRY HUD...</div>
    </div>
  ),
});

export default function Page() {
  return <Dashboard />;
}
