"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Inbox, Link2, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { WorkspaceData } from './workspace-types';
import type { WorkItem } from '@/lib/work-items';
import { activeReminders, defaultInboxQuery, groupWork, localWorkDay, reminderResumeAt, selectWork, workKindLabels, type InboxQuery } from '@/lib/work-inbox';
import { TaskRows, usePersonalPreferences } from './business-workspace';

const views = [['all', 'All assigned'], ['ready', 'Ready'], ['reviews', 'Reviews'], ['planning', 'Planning'], ['waiting', 'Waiting'], ['snoozed', 'Snoozed']] as const;
const viewLabels = Object.fromEntries(views);
export function WorkInbox({ data, onOpen, query, onQueryChange, onCopyLink }: {
  data: WorkspaceData; onOpen: (i: WorkItem) => void; query: InboxQuery; onQueryChange: (q: InboxQuery) => void; onCopyLink: () => void;
}) {
  const [items, setItems] = useState<WorkItem[]>([]), [page, setPage] = useState<number | null>(0), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(0), [updated, setUpdated] = useState<Date | null>(null), [reminderBusy, setReminderBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false), [limit, setLimit] = useState(40), [now, setNow] = useState(() => Date.now());
  useEffect(() => { const tick = () => setNow(Date.now()); const timer = window.setInterval(tick, 60000); window.addEventListener('focus', tick); return () => { window.clearInterval(timer); window.removeEventListener('focus', tick); }; }, []);
  const request = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const pref = usePersonalPreferences(data.tenantId), prefRef = useRef(pref); prefRef.current = pref;
  const operation = useRef(false);
  const q = query.scope === 'team' && data.identity.role !== 'Lead Auditor' ? { ...query, scope: 'mine' as const } : query;
  const change = (patch: Partial<InboxQuery>) => { setLimit(40); onQueryChange({ ...q, ...patch }); };
  const reset = () => { setLimit(40); onQueryChange({ ...defaultInboxQuery, scope: q.scope, view: q.view }); };
  const load = useCallback(async (p = 0) => {
    request.current.controller?.abort(); const controller = new AbortController(), generation = ++request.current.generation;
    request.current.controller = controller; setBusy(true);
    try {
      const response = await fetch('/api/work-inbox?' + new URLSearchParams({ tenantId: data.tenantId, page: String(p) }), { cache: 'no-store', signal: controller.signal });
      const value = await response.json() as { error?: string; items: WorkItem[]; nextPage: number | null; loadedEngagements: number };
      if (!response.ok) throw Error(value.error || 'Work could not be loaded. Retry to refresh your assignments.');
      if (generation !== request.current.generation) return;
      setItems(old => p ? [...new Map([...old, ...value.items].map(i => [i.id, i])).values()] : value.items);
      setLoaded(old => p ? old + value.loadedEngagements : value.loadedEngagements); setPage(value.nextPage); setUpdated(new Date()); setError('');
    } catch (e) { if (!controller.signal.aborted && generation === request.current.generation) setError(e instanceof Error ? e.message : 'Work unavailable. Retry to load assignments.'); }
    finally { if (generation === request.current.generation) setBusy(false); }
  }, [data.tenantId, data.identity.id, data.identity.role]);
  useEffect(() => { setItems([]); setLoaded(0); setPage(0); setUpdated(null); setLimit(40); void load(); return () => { request.current.generation++; request.current.controller?.abort(); }; }, [load]);
  useEffect(() => setLimit(40), [q.view, q.scope, q.search, q.kind, q.due, q.engagementId, q.sort]);
  const today = localWorkDay(new Date(now)), reminders = activeReminders(pref.value.snoozed, now);
  const visible = selectWork(items, q, reminders, today, pref.value.reminderDays);
  const count = (view: InboxQuery['view']) => selectWork(items, { ...q, view, search: '', due: 'any', kind: 'all', engagementId: '' }, reminders, today, pref.value.reminderDays).length;
  const overdue = selectWork(items, { ...defaultInboxQuery, scope: q.scope, due: 'overdue' }, reminders, today).length;
  const dueToday = selectWork(items, { ...defaultInboxQuery, scope: q.scope, due: 'today' }, reminders, today).length;
  const filterCount = Number(q.due !== 'any') + Number(q.kind !== 'all') + Number(!!q.engagementId);
  const filtered = !!(filterCount || q.search.trim()), shown = visible.slice(0, limit), groups = groupWork(shown);
  const scopeText = q.scope === 'team' ? 'Team workload' : 'Assigned to you';
  async function updateReminder(i: WorkItem, until?: string) {
    if (operation.current || !prefRef.current.ready) return;
    operation.current = true; setReminderBusy(true);
    try {
      const current = prefRef.current;
      await current.save({ ...current.value, snoozed: [...current.value.snoozed.filter(s => s.id !== i.id && Date.parse(s.until) > Date.now()), ...(until ? [{ id: i.id, until }] : [])].slice(-100) });
      if (until) toast.success('Reminder snoozed until tomorrow at 08:00', { action: { label: 'Undo', onClick: () => { void updateReminder(i); } } });
      else toast.success('Reminder resumed');
    } catch { /* Preference errors are displayed beside the queue. */ }
    finally { operation.current = false; setReminderBusy(false); }
  }
  const rows = (list: WorkItem[], state = true) => <TaskRows items={list} tenantId={data.tenantId} onOpen={onOpen} showState={state} reminders={reminders}
    reminderDisabled={reminderBusy} onSnooze={pref.ready ? i => void updateReminder(i, reminderResumeAt()) : undefined} onResume={pref.ready ? i => void updateReminder(i) : undefined}/>;
  return <div className="work-inbox">
    <div className="page-head"><div className="page-heading"><Inbox size={22} aria-hidden="true"/><h1>My work</h1></div><div className="row-actions page-head-actions">
      <Button variant="ghost" size="icon" title="Copy inbox link" aria-label="Copy inbox link" onClick={onCopyLink}><Link2 size={16} aria-hidden="true"/></Button>
      <Button variant="outline" aria-label={busy ? 'Refreshing work' : 'Refresh work'} disabled={busy} onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" className={busy ? 'work-refresh-busy' : ''}/><span className="work-refresh-label">{busy ? 'Refreshing…' : 'Refresh'}</span></Button>
    </div></div>
    <div className="work-inbox-context"><div>{data.identity.role === 'Lead Auditor' ? <div className="work-scope-switch" aria-label="Assignment scope">
      <button aria-pressed={q.scope === 'mine'} onClick={() => change({ scope: 'mine' })}>Assigned to me</button><button aria-pressed={q.scope === 'team'} onClick={() => change({ scope: 'team' })}>Team workload</button>
    </div> : <span>{scopeText}</span>}</div><span>{loaded ? `${loaded} engagement${loaded === 1 ? '' : 's'} loaded${page !== null ? ' · More available' : ''}` : busy ? 'Loading assignments…' : 'No engagements loaded'}{updated && <time dateTime={updated.toISOString()} title={updated.toLocaleString()}>Updated {updated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>}</span></div>
    <div className="work-view-strip" role="group" aria-label="Work views">{views.map(([value, title]) => <button key={value} aria-pressed={q.view === value} onClick={() => change({ view: value })}>{value === 'all' && q.scope === 'team' ? 'All team work' : title}<span>{busy && !loaded ? '—' : count(value)}</span></button>)}</div>
    <div className="work-controls"><div className="work-search"><Search size={16} aria-hidden="true"/><Input aria-label="Search work inbox" name="workSearch" autoComplete="off" placeholder="Search tasks, clients or engagements…" value={q.search} maxLength={300} onChange={e => change({ search: e.target.value })}/>{q.search && <Button size="icon" variant="ghost" aria-label="Clear work search" onClick={() => change({ search: '' })}><X size={15} aria-hidden="true"/></Button>}</div>
      <Popover open={filtersOpen} onOpenChange={setFiltersOpen}><PopoverTrigger asChild><Button variant="outline"><SlidersHorizontal size={15} aria-hidden="true"/>Filters{filterCount > 0 && <span className="work-filter-count">{filterCount}</span>}</Button></PopoverTrigger><PopoverContent align="end" className="work-filter-popover"><h2>Filter work</h2>
        <label>Deadline<select name="workDue" value={q.due} onChange={e => change({ due: e.target.value as InboxQuery['due'] })}><option value="any">Any deadline</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="soon">Due in the next {pref.value.reminderDays} days</option><option value="undated">No due date</option></select></label>
        <label>Work type<select name="workKind" value={q.kind} onChange={e => change({ kind: e.target.value as InboxQuery['kind'] })}><option value="all">All work types</option>{Object.entries(workKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Engagement<select name="workEngagement" value={q.engagementId} onChange={e => change({ engagementId: e.target.value })}><option value="">All engagements</option>{data.engagements.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
        <label>Due soon window<select name="reminderDays" value={pref.value.reminderDays} disabled={!pref.ready || reminderBusy} onChange={e => void pref.save({ ...pref.value, reminderDays: Number(e.target.value) as 1 | 3 | 7 }).catch(() => {})}>{[1, 3, 7].map(days => <option key={days} value={days}>{days} day{days > 1 ? 's' : ''}</option>)}</select></label>
        <Button variant="ghost" onClick={reset}>Clear filters & search</Button></PopoverContent></Popover>
      <label className="work-sort"><span className="sr-only">Sort work</span><select aria-label="Sort work" name="workSort" value={q.sort} onChange={e => change({ sort: e.target.value as InboxQuery['sort'] })}><option value="priority">Priority</option><option value="due">Due date</option><option value="name">Title</option></select></label>
    </div>
    <div className="work-result-summary"><span role="status" aria-live="polite">{visible.length} matching {visible.length === 1 ? 'item' : 'items'}{page !== null ? ' in loaded engagements' : ''}</span><div>
      <button aria-pressed={q.due === 'overdue'} onClick={() => change({ due: q.due === 'overdue' ? 'any' : 'overdue' })}><span className={overdue ? 'overdue' : ''}>{overdue} overdue</span></button>
      <button aria-pressed={q.due === 'today'} onClick={() => change({ due: q.due === 'today' ? 'any' : 'today' })}>{dueToday} due today</button>
    </div></div>
    {filtered && <div className="work-active-filters">{q.search.trim() && <span>Search: {q.search.trim()}</span>}{q.due !== 'any' && <span>{q.due === 'soon' ? `Next ${pref.value.reminderDays} days` : q.due === 'undated' ? 'No due date' : q.due === 'today' ? 'Due today' : 'Overdue'}</span>}{q.kind !== 'all' && <span>{workKindLabels[q.kind]}</span>}{q.engagementId && <span>{data.engagements.find(e => e.id === q.engagementId)?.title ?? 'Selected engagement'}</span>}<button onClick={reset}>Clear filters</button></div>}
    {(error || pref.error) && <p role="alert" className="form-error">{error || pref.error}<Button variant="ghost" disabled={busy} onClick={() => { void pref.load(); void load(); }}>Retry</Button></p>}
    <div className="work-results" aria-busy={busy}>
      {busy && !loaded ? <div className="work-loading" role="status">Loading your work…{[0, 1, 2].map(i => <div className="work-loading-row" key={i} aria-hidden="true"/>)}</div> : !visible.length ? <div className="work-empty"><CheckCircle2 size={25} aria-hidden="true"/><h2>{error ? 'Your work could not be loaded' : page !== null ? 'No matches in loaded engagements' : q.view === 'snoozed' ? 'No snoozed reminders' : filtered ? 'No work matches these filters' : q.view === 'all' && q.scope === 'mine' ? count('snoozed') ? 'No active assignments' : 'You’re caught up' : q.view === 'all' ? 'No team work in this scope' : `No ${viewLabels[q.view].toLowerCase()} work`}</h2>
        <p>{page !== null ? 'Load more engagements to check the rest of your work.' : q.view === 'snoozed' ? 'Snoozed items return automatically tomorrow at 08:00.' : filtered ? 'Clear the filters to see the rest of your work.' : count('snoozed') ? 'Your remaining reminders are in the Snoozed view.' : 'Your assignments will appear here as the audit progresses.'}</p>
        <div className="row-actions">{filtered && <Button variant="outline" onClick={reset}>Clear filters</Button>}{q.view !== 'all' && <Button variant="ghost" onClick={() => change({ view: 'all' })}>View all assigned work</Button>}</div></div>
        : q.view === 'all' && q.sort === 'priority' ? groups.map(g => g.state === 'waiting' ? <details className="work-group work-waiting" key={g.state}><summary><span>{g.title}</span><span className="count-label">{g.items.length}</span></summary>{rows(g.items, false)}</details> : <section className="work-group" key={g.state} aria-label={g.title}><h2>{g.title}<span className="count-label">{g.items.length}</span></h2>{rows(g.items, false)}</section>) : rows(shown)}
      {visible.length > limit && <Button className="work-load-more" variant="outline" onClick={() => setLimit(v => v + 40)}>Show {Math.min(40, visible.length - limit)} more matching items</Button>}
      {page !== null && (!busy || loaded > 0) && <div className="work-pagination"><span>More engagements haven’t been checked yet.</span><Button variant="outline" disabled={busy} onClick={() => void load(page)}>{busy ? 'Loading engagements…' : 'Check more engagements'}</Button></div>}
    </div>
  </div>;
}
