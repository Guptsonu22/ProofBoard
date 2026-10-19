import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, BarChart3, CircleHelp, FileSpreadsheet, FolderOpen, LayoutDashboard, LogOut, Plus, Settings2, Sparkles } from 'lucide-react';
import { authenticate, getCurrentUser, getHealth, logout, type PublicUser } from './lib/api';
import { DatasetDetailPage, DatasetsPage } from './datasets/DatasetPages';
import { ReportEditorPage, ReportsPage } from './reports/ReportPages';

function App() {
  const location = useLocation();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authState, setAuthState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [authError, setAuthError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((currentUser) => { if (active) { setUser(currentUser); setAuthState('ready'); } })
      .catch(() => { if (active) { setAuthError('The account service is unavailable. Please try again.'); setAuthState('error'); } });
    return () => { active = false; };
  }, []);

  async function signOut() {
    setLogoutBusy(true);
    setAuthError('');
    try {
      await logout();
      setUser(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign out.');
    } finally {
      setLogoutBusy(false);
    }
  }

  if (authState === 'loading') return <CenteredState title="Checking your session…" />;
  if (!user) return <AuthScreen initialError={authError} onAuthenticated={setUser} />;

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
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Your workspace</p><p className="truncate text-xs text-slate-500">{user.email}</p></div>
            <button type="button" className="icon-button" onClick={signOut} disabled={logoutBusy} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 md:ml-[248px]">
        <header className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-slate-200/70 bg-white/90 px-5 backdrop-blur md:px-9">
          <div className="flex items-center gap-2 text-sm"><span className="text-slate-400">Workspace</span><span className="text-slate-300">/</span><span className="font-medium">{location.pathname.startsWith('/datasets') ? 'Datasets' : location.pathname.startsWith('/reports') ? 'Reports' : 'Overview'}</span></div>
          <div className="flex items-center gap-3"><HealthStatus /><Link to="/datasets" className="button-primary hidden sm:inline-flex"><Plus size={16} /> Add dataset</Link><div className="avatar md:hidden">PB</div></div>
        </header>
        <div className="mx-auto max-w-[1180px] px-5 py-8 md:px-9 md:py-10">
          <Routes>
            <Route path="/" element={<Dashboard email={user.email} />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/datasets/:datasetId" element={<DatasetDetailPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/:reportId" element={<ReportEditorPage />} />
            <Route path="*" element={<ComingSoon />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function AuthScreen({ initialError, onAuthenticated }: { initialError: string; onAuthenticated: (user: PublicUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onAuthenticated(await authenticate(mode, email, password));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fc] px-5 py-10">
    <section className="w-full max-w-[420px] rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_12px_50px_rgba(15,23,42,0.07)] sm:p-9">
      <div className="mb-8 flex items-center gap-3"><div className="brand-mark"><BarChart3 size={19} strokeWidth={2.5} /></div><span className="text-[17px] font-bold tracking-tight">proof<span className="text-indigo-600">board</span></span></div>
      <p className="mb-2 text-xs font-semibold tracking-[.12em] text-indigo-600">YOUR DATA, MADE CLEAR</p>
      <h1 className="text-2xl font-bold tracking-tight">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">{mode === 'login' ? 'Sign in to continue to your reporting workspace.' : 'Set up a secure account for your private workspace.'}</p>
      <form className="mt-7 space-y-4" onSubmit={submit}>
        <label className="block text-sm font-medium text-slate-700">Email address<input className="form-input mt-1.5" type="email" name="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="block text-sm font-medium text-slate-700">Password<input className="form-input mt-1.5" type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 12 : 1} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} /><span className="mt-1 block text-xs font-normal text-slate-400">{mode === 'register' ? 'Use 12 or more characters (maximum 72 bytes).' : 'Enter your account password.'}</span></label>
        {error && <p className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
        <button className="button-primary w-full justify-center py-3" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">{mode === 'login' ? 'New to ProofBoard?' : 'Already have an account?'}{' '}
        <button className="font-semibold text-indigo-600 hover:text-indigo-800" type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button>
      </p>
      <p className="mt-5 text-center text-xs text-slate-400">Your session stays in a secure, HTTP-only cookie.</p>
    </section>
  </main>;
}

function CenteredState({ title }: { title: string }) {
  return <main className="flex min-h-screen items-center justify-center bg-[#f7f8fc] text-sm text-slate-500"><span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-indigo-500" />{title}</main>;
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

function Dashboard({ email }: { email: string }) {
  return <>
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-medium text-indigo-600"><Activity size={14} /> YOUR DATA, MADE CLEAR</div><h1 className="text-3xl font-bold tracking-tight md:text-[34px]">Good to see you, {email.split('@')[0]}.</h1><p className="mt-2 text-sm text-slate-500">A clear view of your reporting workspace.</p></div>
      <Link className="button-primary w-fit" to="/datasets"><Plus size={16} /> Add a dataset</Link>
    </div>
    <section className="mt-2 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.025)]">
      <div className="border-b border-slate-100 px-6 py-5"><h2 className="font-semibold">Start with a dataset</h2><p className="mt-1 text-xs text-slate-500">Upload a CSV to see its profile and data quality.</p></div>
      <div className="flex min-h-[230px] flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500"><FileSpreadsheet size={24} /></div>
        <h3 className="text-sm font-semibold">Your first dataset starts here</h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Explore column types, missing values, and row level warnings before creating reports.</p>
        <Link className="button-secondary mt-5" to="/datasets"><Plus size={15} /> Add a dataset</Link>
      </div>
    </section>
    <p className="mt-5 text-center text-xs text-slate-400">Your dataset list is private to your account.</p>
  </>;
}


function ComingSoon() {
  return <div className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><FolderOpen size={21} /></div><h1 className="text-xl font-semibold">This workspace section is being prepared</h1><p className="mt-2 text-sm text-slate-500">The dashboard is ready. More workspace features will arrive in a later phase.</p></div>;
}

export default App;
