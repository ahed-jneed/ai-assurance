import type { WorkItem } from './work-items';

export const inboxViews = ['all', 'ready', 'reviews', 'planning', 'waiting', 'snoozed'] as const;
export type InboxView = typeof inboxViews[number];
export type InboxQuery = {
  scope: 'mine' | 'team'; view: InboxView; due: 'any' | 'overdue' | 'today' | 'soon' | 'undated';
  engagementId: string; kind: 'all' | WorkItem['kind']; sort: 'priority' | 'due' | 'name'; search: string;
};
export const defaultInboxQuery: InboxQuery = { scope: 'mine', view: 'all', due: 'any', engagementId: '', kind: 'all', sort: 'priority', search: '' };
export const workKindLabels: Record<WorkItem['kind'], string> = { scope: 'Scope', program: 'Audit program', procedure: 'Procedure', paper: 'Working paper', request: 'Evidence request', finding: 'Finding', report: 'Report', monitoring: 'Follow-up' };
export function localWorkDay(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
export function calendarWorkDay(today: string, days: number) {
  const date = new Date(today + 'T12:00:00'); date.setDate(date.getDate() + days); return localWorkDay(date);
}
export function reminderResumeAt(now = new Date()) {
  const date = new Date(now); date.setDate(date.getDate() + 1); date.setHours(8, 0, 0, 0); return date.toISOString();
}
export function activeReminders(snoozed: { id: string; until: string }[], now = Date.now()) {
  return new Map(snoozed.filter(s => Date.parse(s.until) > now).map(s => [s.id, s.until]));
}
export function readInboxQuery(search: string, teamAllowed = false): InboxQuery {
  const p = new URLSearchParams(search), q = { ...defaultInboxQuery };
  if (teamAllowed && p.get('workScope') === 'team') q.scope = 'team';
  const view = p.get('workView'); if (inboxViews.includes(view as InboxView)) q.view = view as InboxView;
  const due = p.get('workDue'); if (['any', 'overdue', 'today', 'soon', 'undated'].includes(due ?? '')) q.due = due as InboxQuery['due'];
  const kind = p.get('workKind'); if (kind && Object.hasOwn(workKindLabels, kind)) q.kind = kind as WorkItem['kind'];
  const sort = p.get('workSort'); if (['priority', 'due', 'name'].includes(sort ?? '')) q.sort = sort as InboxQuery['sort'];
  q.engagementId = (p.get('workEngagement') ?? '').slice(0, 300); q.search = (p.get('q') ?? '').slice(0, 300); return q;
}
export function normalizeInboxQuery(q: InboxQuery, teamAllowed: boolean, engagementIds: string[]) {
  const scope = teamAllowed ? q.scope : 'mine', engagementId = q.engagementId && !engagementIds.includes(q.engagementId) ? '' : q.engagementId;
  return scope === q.scope && engagementId === q.engagementId ? q : { ...q, scope: scope as InboxQuery['scope'], engagementId };
}
export function inboxQueryParams(q: InboxQuery) {
  return Object.entries({ workScope: q.scope === 'mine' ? '' : q.scope, workView: q.view === 'all' ? '' : q.view, workDue: q.due === 'any' ? '' : q.due, workKind: q.kind === 'all' ? '' : q.kind, workSort: q.sort === 'priority' ? '' : q.sort, workEngagement: q.engagementId, q: q.search }).filter(([, v]) => v);
}
export function selectWork(items: WorkItem[], q: InboxQuery, reminders: Map<string, string>, today: string, reminderDays = 3) {
  const soon = calendarWorkDay(today, reminderDays), search = q.search.trim().toLocaleLowerCase();
  return items.filter(i => (q.scope === 'team' || i.personal)
    && (q.view === 'snoozed' ? reminders.has(i.id) : !reminders.has(i.id))
    && (q.view === 'all' || q.view === 'snoozed' || i.state === (q.view === 'reviews' ? 'review' : q.view))
    && (!q.engagementId || i.engagementId === q.engagementId) && (q.kind === 'all' || i.kind === q.kind)
    && (q.due === 'any' || q.due === 'undated' && !i.dueDate || q.due === 'overdue' && !!i.dueDate && i.dueDate < today || q.due === 'today' && i.dueDate === today || q.due === 'soon' && !!i.dueDate && i.dueDate >= today && i.dueDate <= soon)
    && (!search || [i.title, i.engagement, i.client, i.action, i.reason, i.recordId, workKindLabels[i.kind]].join(' ').toLocaleLowerCase().includes(search))
  ).sort((a, b) => {
    const deadline = (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    if (q.sort === 'name') return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    if (q.sort === 'due') return deadline || a.priority - b.priority || a.id.localeCompare(b.id);
    return Number(a.state === 'waiting') - Number(b.state === 'waiting') || Number(!!b.dueDate && b.dueDate < today) - Number(!!a.dueDate && a.dueDate < today) || a.priority - b.priority || deadline || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}
export function groupWork(items: WorkItem[]) {
  return ([['review', 'Independent review'], ['ready', 'Ready to work'], ['planning', 'Plan & assign'], ['waiting', 'Waiting on dependencies']] as const)
    .map(([state, title]) => ({ state, title, items: items.filter(i => i.state === state) })).filter(g => g.items.length);
}
