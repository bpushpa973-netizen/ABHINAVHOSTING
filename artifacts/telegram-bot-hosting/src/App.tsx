import { useEffect, useMemo, useState, type ReactNode, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { shadcn } from '@clerk/themes';
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Bell, Bot,
  Check, ChevronDown, ChevronRight, Command, Copy, Cpu,
  Database, ExternalLink, FileCode2, Filter, GitBranch, HardDrive,
  LayoutDashboard, LifeBuoy, ListFilter, Menu, MoreHorizontal,
  Package, Plus, Power, RefreshCw, Rocket, Search, Send, Server, Settings,
  ShieldCheck, SquareTerminal, Terminal, Trash2, UploadCloud, Wifi, X, Zap,
} from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const adminEmailAllowlist = new Set(['abhinavking56777@gmail.com']);

function hasAdminAccess(user: { publicMetadata?: Record<string, unknown>; primaryEmailAddress?: { emailAddress: string } | null } | null | undefined) {
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  return user?.publicMetadata?.role === 'admin' || (email ? adminEmailAllowlist.has(email) : false);
}

async function uploadBotFile(file: File) {
  const response = await fetch('/api/storage/uploads/request-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Could not prepare file upload.');
  }
  const { uploadURL, objectPath, metadata } = await response.json() as { uploadURL: string; objectPath: string; metadata: { name: string; size: number } };
  const upload = await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!upload.ok) throw new Error('Could not upload bot file to storage.');
  return { objectPath, fileName: metadata.name, fileSize: metadata.size };
}

async function readApiBody(response: Response) {
  return await response.json().catch(() => ({})) as { error?: string; status?: string; logs?: string[] };
}

async function runHostedBot(bot: BotRecord) {
  if (!bot.objectPath) throw new Error('This bot has no stored source file. Delete it and add it again.');
  const response = await fetch('/api/bots/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      botId: bot.id,
      runtime: bot.runtime,
      entryFile: bot.entryFile,
      sourceObjectPath: bot.objectPath,
      requirementsObjectPath: bot.requirementsObjectPath,
    }),
  });
  const body = await readApiBody(response);
  if (!response.ok) throw new Error([body.error, ...(body.logs ?? []).slice(-2)].filter(Boolean).join(' · ') || 'The bot could not start.');
  return body;
}

async function stopHostedBot(botId: string) {
  const response = await fetch(`/api/bots/${encodeURIComponent(botId)}/stop`, { method: 'POST' });
  const body = await readApiBody(response);
  if (!response.ok) throw new Error(body.error || 'The bot could not be stopped.');
  return body;
}

type BotRecord = {
  id: string; name: string; username: string; status: 'online' | 'deploying' | 'offline' | 'error';
  runtime: 'Python' | 'Java'; entryFile: string; branch: string; version: string; uptime: string; cpu: string; memory: string;
  color: string; initials: string; requests: number; objectPath?: string; fileName?: string; fileSize?: number;
  requirementsObjectPath?: string; requirementsFileName?: string; runtimeLogs?: string[];
};

async function fetchSavedBots(): Promise<BotRecord[]> {
  const response = await fetch('/api/bots');
  const body = await response.json().catch(() => []);
  if (!response.ok) throw new Error(body.error || 'Could not load saved bots.');
  return body as BotRecord[];
}

async function saveBot(bot: BotRecord): Promise<BotRecord> {
  const response = await fetch('/api/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bot),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not save this bot.');
  return body as BotRecord;
}

async function deleteSavedBot(bot: BotRecord) {
  const response = await fetch(`/api/bots/${encodeURIComponent(bot.id)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Could not delete this bot.');
  }
  if (bot.objectPath) await fetch(`/api/storage${bot.objectPath}`, { method: 'DELETE' });
  if (bot.requirementsObjectPath) await fetch(`/api/storage${bot.requirementsObjectPath}`, { method: 'DELETE' });
}

const initialBots: BotRecord[] = [];
const emptyBot: BotRecord = {
  id: 'empty', name: 'No bot selected', username: '—', status: 'offline', runtime: 'Python',
  entryFile: 'main.py', branch: 'main', version: '—', uptime: '—', cpu: '—', memory: '—',
  color: '#9aa7b1', initials: '—', requests: 0,
};

const activityItems: { type: string; title: string; detail: string; time: string; tone: string }[] = [];

const logs = [
  ['14:32:08', 'info', 'Polling update queue… offset=824193'],
  ['14:32:10', 'ok', 'POST /webhook/atlas 200 42ms'],
  ['14:32:16', 'info', 'Received update #824194 from telegram'],
  ['14:32:16', 'ok', 'Command /start handled in 18ms'],
  ['14:32:28', 'warn', 'Upstream latency above 200ms (214ms)'],
  ['14:32:41', 'ok', 'POST /webhook/atlas 200 38ms'],
  ['14:32:49', 'info', 'Cache refreshed: 24 keys'],
];

function StatusDot({ status }: { status: BotRecord['status'] }) {
  const styles = { online: 'bg-[#37c88a]', deploying: 'bg-[#e2aa44]', offline: 'bg-[#9aa7b1]', error: 'bg-[#d66c54]' };
  return <span className={`inline-block h-2 w-2 rounded-full ${styles[status]} ${status === 'online' ? 'animate-pulse-dot' : ''}`} />;
}

function BotAvatar({ bot, size = 'md' }: { bot: BotRecord; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-8 w-8 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-12 w-12 text-sm' };
  return <div className={`${sizes[size]} grid shrink-0 place-items-center rounded-xl font-extrabold text-white`} style={{ backgroundColor: bot.color }}>{bot.initials}</div>;
}

function LogoutButton() {
  const { signOut } = useClerk();
  return <button type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="mt-2 w-full rounded-lg px-2 py-1.5 text-left font-mono text-[9px] text-[#7ea0aa] transition hover:bg-white/10 hover:text-white" data-testid="button-logout">Log out</button>;
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [location] = useLocation();
  const { user } = useUser();
  const isAdmin = hasAdminAccess(user);
  const links = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/bots', label: 'Hosted bots', icon: Bot, count: '4' },
    { href: '/terminal', label: 'Terminal', icon: SquareTerminal },
  ];
  return (
    <>
      <div className={`fixed inset-0 z-30 bg-[#0d2534]/30 backdrop-blur-sm transition-opacity md:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={onClose} />
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-[#0e2938] text-[#b9d0d8] transition-transform duration-300 md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-[76px] items-center justify-between border-b border-white/10 px-6">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#22acd0] text-[#082b3c]"><Command size={19} strokeWidth={2.5} /></div>
            <div><div className="font-extrabold tracking-[-.03em] text-[#edf9fb]">Abhinav <span className="text-[#38ca8b]">Hosting</span></div><div className="font-mono text-[9px] uppercase tracking-[.19em] text-[#6f949f]">bot operations</div></div>
          </Link>
          <button onClick={onClose} className="rounded-lg p-1 text-[#8baab5] hover:bg-white/10 md:hidden" data-testid="button-close-menu"><X size={18} /></button>
        </div>
        <div className="px-4 pt-7">
          <div className="mb-3 px-3 font-mono text-[10px] font-medium uppercase tracking-[.18em] text-[#668996]">Workspace</div>
          <nav className="space-y-1">
            {links.map(({ href, label, icon: Icon, count }) => {
              const active = location === href;
              return <Link key={href} href={href} onClick={onClose} data-testid={`link-nav-${label.toLowerCase().replace(' ', '-')}`} className={`group flex items-center justify-between rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors ${active ? 'bg-[#173e50] text-[#f2fbfc]' : 'text-[#a7c2ca] hover:bg-white/5 hover:text-white'}`}>
                <span className="flex items-center gap-3"><Icon size={17} strokeWidth={active ? 2.2 : 1.8} className={active ? 'text-[#47c4e4]' : 'text-[#789da8]'} />{label}</span>
                {count && <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${active ? 'bg-[#24566a] text-[#9ae6f3]' : 'bg-white/8 text-[#86a5af]'}`}>{count}</span>}
              </Link>;
            })}
          </nav>
          <div className="mb-3 mt-9 px-3 font-mono text-[10px] font-medium uppercase tracking-[.18em] text-[#668996]">System</div>
          <Link href="/settings" onClick={onClose} data-testid="link-nav-settings" className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors ${location === '/settings' ? 'bg-[#173e50] text-[#f2fbfc]' : 'text-[#a7c2ca] hover:bg-white/5 hover:text-white'}`}><Settings size={17} className={location === '/settings' ? 'text-[#47c4e4]' : 'text-[#789da8]'} />Settings</Link>
          {isAdmin && <Link href="/admin" onClick={onClose} data-testid="link-nav-admin" className={`mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors ${location === '/admin' ? 'bg-[#173e50] text-[#f2fbfc]' : 'text-[#a7c2ca] hover:bg-white/5 hover:text-white'}`}><ShieldCheck size={17} className={location === '/admin' ? 'text-[#47c4e4]' : 'text-[#789da8'} />Admin panel</Link>}
        </div>
        <div className="mt-auto px-4 pb-5">
          <div className="rounded-2xl border border-white/10 bg-[#123443] p-3.5">
            <div className="mb-3 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#38ca8b] animate-pulse-dot" /><span className="font-mono text-[10px] uppercase tracking-[.15em] text-[#8db2bd]">All systems nominal</span></div>
            <div className="flex items-end justify-between"><span className="text-[11px] text-[#7296a2]">Last checked</span><span className="font-mono text-[10px] text-[#b4d8df]">just now</span></div>
          </div>
          <div className="mt-4 flex items-center gap-3 px-2"><div className="grid h-7 w-7 place-items-center rounded-full bg-[#d6edf1] text-[10px] font-extrabold text-[#176278]">{user?.firstName?.slice(0, 2).toUpperCase() ?? 'AB'}</div><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-bold text-[#d8edf0]">{user?.fullName ?? 'Abhinav Hosting user'}</div><div className="truncate font-mono text-[9px] text-[#6f949f]">{isAdmin ? 'administrator' : '1 month trial'}</div><LogoutButton /></div><MoreHorizontal size={15} className="text-[#6f949f]" /></div>
        </div>
      </aside>
    </>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  const [location] = useLocation();
  const titles: Record<string, [string, string]> = {
    '/': ['Overview', 'Good afternoon, Kai.'],
    '/bots': ['Hosted bots', 'Your fleet at a glance.'],
    '/terminal': ['Terminal', 'Direct line to your infrastructure.'],
    '/settings': ['Settings', 'Workspace controls and preferences.'],
  };
  const [title, subtitle] = titles[location] ?? titles['/'];
  return <header className="flex min-h-[76px] items-center justify-between border-b border-[#dce8ec] bg-[#f8fbfc]/90 px-5 backdrop-blur-md sm:px-8">
    <div className="flex items-center gap-3"><button onClick={onMenu} className="rounded-lg p-2 text-[#57717c] hover:bg-[#e9f2f4] md:hidden" data-testid="button-open-menu"><Menu size={21} /></button><div><div className="text-[17px] font-extrabold tracking-[-.03em] text-[#142b3a]">{title}</div><div className="mt-0.5 hidden text-[11px] font-medium text-[#78909a] sm:block">{subtitle}</div></div></div>
    <div className="flex items-center gap-2.5"><div className="hidden items-center gap-2 rounded-xl border border-[#dbe7ea] bg-white px-3 py-2 text-[11px] font-semibold text-[#58727e] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#39bd82]" />1 month trial</div><div className="hidden items-center gap-2 rounded-xl border border-[#dbe7ea] bg-white px-3 py-2 text-[11px] font-semibold text-[#58727e] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#39bd82]" />production</div><button className="relative rounded-xl border border-[#dbe7ea] bg-white p-2.5 text-[#67808a] transition hover:border-[#a9cbd2] hover:text-[#158eb0]" data-testid="button-notifications"><Bell size={17} /><span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-[#e36f58]" /></button><button className="hidden rounded-xl border border-[#dbe8ec] bg-white p-2.5 text-[#67808a] hover:text-[#158eb0] sm:block" data-testid="button-help"><LifeBuoy size={17} /></button></div>
  </header>;
}

function Shell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className="noise min-h-[100dvh] bg-[#f4f8fa]"><Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} /><div className="min-h-[100dvh] md:pl-[248px]"><Header onMenu={() => setMenuOpen(true)} /><main className="mx-auto max-w-[1480px] p-5 sm:p-8">{children}</main></div></div>;
}

function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return <div className="mb-4 flex items-end justify-between"><div><div className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[.16em] text-[#79929c]">{eyebrow}</div><h2 className="text-[17px] font-extrabold tracking-[-.025em] text-[#183342]">{title}</h2></div>{action}</div>;
}

function StatCard({ label, value, detail, trend, icon: Icon, tone = 'blue' }: { label: string; value: string; detail: string; trend?: 'up' | 'down'; icon: typeof Activity; tone?: 'blue' | 'green' | 'amber' }) {
  const colors = { blue: 'bg-[#e4f5fa] text-[#1297bb]', green: 'bg-[#e5f6ee] text-[#279b68]', amber: 'bg-[#fdf3df] text-[#bd8427]' };
  return <div className="animate-rise rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)] transition-transform duration-200 hover:-translate-y-0.5"><div className="flex items-start justify-between"><div className="font-mono text-[10px] uppercase tracking-[.12em] text-[#80959d]">{label}</div><div className={`grid h-8 w-8 place-items-center rounded-lg ${colors[tone]}`}><Icon size={16} /></div></div><div className="mt-4 flex items-end gap-2"><div className="font-mono text-[25px] font-medium tracking-[-.07em] text-[#183342]">{value}</div>{trend && <div className={`mb-1 flex items-center gap-0.5 text-[10px] font-bold ${trend === 'up' ? 'text-[#279b68]' : 'text-[#dc745b]'}`}>{trend === 'up' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}8.6%</div>}</div><div className="mt-1 text-[11px] font-medium text-[#8ba0a7]">{detail}</div></div>;
}

function FleetRow({ bot, onDeploy, onSelect }: { bot: BotRecord; onDeploy: (id: string) => void; onSelect: (bot: BotRecord) => void }) {
  return <div className="group flex flex-col gap-3 border-b border-[#e8eff1] px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-bot-${bot.id}`}>
    <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => onSelect(bot)} data-testid={`button-select-bot-${bot.id}`}><BotAvatar bot={bot} size="sm" /><span className="min-w-0"><span className="flex items-center gap-2 text-[12px] font-extrabold text-[#294553]"><span className="truncate">{bot.name}</span><StatusDot status={bot.status} /></span><span className="mt-0.5 block truncate font-mono text-[10px] text-[#8499a2]">{bot.username}</span></span></button>
     <div className="flex items-center gap-5 pl-11 sm:pl-0"><div className="hidden text-right sm:block"><div className="font-mono text-[10px] text-[#526e79]">{bot.runtime}</div><div className="mt-0.5 text-[10px] text-[#9aabb1]">{bot.version}</div></div><span className={`min-w-[68px] text-center text-[10px] font-bold ${bot.status === 'online' ? 'text-[#2b9b6a]' : bot.status === 'deploying' ? 'text-[#bc8428]' : bot.status === 'error' ? 'text-[#c55f4d]' : 'text-[#8999a1]'}`}>{bot.status}</span><button onClick={() => onDeploy(bot.id)} className="rounded-lg border border-[#dce8ec] bg-[#fbfdfe] px-2.5 py-1.5 text-[10px] font-bold text-[#50707d] opacity-100 transition hover:border-[#8ecbd8] hover:text-[#138eaf] sm:opacity-0 sm:group-hover:opacity-100" data-testid={`button-deploy-${bot.id}`}><Rocket size={12} className="mr-1 inline" />Deploy</button><ChevronRight size={15} className="text-[#a4b3b8]" /></div>
  </div>;
}

function MiniBars() {
  const bars = [38, 49, 42, 63, 55, 72, 58, 78, 65, 82, 74, 88, 79, 92, 81, 86, 76, 94, 88, 97, 82, 91, 87, 96];
  return <div className="flex h-[82px] items-end gap-[3px]">{bars.map((height, i) => <div key={i} className={`flex-1 rounded-t-[3px] transition-all duration-500 hover:bg-[#17a6c8] ${i > 18 ? 'bg-[#26b477]' : 'bg-[#9fd9e5]'}`} style={{ height: `${height}%` }} />)}</div>;
}

function ActivityList() {
  const icons = { deploy: Rocket, check: ShieldCheck, terminal: Terminal, alert: AlertCircle };
  const tones = { blue: 'bg-[#e4f5fa] text-[#1395b9]', green: 'bg-[#e3f6ec] text-[#259966]', slate: 'bg-[#e9eef0] text-[#637c87]', red: 'bg-[#fbe9e4] text-[#d36650]', amber: 'bg-[#fdf3df] text-[#bd8427]' };
  if (!activityItems.length) return <div className="px-5 py-12 text-center"><Activity size={22} className="mx-auto text-[#a1b7bd]" /><div className="mt-3 text-[12px] font-bold text-[#486571]">No activity yet</div><div className="mt-1 text-[10px] text-[#8ca1a8]">Run a bot to start seeing workspace events.</div></div>;
  return <div className="divide-y divide-[#e8eff1]">{activityItems.map((item, i) => { const Icon = icons[item.type as keyof typeof icons]; return <div key={item.title} className="flex items-center gap-3.5 px-5 py-3.5" data-testid={`activity-item-${i}`}><div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tones[item.tone as keyof typeof tones]}`}><Icon size={15} /></div><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-bold text-[#35515e]">{item.title}</div><div className="mt-0.5 truncate font-mono text-[9px] text-[#92a4aa]">{item.detail}</div></div><div className="shrink-0 font-mono text-[9px] text-[#9aaab0]">{item.time}</div></div>; })}</div>;
}

function TerminalPanel({ bot, compact = false }: { bot: BotRecord; compact?: boolean }) {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<{ command: string; output: string }[]>([]);
  const submit = (event: FormEvent) => { event.preventDefault(); const trimmed = command.trim(); if (!trimmed) return; setHistory((items) => [...items, { command: trimmed, output: trimmed === 'clear' ? '' : `process completed · ${Math.floor(Math.random() * 80 + 12)}ms` }]); setCommand(''); };
  const displayLogs = bot.runtimeLogs?.length ? bot.runtimeLogs.map((text, i) => [`runtime-${i}`, text.includes('[error]') ? 'error' : 'info', text] as const) : logs;
  return <div className={`overflow-hidden rounded-2xl border border-[#163d4c] bg-[#102b38] shadow-[0_14px_30px_rgba(16,43,56,.12)] ${compact ? '' : 'min-h-[500px]'}`}><div className="flex items-center justify-between border-b border-white/10 bg-[#153746] px-4 py-3"><div className="flex items-center gap-2.5"><div className="flex gap-1.5"><span className="h-2 w-2 rounded-full bg-[#df7762]" /><span className="h-2 w-2 rounded-full bg-[#e1ae4a]" /><span className="h-2 w-2 rounded-full bg-[#42c58c]" /></div><span className="ml-1 font-mono text-[10px] text-[#8fb2ba]">{bot.name.toLowerCase().replaceAll(' ', '-')} <span className="text-[#4f7782]">/</span> bash</span></div><div className="flex items-center gap-1.5 font-mono text-[9px] text-[#6c9aa5]"><Wifi size={12} className="text-[#42c58c]" />{bot.status === 'online' ? 'connected' : bot.status === 'error' ? 'error' : 'offline'}</div></div><div className={`terminal-grid scrollbar-thin overflow-y-auto p-4 font-mono text-[10px] leading-6 text-[#a9c8cd] ${compact ? 'h-[194px]' : 'h-[380px]'}`}><div><span className="text-[#42c58c]">abhinav</span><span className="text-[#6f9ba5]">:</span><span className="text-[#55b7d2]">~</span><span className="text-[#91aeb5]">$ </span><span className="text-[#d8e9ea]">run {bot.entryFile}</span></div><div className="mb-3 mt-1 text-[#7699a2]">Connected to <span className="text-[#b6d9dd]">{bot.name}</span> · {bot.runtime} · region fra-1</div>{history.map((item, i) => <div key={`${item.command}-${i}`} className="mb-1"><div><span className="text-[#42c58c]">abhinav</span><span className="text-[#6f9ba5]">:</span><span className="text-[#55b7d2]">~</span><span className="text-[#91aeb5]">$ </span><span className="text-[#d8e9ea]">{item.command}</span></div>{item.output && <div className="pl-0.5 text-[#7fa2aa]">{item.output}</div>}</div>)}<div className="space-y-0.5">{displayLogs.slice(0, compact ? 4 : displayLogs.length).map(([time, level, text]) => <div key={time + text}><span className="text-[#557a84]">{time}</span><span className={`ml-3 ${level === 'ok' ? 'text-[#43c88d]' : level === 'warn' ? 'text-[#e2ad4a]' : level === 'error' ? 'text-[#df7762]' : 'text-[#9fc0c6]'}`}>[{level}]</span><span className="ml-3 text-[#94b4bb]">{text}</span></div>)}</div></div><form onSubmit={submit} className="flex items-center gap-2 border-t border-white/10 bg-[#0d2631] px-4 py-3"><span className="font-mono text-[10px] text-[#42c58c]">›</span><input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Run a command…" className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-[#d8e9ea] outline-none placeholder:text-[#5e818a]" data-testid="input-terminal-command" /><button type="submit" className="rounded-lg bg-[#1b91af] p-2 text-white transition hover:bg-[#22aac9]" data-testid="button-run-command"><Send size={13} /></button></form></div>;
}

function Overview({ bots, onDeploy, onSelect }: { bots: BotRecord[]; onDeploy: (id: string) => void; onSelect: (bot: BotRecord) => void }) {
  const [selectedId, setSelectedId] = useState('atlas');
  const selected = bots.find((bot) => bot.id === selectedId) ?? bots[0] ?? emptyBot;
  return <div className="space-y-7">
    <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.17em] text-[#3aa3b8]"><span className="h-1.5 w-1.5 rounded-full bg-[#3ac68b]" />Live workspace</div><h1 className="text-[29px] font-extrabold tracking-[-.055em] text-[#173443] sm:text-[34px]">Your fleet is <span className="text-[#1599bb]">steady.</span></h1><p className="mt-1 text-[12px] font-medium text-[#78909a]">Four bots · two environments · one clear view.</p></div><div className="flex gap-2"><Link href="/bots" className="flex items-center justify-center gap-2 rounded-xl border border-[#d6e4e8] bg-white px-3.5 py-2.5 text-[11px] font-bold text-[#4e6a76] transition hover:border-[#91c7d2] hover:text-[#108eaf]" data-testid="link-manage-bots"><Bot size={14} />Manage bots</Link><button onClick={() => onDeploy(selected.id)} className="flex items-center justify-center gap-2 rounded-xl bg-[#139bbd] px-3.5 py-2.5 text-[11px] font-bold text-white shadow-[0_5px_14px_rgba(19,155,189,.2)] transition hover:bg-[#0e87a6]" data-testid="button-deploy-selected"><Rocket size={14} />Deploy update</button></div></div>
     <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Hosted bots" value={String(bots.length).padStart(2, '0')} detail={bots.length ? `${bots.filter((bot) => bot.status === 'online').length} online` : 'Add your first bot'} icon={Bot} /><StatCard label="Requests today" value={bots.length ? '0' : '—'} detail={bots.length ? 'Across your bots' : 'Waiting for a bot'} icon={Activity} tone="green" /><StatCard label="Avg. response" value="—" detail="No runtime data yet" icon={Zap} tone="blue" /><StatCard label="Deployments" value="0" detail="This month" icon={UploadCloud} tone="amber" /></div>
    <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
       <div className="rounded-2xl border border-[#dce8ec] bg-white shadow-[var(--shadow-card)]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8eff1] px-5 py-4"><SectionHeading eyebrow="Fleet status" title="Hosted bots" action={null} /><button className="flex items-center gap-1.5 font-mono text-[10px] font-medium text-[#77919a] hover:text-[#138eae]" onClick={() => setSelectedId(bots[0]?.id ?? '')} data-testid="button-refresh-fleet"><RefreshCw size={12} />Refresh</button></div>{bots.length ? bots.map((bot) => <FleetRow key={bot.id} bot={bot} onDeploy={onDeploy} onSelect={(item) => { setSelectedId(item.id); onSelect(item); }} />) : <div className="px-5 py-12 text-center"><Bot size={24} className="mx-auto text-[#a1b7bd]" /><div className="mt-3 text-[13px] font-bold text-[#486571]">No bots hosted yet</div><div className="mt-1 text-[11px] text-[#8ca1a8]">Add a bot with its Telegram username and run file to get started.</div></div>}<Link href="/bots" className="flex items-center justify-center gap-1 border-t border-[#e8eff1] py-3.5 text-[10px] font-bold text-[#2097b5] hover:text-[#0b7898]" data-testid="link-view-all-bots">Manage bots <ChevronRight size={13} /></Link></div>
      <div className="rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="flex items-start justify-between"><div><div className="mb-1 font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Traffic pulse</div><div className="text-[17px] font-extrabold tracking-[-.025em] text-[#183342]">Requests today</div></div><div className="rounded-lg bg-[#e5f6ee] px-2 py-1 font-mono text-[10px] font-medium text-[#249467]">+8.6%</div></div><div className="mt-5"><MiniBars /></div><div className="mt-3 flex justify-between font-mono text-[9px] text-[#99a9ae]"><span>00:00</span><span>06:00</span><span>12:00</span><span>now</span></div><div className="mt-5 grid grid-cols-2 gap-3 border-t border-[#e8eff1] pt-4"><div><div className="font-mono text-[9px] uppercase tracking-wider text-[#9aabb1]">Peak hour</div><div className="mt-1 font-mono text-[13px] text-[#375765]">12:00–13:00</div></div><div><div className="font-mono text-[9px] uppercase tracking-wider text-[#9aabb1]">Peak volume</div><div className="mt-1 font-mono text-[13px] text-[#375765]">1,842 req</div></div></div></div>
    </div>
    <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
      <div className="rounded-2xl border border-[#dce8ec] bg-white shadow-[var(--shadow-card)]"><div className="border-b border-[#e8eff1] px-5 py-4"><SectionHeading eyebrow="Event stream" title="Recent activity" action={<button className="text-[#78929b] hover:text-[#158eaf]" data-testid="button-activity-filter"><ListFilter size={16} /></button>} /></div><ActivityList /><button className="flex w-full items-center justify-center gap-1 border-t border-[#e8eff1] py-3.5 text-[10px] font-bold text-[#2097b5]" data-testid="button-view-activity">View activity log <ChevronRight size={13} /></button></div>
       <div><div className="mb-4 flex items-center justify-between"><div><div className="mb-1 font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Live access</div><h2 className="text-[17px] font-extrabold tracking-[-.025em] text-[#183342]">Terminal</h2></div><Link href="/terminal" className="flex items-center gap-1 text-[10px] font-bold text-[#2097b5]" data-testid="link-open-terminal">Open full terminal <ExternalLink size={12} /></Link></div>{bots.length ? <TerminalPanel bot={selected} compact /> : <div className="grid min-h-[194px] place-items-center rounded-2xl border border-dashed border-[#cbdde1] bg-white text-center"><div><Terminal size={22} className="mx-auto text-[#a1b7bd]" /><div className="mt-2 text-[12px] font-bold text-[#486571]">Terminal will appear after you add a bot</div></div></div>}</div>
    </div>
  </div>;
}

function BotsPage({ bots, setBots, onDeploy, onToggle, onDelete, onSelect }: { bots: BotRecord[]; setBots: (bots: BotRecord[]) => void; onDeploy: (id: string) => void; onToggle: (id: string) => void; onDelete: (bot: BotRecord) => void; onSelect: (bot: BotRecord) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | BotRecord['status']>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newRuntime, setNewRuntime] = useState<'Python' | 'Java'>('Python');
  const [newEntryFile, setNewEntryFile] = useState('main.py');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newRequirementsFile, setNewRequirementsFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState('');
  const filtered = useMemo(() => bots.filter((bot) => (filter === 'all' || bot.status === filter) && `${bot.name} ${bot.username}`.toLowerCase().includes(query.toLowerCase())), [bots, filter, query]);
  const addBot = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    const username = newUsername.trim().replace(/^@/, '');
    const entryFile = newEntryFile.trim();
    if (!name || !username || !entryFile || !newFile) {
      setFormError('Display name, username, run file, and source file are required.');
      return;
    }
    if (newRuntime === 'Python' && !entryFile.endsWith('.py')) {
      setFormError('Python run files must end with .py.');
      return;
    }
    if (newRuntime === 'Java' && !entryFile.endsWith('.java')) {
      setFormError('Java run files must end with .java.');
      return;
    }
    if (newFile.name !== entryFile) {
      setFormError(`The selected source file must be named ${entryFile}.`);
      return;
    }
    if (newRequirementsFile && (newRuntime !== 'Python' || newRequirementsFile.name !== 'requirements.txt')) {
      setFormError('Dependencies file must be named requirements.txt and can only be used with Python.');
      return;
    }
    setUploading(true); setFormError('');
    let storedFile: { objectPath: string; fileName: string; fileSize: number };
    let storedRequirements: { objectPath: string; fileName: string; fileSize: number } | undefined;
    try {
      storedFile = await uploadBotFile(newFile);
      if (newRequirementsFile) storedRequirements = await uploadBotFile(newRequirementsFile);
    } catch (error) {
      setUploading(false);
      setFormError(error instanceof Error ? error.message : 'File upload failed.');
      return;
    }
    const initials = name.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase();
    const id = `bot-${Date.now()}`;
    const newBot: BotRecord = { id, name, username: `@${username}`, status: 'offline', runtime: newRuntime, entryFile, branch: 'main', version: 'v0.1.0', uptime: '—', cpu: '—', memory: '—', color: '#9b74d5', initials, requests: 0, ...storedFile, ...(storedRequirements ? { requirementsObjectPath: storedRequirements.objectPath, requirementsFileName: storedRequirements.fileName } : {}) };
    try {
      const savedBot = await saveBot(newBot);
      setBots([...bots, savedBot]);
    } catch (error) {
      setUploading(false);
      setFormError(error instanceof Error ? error.message : 'Could not save this bot.');
      return;
    }
    setNewName(''); setNewUsername(''); setNewRuntime('Python'); setNewEntryFile('main.py'); setNewFile(null); setNewRequirementsFile(null); setUploading(false); setShowAdd(false);
  };
  const deleteBot = (bot: BotRecord) => {
    if (window.confirm(`Delete ${bot.name}? This removes the bot from your workspace.`)) {
      void onDelete(bot);
    }
  };
  return <div className="space-y-7">
    <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 font-mono text-[10px] uppercase tracking-[.17em] text-[#79929c]">Workspace / fleet</div><h1 className="text-[29px] font-extrabold tracking-[-.055em] text-[#173443]">Hosted bots</h1><p className="mt-1 text-[12px] font-medium text-[#78909a]">Manage deployments, runtime health, and access.</p></div><button onClick={() => setShowAdd(true)} className="flex items-center justify-center gap-2 rounded-xl bg-[#139bbd] px-3.5 py-2.5 text-[11px] font-bold text-white shadow-[0_5px_14px_rgba(19,155,189,.2)] transition hover:bg-[#0e87a6]" data-testid="button-add-bot"><Plus size={15} />Add a bot</button></div>
     <div className="flex flex-col gap-3 rounded-2xl border border-[#dce8ec] bg-white p-3 shadow-[var(--shadow-card)] sm:flex-row"><div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9aadb4]" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search bots by name or username" className="h-10 w-full rounded-xl bg-[#f6f9fa] pl-9 pr-3 text-[12px] font-medium text-[#2d4d5a] outline-none ring-[#b3dce5] transition placeholder:text-[#a0b1b7] focus:ring-2" data-testid="input-search-bots" /></div><div className="flex items-center gap-1.5 overflow-x-auto">{(['all', 'online', 'deploying', 'offline', 'error'] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-[10px] font-bold capitalize transition ${filter === item ? 'bg-[#e2f4f8] text-[#128fac]' : 'text-[#78919b] hover:bg-[#f3f7f8]'}`} data-testid={`button-filter-${item}`}>{item === 'all' ? 'All bots' : item}</button>)}</div><button className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#e0eaed] text-[#78919b] hover:text-[#178fae]" data-testid="button-filter-options"><Filter size={15} /></button></div>
      <div className="grid gap-4 lg:grid-cols-2">{filtered.map((bot, i) => <div key={bot.id} className={`animate-rise delay-${Math.min(i + 1, 3)} group rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-[#b8d9e0]`} data-testid={`card-bot-${bot.id}`}><div className="flex items-start justify-between"><div className="flex items-center gap-3"><BotAvatar bot={bot} size="lg" /><div><div className="flex items-center gap-2 text-[14px] font-extrabold text-[#284653]">{bot.name}<StatusDot status={bot.status} /></div><div className="mt-1 font-mono text-[10px] text-[#899ca4]">{bot.username}</div></div></div><button onClick={() => deleteBot(bot)} className="rounded-lg p-1.5 text-[#c55f4d] hover:bg-[#fff2ef]" aria-label={`Delete ${bot.name}`} data-testid={`button-delete-${bot.id}`}><Trash2 size={17} /></button></div><div className="mt-5 grid grid-cols-2 gap-3 border-y border-[#edf1f2] py-3.5 sm:grid-cols-4"><div><div className="font-mono text-[9px] uppercase tracking-wider text-[#9aaab0]">Runtime</div><div className="mt-1 text-[11px] font-bold text-[#4d6975]">{bot.runtime}</div></div><div><div className="font-mono text-[9px] uppercase tracking-wider text-[#9aaab0]">Run file</div><div className="mt-1 truncate font-mono text-[10px] text-[#4d6975]">{bot.entryFile}</div></div><div><div className="font-mono text-[9px] uppercase tracking-wider text-[#9aaab0]">Dependencies</div><div className="mt-1 truncate font-mono text-[10px] text-[#4d6975]">{bot.requirementsFileName ?? 'None'}</div></div><div><div className="font-mono text-[9px] uppercase tracking-wider text-[#9aaab0]">Version</div><div className="mt-1 font-mono text-[11px] text-[#4d6975]">{bot.version}</div></div></div><div className="mt-4 flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-semibold text-[#8299a2]"><Server size={13} />{bot.status === 'online' ? `Up ${bot.uptime}` : bot.status === 'error' ? 'Start failed' : 'Not running'}</div><div className="flex flex-wrap justify-end gap-2"><button onClick={() => onToggle(bot.id)} className={`flex items-center gap-1 rounded-lg border px-3 py-2 text-[10px] font-bold ${bot.status === 'online' ? 'border-[#f1d9d1] text-[#c55f4d]' : 'border-[#ccebdc] text-[#278358]'}`} data-testid={`button-${bot.status === 'online' ? 'stop' : 'start'}-${bot.id}`}><Power size={12} />{bot.status === 'online' ? 'Stop' : 'Start'}</button><button onClick={() => onSelect(bot)} className="rounded-lg border border-[#dce8ec] px-3 py-2 text-[10px] font-bold text-[#587580] hover:border-[#a6d0d9] hover:text-[#148eac]" data-testid={`button-inspect-${bot.id}`}>Inspect</button><button onClick={() => onDeploy(bot.id)} className="rounded-lg bg-[#e3f5f8] px-3 py-2 text-[10px] font-bold text-[#128eac] hover:bg-[#d2edf2]" data-testid={`button-card-deploy-${bot.id}`}>Run file</button></div></div></div>)}</div>
    {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-[#cbdde1] bg-white py-16 text-center"><Search size={22} className="mx-auto text-[#a1b7bd]" /><div className="mt-3 text-[13px] font-bold text-[#486571]">No bots match that search</div><div className="mt-1 text-[11px] text-[#8ca1a8]">Try a different name or clear the filter.</div></div>}
      {showAdd && <div className="fixed inset-0 z-50 grid items-start overflow-y-auto bg-[#0e2938]/35 p-4 backdrop-blur-sm sm:items-center sm:p-5"><form onSubmit={addBot} className="my-2 max-h-[calc(100dvh-1rem)] w-full max-w-[470px] overflow-y-auto rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-2xl sm:my-0 sm:max-h-[calc(100dvh-2.5rem)] sm:p-6"><div className="flex items-start justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#79929c]">New service</div><h2 className="mt-1 text-[20px] font-extrabold text-[#173443]">Add a hosted bot</h2></div><button type="button" onClick={() => setShowAdd(false)} className="rounded-lg p-1 text-[#8ca2a9] hover:bg-[#f1f5f6]" data-testid="button-close-add-bot"><X size={18} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="block text-[11px] font-bold text-[#52707b] sm:col-span-2">Bot display name<input autoFocus required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Support Desk" className="mt-2 h-11 w-full rounded-xl border border-[#dce8ec] px-3 text-[12px] outline-none focus:border-[#54b9cc] focus:ring-2 focus:ring-[#d8f0f4]" data-testid="input-new-bot-name" /></label><label className="block text-[11px] font-bold text-[#52707b] sm:col-span-2">Telegram bot username<input required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="@your_bot_username" className="mt-2 h-11 w-full rounded-xl border border-[#dce8ec] px-3 text-[12px] outline-none focus:border-[#54b9cc] focus:ring-2 focus:ring-[#d8f0f4]" data-testid="input-new-bot-username" /></label><label className="block text-[11px] font-bold text-[#52707b]">Runtime<select value={newRuntime} onChange={(e) => { const runtime = e.target.value as 'Python' | 'Java'; setNewRuntime(runtime); setNewEntryFile(runtime === 'Python' ? 'main.py' : 'Main.java'); setNewRequirementsFile(null); }} className="mt-2 h-11 w-full rounded-xl border border-[#dce8ec] bg-white px-3 text-[12px] outline-none focus:border-[#54b9cc]" data-testid="select-new-bot-runtime"><option value="Python">Python</option><option value="Java">Java</option></select></label><label className="block text-[11px] font-bold text-[#52707b]">Run file<input required value={newEntryFile} onChange={(e) => setNewEntryFile(e.target.value)} placeholder={newRuntime === 'Python' ? 'main.py' : 'Main.java'} className="mt-2 h-11 w-full rounded-xl border border-[#dce8ec] px-3 text-[12px] outline-none focus:border-[#54b9cc] focus:ring-2 focus:ring-[#d8f0f4]" data-testid="input-new-bot-entry-file" /></label><label className="block text-[11px] font-bold text-[#52707b] sm:col-span-2">Source file<input required type="file" accept={newRuntime === 'Python' ? '.py,text/x-python' : '.java,text/x-java'} onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} className="mt-2 block w-full rounded-xl border border-dashed border-[#b8d9e0] bg-[#f7fbfc] px-3 py-3 text-[11px] text-[#52707b] file:mr-3 file:rounded-lg file:border-0 file:bg-[#e3f5f8] file:px-3 file:py-2 file:text-[10px] file:font-bold file:text-[#138eac]" data-testid="input-new-bot-source-file" />{newFile && <span className="mt-2 block font-mono text-[9px] text-[#2b9b6a]">{newFile.name} · {(newFile.size / 1024).toFixed(1)} KB</span>}</label>{newRuntime === 'Python' && <label className="block text-[11px] font-bold text-[#52707b] sm:col-span-2">requirements.txt <span className="font-normal text-[#8aa0a7]">(optional)</span><input type="file" accept=".txt,text/plain" onChange={(e) => setNewRequirementsFile(e.target.files?.[0] ?? null)} className="mt-2 block w-full rounded-xl border border-dashed border-[#b8d9e0] bg-[#f7fbfc] px-3 py-3 text-[11px] text-[#52707b] file:mr-3 file:rounded-lg file:border-0 file:bg-[#e3f5f8] file:px-3 file:py-2 file:text-[10px] file:font-bold file:text-[#138eac]" data-testid="input-new-bot-requirements-file" />{newRequirementsFile && <span className="mt-2 block font-mono text-[9px] text-[#2b9b6a]">{newRequirementsFile.name} · {(newRequirementsFile.size / 1024).toFixed(1)} KB</span>}</label>}</div>{formError && <div className="mt-4 rounded-xl border border-[#f1d9d1] bg-[#fff6f3] px-3 py-2 text-[10px] font-semibold text-[#c55f4d]" data-testid="add-bot-error">{formError}</div>}<p className="mt-4 rounded-xl bg-[#f4f9fa] px-3 py-2 text-[10px] leading-4 text-[#78909a]">The source file uploads to private App Storage. If provided, requirements.txt is installed before the Python bot starts.</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowAdd(false)} className="rounded-xl px-4 py-2.5 text-[11px] font-bold text-[#667f89] hover:bg-[#f4f7f8]" data-testid="button-cancel-add-bot">Cancel</button><button type="submit" disabled={uploading} className="rounded-xl bg-[#139bbd] px-4 py-2.5 text-[11px] font-bold text-white hover:bg-[#0e87a6] disabled:cursor-wait disabled:opacity-60" data-testid="button-confirm-add-bot">{uploading ? 'Uploading…' : 'Add bot'}</button></div></form></div>}
  </div>;
}

function TerminalPage({ bots }: { bots: BotRecord[] }) {
  const [selectedId, setSelectedId] = useState('atlas');
  const bot = bots.find((item) => item.id === selectedId) ?? bots[0];
  const [tab, setTab] = useState<'terminal' | 'logs'>('terminal');
  if (!bots.length) return <div className="mx-auto max-w-[620px] rounded-2xl border border-dashed border-[#cbdde1] bg-white px-6 py-16 text-center shadow-[var(--shadow-card)]"><Terminal size={26} className="mx-auto text-[#a1b7bd]" /><h1 className="mt-4 text-[20px] font-extrabold text-[#173443]">No bot runtime yet</h1><p className="mt-2 text-[12px] leading-5 text-[#78909a]">Add a bot with its username, runtime, and entry file before opening the terminal.</p><Link href="/bots" className="mt-6 inline-flex rounded-xl bg-[#139bbd] px-4 py-2.5 text-[11px] font-bold text-white">Add your first bot</Link></div>;
  const activeBot = bot ?? emptyBot;
  return <div className="space-y-7">
    <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.17em] text-[#3aa3b8]"><span className="h-1.5 w-1.5 rounded-full bg-[#3ac68b]" />Secure session</div><h1 className="text-[29px] font-extrabold tracking-[-.055em] text-[#173443]">Terminal workspace</h1><p className="mt-1 text-[12px] font-medium text-[#78909a]">Run commands against a live bot environment.</p></div><div className="flex items-center gap-2 rounded-xl border border-[#dce8ec] bg-white px-3 py-2 text-[10px] font-bold text-[#4e6c77]"><ShieldCheck size={14} className="text-[#2bb57d]" />Session encrypted</div></div>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-[#dce8ec] bg-white p-1.5 shadow-[var(--shadow-card)]">{bots.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[10px] font-bold transition ${selectedId === item.id ? 'bg-[#e4f5f8] text-[#138fac]' : 'text-[#718992] hover:bg-[#f4f7f8]'}`} data-testid={`button-terminal-bot-${item.id}`}><StatusDot status={item.status} />{item.name}</button>)}</div><div className="flex items-center gap-2"><button onClick={() => setTab('terminal')} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${tab === 'terminal' ? 'bg-[#173d4d] text-white' : 'text-[#6f8993]'}`} data-testid="button-tab-terminal"><Terminal size={13} className="mr-1 inline" />Terminal</button><button onClick={() => setTab('logs')} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${tab === 'logs' ? 'bg-[#173d4d] text-white' : 'text-[#6f8993]'}`} data-testid="button-tab-logs"><FileCode2 size={13} className="mr-1 inline" />Logs</button></div></div>
      {tab === 'terminal' ? <div className="grid gap-5 xl:grid-cols-[1fr_290px]"><TerminalPanel bot={activeBot} /><aside className="space-y-4"><div className="rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="mb-4 flex items-center justify-between"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Environment</div><button className="text-[#849da5]" data-testid="button-environment-menu"><MoreHorizontal size={15} /></button></div><div className="flex items-center gap-3"><BotAvatar bot={activeBot} size="sm" /><div><div className="text-[12px] font-extrabold text-[#345360]">{activeBot.name}</div><div className="mt-0.5 font-mono text-[9px] text-[#8da1a8]">fra-1 · production</div></div></div><div className="mt-5 space-y-3">{[['Runtime', activeBot.runtime, Cpu], ['Run file', activeBot.entryFile, FileCode2], ['Dependencies', activeBot.requirementsFileName ?? 'None', Package], ['Memory', activeBot.memory, HardDrive], ['Version', activeBot.version, Package]].map(([label, value, Icon]) => <div key={label as string} className="flex items-center justify-between"><span className="flex items-center gap-2 text-[10px] font-semibold text-[#81969e]">{(() => { const C = Icon as typeof Cpu; return <C size={13} />; })()}{label as string}</span><span className="max-w-[150px] truncate font-mono text-[10px] text-[#4c6a76]">{value as string}</span></div>)}</div></div><div className="rounded-2xl border border-[#dce8ec] bg-[#eef8fa] p-5"><div className="flex items-center gap-2 text-[11px] font-extrabold text-[#2a6878]"><LifeBuoy size={14} />Quick commands</div><div className="mt-3 space-y-1.5">{[activeBot.runtime === 'Python' ? `python ${activeBot.entryFile}` : `java ${activeBot.entryFile.replace(/\.java$/, '')}`, 'health check', 'git status'].map((cmd) => <button key={cmd} onClick={() => navigator.clipboard?.writeText(cmd)} className="flex w-full items-center justify-between rounded-lg bg-white/75 px-3 py-2 text-left font-mono text-[10px] text-[#4a7782] transition hover:bg-white" data-testid={`button-copy-${cmd.replaceAll(' ', '-')}`}><span>{cmd}</span><Copy size={11} /></button>)}</div></div></aside></div> : <LogViewer bot={activeBot} />}
  </div>;
}

function LogViewer({ bot }: { bot: BotRecord }) {
  const displayLogs = bot.runtimeLogs?.length ? bot.runtimeLogs.map((text, i) => [`runtime-${i}`, text.includes('[error]') ? 'error' : 'info', text] as const) : logs.concat(logs);
  return <div className="overflow-hidden rounded-2xl border border-[#163d4c] bg-[#102b38] shadow-[0_14px_30px_rgba(16,43,56,.12)]"><div className="flex items-center justify-between border-b border-white/10 bg-[#153746] px-5 py-3.5"><div className="flex items-center gap-2 font-mono text-[10px] text-[#c2dfe3]"><Activity size={14} className="text-[#42c58c]" />stream / production.log</div><button className="flex items-center gap-1.5 font-mono text-[9px] text-[#8fb2ba]" data-testid="button-pause-logs"><SquareTerminal size={12} />Pause stream</button></div><div className="terminal-grid scrollbar-thin h-[520px] overflow-y-auto p-5 font-mono text-[10px] leading-7">{displayLogs.map(([time, level, text], i) => <div key={`${time}-${i}`}><span className="text-[#557a84]">{time}</span><span className={`ml-5 ${level === 'ok' ? 'text-[#43c88d]' : level === 'warn' ? 'text-[#e2ad4a]' : level === 'error' ? 'text-[#df7762]' : 'text-[#9fc0c6]'}`}>[{level}]</span><span className="ml-5 text-[#94b4bb]">{text}</span></div>)}</div></div>;
}

function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [health, setHealth] = useState(true);
  const [retention, setRetention] = useState('14');
  const save = () => { setSaved(true); window.setTimeout(() => setSaved(false), 2200); };
  return <div className="max-w-[920px] space-y-7">
    <div className="animate-rise"><div className="mb-2 font-mono text-[10px] uppercase tracking-[.17em] text-[#79929c]">Workspace / system</div><h1 className="text-[29px] font-extrabold tracking-[-.055em] text-[#173443]">Settings</h1><p className="mt-1 text-[12px] font-medium text-[#78909a]">Small controls for a predictable operation.</p></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_290px]"><div className="space-y-5"><SettingsBlock eyebrow="Deployments" title="Deployment behavior"><ToggleRow title="Automatic deployments" description="Deploy pushes to the production branch automatically." checked={autoDeploy} onChange={() => setAutoDeploy(!autoDeploy)} testId="toggle-auto-deploy" /><ToggleRow title="Health checks after deploy" description="Verify the webhook responds before marking a release healthy." checked={health} onChange={() => setHealth(!health)} testId="toggle-health-checks" /></SettingsBlock><SettingsBlock eyebrow="Observability" title="Log retention"><div className="flex items-center justify-between gap-4"><div><div className="text-[12px] font-bold text-[#385764]">Keep application logs for</div><div className="mt-1 text-[10px] text-[#879da5]">Longer retention uses more workspace storage.</div></div><div className="relative"><select value={retention} onChange={(e) => setRetention(e.target.value)} className="h-10 appearance-none rounded-xl border border-[#dbe7ea] bg-[#fbfdfe] pl-3 pr-9 text-[11px] font-bold text-[#55717c] outline-none focus:border-[#55b9cb]" data-testid="select-log-retention"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="90">90 days</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-[#839ba3]" /></div></div></SettingsBlock><SettingsBlock eyebrow="Access" title="API access"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="text-[12px] font-bold text-[#385764]">Workspace API key</div><div className="mt-1 font-mono text-[10px] text-[#8ba0a7]">sr_live_••••••••••••4c2f</div></div><button className="rounded-lg border border-[#dce8ec] px-3 py-2 text-[10px] font-bold text-[#587580] hover:border-[#a6d0d9]" data-testid="button-regenerate-key">Regenerate key</button></div></SettingsBlock><div className="flex justify-end"><button onClick={save} className="flex items-center gap-2 rounded-xl bg-[#139bbd] px-4 py-2.5 text-[11px] font-bold text-white shadow-[0_5px_14px_rgba(19,155,189,.2)] hover:bg-[#0e87a6]" data-testid="button-save-settings">{saved ? <Check size={14} /> : null}{saved ? 'Saved' : 'Save changes'}</button></div></div><div className="h-fit rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="mb-1 font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Usage this month</div><div className="mt-2 text-[25px] font-extrabold tracking-[-.05em] text-[#183342]">4.2 GB</div><div className="mt-1 text-[10px] text-[#8aa0a7]">of 10 GB workspace storage</div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e6eff1]"><div className="h-full w-[42%] rounded-full bg-[#27b67d]" /></div><div className="mt-5 space-y-3 border-t border-[#e8eff1] pt-4"><UsageRow icon={Database} label="Build artifacts" value="2.8 GB" /><UsageRow icon={FileCode2} label="Application logs" value="1.1 GB" /><UsageRow icon={HardDrive} label="Cache" value="0.3 GB" /></div></div></div>
  </div>;
}

function SettingsBlock({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="mb-5"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">{eyebrow}</div><h2 className="mt-1 text-[15px] font-extrabold text-[#284754]">{title}</h2></div><div className="space-y-4">{children}</div></section>;
}

function ToggleRow({ title, description, checked, onChange, testId }: { title: string; description: string; checked: boolean; onChange: () => void; testId: string }) {
  return <div className="flex items-center justify-between gap-4"><div><div className="text-[12px] font-bold text-[#385764]">{title}</div><div className="mt-1 max-w-[480px] text-[10px] leading-4 text-[#879da5]">{description}</div></div><button role="switch" aria-checked={checked} onClick={onChange} className={`relative h-6 w-11 shrink-0 rounded-full p-1 transition-colors ${checked ? 'bg-[#1cad79]' : 'bg-[#cddadd]'}`} data-testid={testId}><span className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} /></button></div>;
}

function UsageRow({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return <div className="flex items-center justify-between text-[10px]"><span className="flex items-center gap-2 font-semibold text-[#78919a]"><Icon size={13} />{label}</span><span className="font-mono text-[#526f7a]">{value}</span></div>;
}

function AdminPage({ bots, onDeploy, maintenanceMode, setMaintenanceMode }: { bots: BotRecord[]; onDeploy: (id: string) => void; maintenanceMode: boolean; setMaintenanceMode: (value: boolean) => void }) {
  const { user } = useUser();
  const [hostingPaused, setHostingPaused] = useState(false);
  const [bannedUsers, setBannedUsers] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const isAdmin = hasAdminAccess(user);
  const users = [
    { id: 'usr_01', name: 'Maya Chen', email: 'maya@example.com', plan: 'Trial', status: 'Active' },
    { id: 'usr_02', name: 'Dev Patel', email: 'dev@example.com', plan: 'Pro', status: 'Active' },
    { id: 'usr_03', name: 'Jordan Lee', email: 'jordan@example.com', plan: 'Trial', status: 'Active' },
  ];
  const ban = (id: string) => {
    setBannedUsers((items) => items.includes(id) ? items : [...items, id]);
    setNotice('User permanently banned from Abhinav Hosting.');
    window.setTimeout(() => setNotice(''), 2600);
  };
  if (!isAdmin) return <div className="mx-auto max-w-[620px] rounded-2xl border border-[#f1d9d1] bg-white p-8 text-center shadow-[var(--shadow-card)]"><ShieldCheck size={28} className="mx-auto text-[#d66c54]" /><h1 className="mt-4 text-[22px] font-extrabold text-[#173443]">Admin access required</h1><p className="mt-2 text-[12px] leading-5 text-[#78909a]">This area is reserved for authorized administrator accounts. Sign in with the administrator email to continue.</p></div>;
  return <div className="space-y-7">
    <div className="animate-rise flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.17em] text-[#3aa3b8]"><span className="h-1.5 w-1.5 rounded-full bg-[#d66c54]" />Administrator workspace</div><h1 className="text-[29px] font-extrabold tracking-[-.055em] text-[#173443]">Control center</h1><p className="mt-1 text-[12px] font-medium text-[#78909a]">Manage hosting availability, deployments, and account access.</p></div><div className="flex items-center gap-2 rounded-xl border border-[#dce8ec] bg-white px-3 py-2 text-[10px] font-bold text-[#4e6c77]"><ShieldCheck size={14} className="text-[#2bb57d]" />Admin verified</div></div>
    {notice && <div className="rounded-xl border border-[#bfe7d4] bg-[#effaf4] px-4 py-3 text-[11px] font-bold text-[#278358]" data-testid="admin-notice">{notice}</div>}
    <div className="grid gap-5 lg:grid-cols-3"><div className="rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Accounts</div><div className="mt-3 font-mono text-[26px] text-[#183342]">128</div><div className="mt-1 text-[10px] text-[#8aa0a7]">registered workspaces</div></div><div className="rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Active bots</div><div className="mt-3 font-mono text-[26px] text-[#183342]">{bots.filter((bot) => bot.status === 'online').length + 31}</div><div className="mt-1 text-[10px] text-[#8aa0a7]">currently running</div></div><div className="rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Trial accounts</div><div className="mt-3 font-mono text-[26px] text-[#183342]">42</div><div className="mt-1 text-[10px] text-[#8aa0a7]">within their first month</div></div></div>
     <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]"><section className="rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="mb-5"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Platform controls</div><h2 className="mt-1 text-[15px] font-extrabold text-[#284754]">Hosting operations</h2></div><div className="space-y-4"><ToggleRow title="Website maintenance mode" description="Show a maintenance banner and pause new activity while you work on the service." checked={maintenanceMode} onChange={() => { setMaintenanceMode(!maintenanceMode); setNotice(!maintenanceMode ? 'Maintenance mode enabled.' : 'Maintenance mode disabled.'); }} testId="toggle-website-maintenance" /><ToggleRow title="Accept new deployments" description="Pause all new deploy jobs while keeping existing bots running." checked={!hostingPaused} onChange={() => setHostingPaused(!hostingPaused)} testId="toggle-hosting-availability" /><div className="flex items-center justify-between border-t border-[#edf1f2] pt-4"><div><div className="text-[12px] font-bold text-[#385764]">Emergency bot stop</div><div className="mt-1 text-[10px] text-[#879da5]">Stop every hosted bot immediately.</div></div><button onClick={() => { bots.forEach((bot) => onDeploy(bot.id)); setNotice('Emergency stop request sent to all hosted bots.'); }} className="rounded-lg border border-[#f1d9d1] px-3 py-2 text-[10px] font-bold text-[#c55f4d] hover:bg-[#fff5f1]" data-testid="button-emergency-stop">Stop all bots</button></div></div></section><section className="rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="mb-5"><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Fleet actions</div><h2 className="mt-1 text-[15px] font-extrabold text-[#284754]">Deployments</h2></div><div className="space-y-2">{bots.length ? bots.map((bot) => <div key={bot.id} className="flex items-center justify-between rounded-xl bg-[#f6f9fa] px-3.5 py-3"><div className="flex items-center gap-2.5"><BotAvatar bot={bot} size="sm" /><div><div className="text-[11px] font-bold text-[#385764]">{bot.name}</div><div className="font-mono text-[9px] text-[#8aa0a7]">{bot.status} · {bot.entryFile}</div></div></div><button onClick={() => onDeploy(bot.id)} className="rounded-lg bg-[#e3f5f8] px-3 py-2 text-[10px] font-bold text-[#128eac]" data-testid={`button-admin-deploy-${bot.id}`}>Run file</button></div>) : <div className="rounded-xl border border-dashed border-[#cbdde1] px-4 py-8 text-center text-[11px] text-[#8aa0a7]">No bots added yet.</div>}</div></section></div>
    <section className="rounded-2xl border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="mb-5 flex items-end justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.15em] text-[#79929c]">Account safety</div><h2 className="mt-1 text-[15px] font-extrabold text-[#284754]">User access</h2></div><div className="font-mono text-[10px] text-[#8aa0a7]">Permanent bans</div></div><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left"><thead><tr className="border-b border-[#e8eff1] font-mono text-[9px] uppercase tracking-wider text-[#92a4aa]"><th className="pb-3">User</th><th className="pb-3">Plan</th><th className="pb-3">Status</th><th className="pb-3 text-right">Action</th></tr></thead><tbody>{users.map((item) => { const banned = bannedUsers.includes(item.id); return <tr key={item.id} className="border-b border-[#edf1f2] last:border-0"><td className="py-3"><div className="text-[11px] font-bold text-[#385764]">{item.name}</div><div className="font-mono text-[9px] text-[#8aa0a7]">{item.email}</div></td><td className="py-3 text-[10px] font-bold text-[#67808a]">{item.plan}</td><td className={`py-3 text-[10px] font-bold ${banned ? 'text-[#c55f4d]' : 'text-[#2b9b6a]'}`}>{banned ? 'Permanently banned' : item.status}</td><td className="py-3 text-right">{banned ? <span className="font-mono text-[9px] text-[#a3b0b4]">blocked</span> : <button onClick={() => ban(item.id)} className="rounded-lg border border-[#f1d9d1] px-3 py-2 text-[10px] font-bold text-[#c55f4d] hover:bg-[#fff5f1]" data-testid={`button-ban-${item.id}`}>Ban permanently</button>}</td></tr>; })}</tbody></table></div></section>
  </div>;
}

function AppContent() {
  const { user } = useUser();
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [loadingBots, setLoadingBots] = useState(true);
  const [botLoadError, setBotLoadError] = useState('');
  const [selectedBot, setSelectedBot] = useState<BotRecord | null>(null);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoadingBots(true);
    setBotLoadError('');
    void fetchSavedBots().then((savedBots) => {
      if (!cancelled) setBots(savedBots);
    }).catch((error) => {
      if (!cancelled) setBotLoadError(error instanceof Error ? error.message : 'Could not load saved bots.');
    }).finally(() => {
      if (!cancelled) setLoadingBots(false);
    });
    return () => { cancelled = true; };
  }, [user?.id]);
  const updateBot = (id: string, patch: Partial<BotRecord>) => setBots((items) => items.map((bot) => bot.id === id ? { ...bot, ...patch } : bot));
  const deploy = async (id: string) => {
    const bot = bots.find((item) => item.id === id);
    if (!bot) return;
    updateBot(id, { status: 'deploying', runtimeLogs: ['starting bot…'] });
    try {
      const result = await runHostedBot(bot);
      updateBot(id, { status: result.status === 'online' ? 'online' : 'error', runtimeLogs: result.logs ?? [] });
      window.setTimeout(async () => {
        const response = await fetch(`/api/bots/${encodeURIComponent(id)}/runtime`);
        const current = await readApiBody(response);
        if (response.ok) updateBot(id, { status: current.status === 'online' ? 'online' : current.status === 'error' ? 'error' : 'offline', runtimeLogs: current.logs ?? [] });
      }, 900);
    } catch (error) {
      updateBot(id, { status: 'error', runtimeLogs: [`[error] ${error instanceof Error ? error.message : 'The bot could not start.'}`] });
    }
  };
  const toggleBot = async (id: string) => {
    const bot = bots.find((item) => item.id === id);
    if (!bot) return;
    if (bot.status !== 'online') { void deploy(id); return; }
    try {
      const result = await stopHostedBot(id);
      updateBot(id, { status: 'offline', runtimeLogs: result.logs ?? bot.runtimeLogs });
    } catch (error) {
      updateBot(id, { status: 'error', runtimeLogs: [...(bot.runtimeLogs ?? []), `[error] ${error instanceof Error ? error.message : 'The bot could not be stopped.'}`] });
    }
  };
  const deleteBot = async (bot: BotRecord) => {
    try {
      await deleteSavedBot(bot);
      setBots((items) => items.filter((item) => item.id !== bot.id));
      setSelectedBot((item) => item?.id === bot.id ? null : item);
    } catch (error) {
      setBotLoadError(error instanceof Error ? error.message : 'Could not delete this bot.');
    }
  };
  if (loadingBots) return <Shell><div className="mx-auto max-w-[620px] rounded-2xl border border-[#dce8ec] bg-white px-6 py-16 text-center shadow-[var(--shadow-card)]"><RefreshCw size={24} className="mx-auto animate-spin text-[#1599bb]" /><div className="mt-3 text-[12px] font-bold text-[#486571]">Loading your saved bots…</div></div></Shell>;
  return <Shell>{botLoadError && <div className="mb-5 flex items-center gap-2 rounded-xl border border-[#f1d9d1] bg-[#fff6f3] px-4 py-3 text-[11px] font-bold text-[#c55f4d]" data-testid="bot-data-error"><AlertCircle size={15} />{botLoadError}</div>}{maintenanceMode && <div className="mb-5 flex items-center gap-2 rounded-xl border border-[#f3dcae] bg-[#fff8e8] px-4 py-3 text-[11px] font-bold text-[#9b7228]"><AlertCircle size={15} />Website is in maintenance mode. New activity may be paused.</div>}<Switch><Route path="/"><Overview bots={bots} onDeploy={deploy} onSelect={setSelectedBot} /></Route><Route path="/bots"><BotsPage bots={bots} setBots={setBots} onDeploy={deploy} onToggle={toggleBot} onDelete={deleteBot} onSelect={setSelectedBot} /></Route><Route path="/terminal"><TerminalPage bots={bots} /></Route><Route path="/settings"><SettingsPage /></Route><Route path="/admin"><AdminPage bots={bots} onDeploy={deploy} maintenanceMode={maintenanceMode} setMaintenanceMode={setMaintenanceMode} /></Route><Route component={NotFound} /></Switch>{selectedBot && <div className="fixed inset-0 z-50 grid place-items-center bg-[#0e2938]/35 p-5 backdrop-blur-sm"><div className="w-full max-w-[470px] rounded-2xl border border-[#dce8ec] bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div className="flex items-center gap-3"><BotAvatar bot={selectedBot} /><div><h2 className="text-[17px] font-extrabold text-[#213f4d]">{selectedBot.name}</h2><div className="mt-1 font-mono text-[10px] text-[#8aa0a7]">{selectedBot.username}</div></div></div><button onClick={() => setSelectedBot(null)} className="rounded-lg p-1 text-[#8ca2a9] hover:bg-[#f1f5f6]" data-testid="button-close-bot-detail"><X size={18} /></button></div><div className="mt-6 grid grid-cols-2 gap-3">{[['Status', selectedBot.status], ['Runtime', selectedBot.runtime], ['Run file', selectedBot.entryFile], ['Version', selectedBot.version]].map(([label, value]) => <div key={label} className="rounded-xl bg-[#f5f9fa] p-3"><div className="font-mono text-[9px] uppercase tracking-wider text-[#8da1a8]">{label}</div><div className="mt-1 text-[12px] font-bold text-[#456572]">{value}</div></div>)}</div><div className="mt-5 flex justify-end"><Link href="/terminal" onClick={() => setSelectedBot(null)} className="flex items-center gap-2 rounded-xl bg-[#e3f5f8] px-3.5 py-2.5 text-[10px] font-bold text-[#138eac]" data-testid="link-detail-terminal"><Terminal size={13} />Open terminal</Link></div></div></div>}</Shell>;
}

function PublicLanding() {
  return <div className="min-h-[100dvh] bg-[#f4f8fa] px-5 py-6 sm:px-10"><header className="mx-auto flex max-w-[1180px] items-center justify-between"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#22acd0] text-[#082b3c]"><Command size={19} strokeWidth={2.5} /></div><div><div className="font-extrabold tracking-[-.03em] text-[#173443]">Abhinav <span className="text-[#1599bb]">Hosting</span></div><div className="font-mono text-[9px] uppercase tracking-[.19em] text-[#79929c]">telegram bot operations</div></div></div><div className="flex gap-2"><Link href="/sign-in" className="rounded-xl border border-[#d6e4e8] bg-white px-4 py-2.5 text-[11px] font-bold text-[#4e6a76]">Sign in</Link><Link href="/sign-up" className="rounded-xl bg-[#139bbd] px-4 py-2.5 text-[11px] font-bold text-white">Create account</Link></div></header><main className="mx-auto grid max-w-[1180px] items-center gap-12 py-20 lg:grid-cols-[1.05fr_.95fr]"><div><div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#e4f5fa] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#158eaf]"><span className="h-1.5 w-1.5 rounded-full bg-[#38ca8b]" />1 month free trial</div><h1 className="max-w-[700px] text-[47px] font-extrabold leading-[1.02] tracking-[-.065em] text-[#173443] sm:text-[68px]">Host Telegram bots with <span className="text-[#1599bb]">clarity.</span></h1><p className="mt-6 max-w-[520px] text-[15px] leading-7 text-[#78909a]">Deploy, inspect logs, and open a secure terminal for every bot from one focused workspace.</p><div className="mt-8 flex flex-wrap gap-3"><Link href="/sign-up" className="rounded-xl bg-[#139bbd] px-5 py-3 text-[12px] font-bold text-white shadow-[0_8px_22px_rgba(19,155,189,.2)]">Start your free month</Link><Link href="/sign-in" className="rounded-xl border border-[#d6e4e8] bg-white px-5 py-3 text-[12px] font-bold text-[#4e6a76]">Open dashboard</Link></div></div><div className="rounded-[24px] border border-[#dce8ec] bg-white p-5 shadow-[var(--shadow-card)]"><div className="rounded-2xl bg-[#102b38] p-5 font-mono text-[11px] leading-7 text-[#9fc0c6]"><div><span className="text-[#42c58c]">abhinav</span><span className="text-[#55b7d2]">@hosting</span><span className="text-[#91aeb5]">:~$ </span><span className="text-[#d8e9ea]">status --all</span></div><div className="text-[#7fa2aa]">workspace ready · waiting for your first bot</div><div className="text-[#43c88d]">0 bots online · all systems nominal</div></div></div></main></div>;
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#f4f8fa] px-4"><div className="rounded-xl border border-[#dce8ec] bg-white px-4 py-2 text-center text-[11px] font-semibold text-[#5f7b85]">Your login session is saved automatically on this device.</div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[#f4f8fa] px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function HomeRedirect() {
  return <><Show when="signed-in"><AppContent /></Show><Show when="signed-out"><PublicLanding /></Show></>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} localization={{ signIn: { start: { title: 'Welcome back to Abhinav Hosting', subtitle: 'Sign in to manage your Telegram bots' } }, signUp: { start: { title: 'Create your Abhinav Hosting account', subtitle: 'Your first month is free' } } }} appearance={{ theme: shadcn, variables: { colorPrimary: '#139bbd', colorForeground: '#173443', colorMutedForeground: '#78909a', colorBackground: '#ffffff', colorInput: '#f6f9fa', colorInputForeground: '#173443', colorNeutral: '#dce8ec', colorDanger: '#c55f4d', fontFamily: 'Manrope, sans-serif', borderRadius: '0.8rem' }, options: { logoImageUrl: `${window.location.origin}${basePath}/logo.svg`, logoLinkUrl: basePath || '/' } }} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} routerPush={(to) => setLocation(to.replace(basePath, '') || '/')} routerReplace={(to) => setLocation(to.replace(basePath, '') || '/') }><Switch><Route path="/" component={HomeRedirect} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route component={HomeRedirect} /></Switch></ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><QueryClientProvider client={queryClient}><TooltipProvider><ErrorBoundary><ClerkRoutes /></ErrorBoundary><Toaster /></TooltipProvider></QueryClientProvider></WouterRouter>;
}

export default App;