import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Activity, ArrowUpRight, BarChart3, CircleHelp, FileSpreadsheet, FolderOpen, LayoutDashboard, Plus, Settings2, ShieldCheck, Sparkles } from 'lucide-react';
import { getHealth } from './lib/api';

function App() {
  return (
    <div className="min-h-screen bg-[#f7f8fc] text-slate-900 md:flex">
      <aside className="sidebar fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col border-r border-slate-200/80 bg-white md:flex">
        <div className="flex h-[78px] items-center gap-3 px-6">
          <div className="brand-mark"><BarChart3 size={19} strokeWidth={2.5} /></div>
          <span className="text-[17px] font-bold tracking-tight">proof<span className="text-indigo-600">board</span></span>
        </div>
        <div className="px-4 pt-5">
          <p className="nav-caption px-3 pb-2">WORKSPACE</p>
          <nav className="space-y-1" aria-label="Main navigation">
            <NavItem to="/" icon={<LayoutDashboard size={17} />} label="Overview" />
            <NavItem to="/reports" icon={<FileSpreadsheet size={17} />} label="Reports" />
            <NavItem to="/datasets" icon={<FolderOpen size={17} />} label="Datasets" />
          </nav>
        </div>
        <div className="mt-auto px-4 pb-5">
          <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
            <div className="mb-2 flex items-center gap-2 text-indigo-700"><Sparkles size={15} /><span className="text-xs font-semibold">Your workspace</span></div>
            <p className="text-xs leading-5 text-slate-600">Your reports and data will live here once you add a dataset.</p>
          </div>
          <nav className="space-y-1" aria-label="Help and settings">
            <NavItem to="/help" icon={<CircleHelp size={17} />} label="Help & feedback" />
            <NavItem to="/settings" icon={<Settings2 size={17} />} label="Settings" />
          </nav>
          <div className="mt-5 flex items-center gap-3 border-t border-slate-100 px-2 pt-4">
            <div className="avatar">PB</div>
            <div className="min-w-0"><p className="text-sm font-semibold">Local workspace</p><p className="truncate text-xs text-slate-500">No account connected</p></div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 md:ml-[248px]">
        <header className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-slate-200/70 bg-white/90 px-5 backdrop-blur md:px-9">
          <div className="flex items-center gap-2 text-sm"><span className="text-slate-400">Workspace</span><span className="text-slate-300">/</span><span className="font-medium">Overview</span></div>
          <div className="flex items-center gap-3"><HealthStatus /><button className="button-primary hidden sm:inline-flex" disabled title="Dataset upload will be available in a later phase"><Plus size={16} /> New report</button><div className="avatar md:hidden">PB</div></div>
        </header>
        <div className="mx-auto max-w-[1180px] px-5 py-8 md:px-9 md:py-10">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="*" element={<ComingSoon />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}>{icon}<span>{label}</span></NavLink>;
}

function HealthStatus() {
  const [state, setState] = useState<'loading' | 'online' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    getHealth().then(() => { if (active) setState('online'); }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, []);
  return <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 sm:flex" aria-live="polite">
    <span className={`h-2 w-2 rounded-full ${state === 'online' ? 'bg-emerald-500' : state === 'error' ? 'bg-rose-500' : 'animate-pulse bg-amber-400'}`} />
    {state === 'loading' ? 'Connecting…' : state === 'online' ? 'All systems operational' : 'API unavailable'}
  </div>;
}

function Dashboard() {
  return <>
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-medium text-indigo-600"><Activity size={14} /> YOUR DATA, MADE CLEAR</div><h1 className="text-3xl font-bold tracking-tight md:text-[34px]">Good to see you.</h1><p className="mt-2 text-sm text-slate-500">A clear view of your reporting workspace.</p></div>
      <button className="button-primary w-fit" disabled title="Dataset upload will be available in a later phase"><Plus size={16} /> Create a report</button>
    </div>
    <section className="grid gap-4 sm:grid-cols-3" aria-label="Workspace summary">
      <SummaryCard icon={<FileSpreadsheet size={17} />} title="Reports" value="—" note="No reports yet" tint="violet" />
      <SummaryCard icon={<FolderOpen size={17} />} title="Datasets" value="—" note="No datasets yet" tint="blue" />
      <SummaryCard icon={<ShieldCheck size={17} />} title="Shared with you" value="—" note="Sharing is not set up" tint="green" />
    </section>
    <section className="mt-7 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.025)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-semibold">Recent reports</h2><p className="mt-1 text-xs text-slate-500">Your latest report activity will appear here.</p></div><button className="button-quiet" disabled>View all <ArrowUpRight size={14} /></button></div>
      <EmptyState />
    </section>
    <p className="mt-5 text-center text-xs text-slate-400">Your data stays yours. Nothing appears here until you add it.</p>
  </>;
}

function SummaryCard({ icon, title, value, note, tint }: { icon: React.ReactNode; title: string; value: string; note: string; tint: string }) {
  return <article className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)]"><div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-500">{title}</span><span className={`icon-tint tint-${tint}`}>{icon}</span></div><div className="mt-4 flex items-end justify-between"><span className="text-3xl font-bold tracking-tight text-slate-300">{value}</span><span className="text-xs text-slate-400">{note}</span></div></article>;
}

function EmptyState() {
  return <div className="flex min-h-[270px] flex-col items-center justify-center px-6 py-12 text-center">
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500"><FileSpreadsheet size={24} /></div>
    <h3 className="text-sm font-semibold">Your first report starts with a dataset</h3>
    <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Upload a CSV to explore its columns, then build a report with calculations you can trace back to your data.</p>
    <button className="button-secondary mt-5" disabled title="CSV upload will be available in a later phase"><Plus size={15} /> Add a dataset</button>
    <span className="mt-3 text-[11px] text-slate-400">CSV upload is coming in the next build phase</span>
  </div>;
}

function ComingSoon() {
  return <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><FolderOpen size={21} /></div><h1 className="text-xl font-semibold">This workspace section is being prepared</h1><p className="mt-2 text-sm text-slate-500">The dashboard is ready. More workspace features will arrive in a later phase.</p></div>;
}

export default App;
