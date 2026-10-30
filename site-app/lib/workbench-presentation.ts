import type { AssuranceRecord } from './assurance-core';
import type { Role } from './domain';
import { currentAssessments, reviewFor } from './assurance-store-client';

export const workbenchSections = [
  ['systems', 'Systems'], ['execution', 'Execution'], ['evidence', 'Assertions'],
  ['sampling', 'Sampling'], ['assistant', 'Briefing'], ['impact', 'Changes'], ['access', 'Team & runtime'],
] as const;
export const workbenchReviewStates = ['all', 'Awaiting review', 'Confirmed', 'Returned', 'Superseded'] as const;
export type WorkbenchQuery = { section: string; search: string; review: string; recordId: string };
export const defaultWorkbenchQuery: WorkbenchQuery = { section: 'systems', search: '', review: 'all', recordId: '' };
export const isAssessment = (r: AssuranceRecord) => ['assertion', 'impact', 'obligation'].includes(r.kind);

export function workbenchReviewState(record: AssuranceRecord, all: AssuranceRecord[]) {
  if (all.some(r => r.body.supersedesId === record.id)) return 'Superseded';
  const review = reviewFor(all, record);
  return !review ? 'Awaiting review' : ['approve', 'confirmed'].includes(review.body.decision) ? 'Confirmed' : 'Returned';
}

export function normalizeWorkbenchQuery(input: Partial<WorkbenchQuery>): WorkbenchQuery {
  const section = workbenchSections.some(([id]) => id === input.section) ? input.section! : 'systems';
  return { section, search: ['execution', 'access'].includes(section) ? '' : (input.search ?? '').slice(0, 200),
    review: ['evidence', 'impact'].includes(section) && workbenchReviewStates.includes(input.review as never) ? input.review! : 'all',
    recordId: (input.recordId ?? '').slice(0, 300) };
}

export function readWorkbenchQuery(search: string): WorkbenchQuery {
  const q = new URLSearchParams(search);
  return normalizeWorkbenchQuery({ section: q.get('section') ?? (q.get('procedure') ? 'execution' : 'systems'),
    search: q.get('q') ?? '', review: q.get('review') ?? 'all', recordId: q.get('assurance') ?? '' });
}

export function workbenchQueryParams(query: WorkbenchQuery) {
  const q = normalizeWorkbenchQuery(query), params = new URLSearchParams();
  if (q.search) params.set('q', q.search);
  if (q.review !== 'all') params.set('review', q.review);
  if (q.recordId) params.set('assurance', q.recordId);
  return params;
}

export function workbenchReviewQueue(all: AssuranceRecord[], role: Role, userId: string) {
  const current = currentAssessments(all), awaiting = current.filter(r => workbenchReviewState(r, all) === 'Awaiting review'),
    returned = current.filter(r => workbenchReviewState(r, all) === 'Returned');
  const canReview = ['Lead Auditor', 'Reviewer'].includes(role), canRevise = ['Lead Auditor', 'Auditor'].includes(role);
  return { awaiting, returned, reviewable: canReview ? awaiting.filter(r => r.actor !== userId) : [],
    revisable: canRevise ? returned : [], canReview, canRevise };
}

export function selectWorkbenchRecords(rows: AssuranceRecord[], all: AssuranceRecord[], search: string, review: string,
  title: (r: AssuranceRecord) => string, person: (id: string) => string) {
  const term = search.trim().toLocaleLowerCase();
  return rows.filter(r => (!term || [r.id, title(r), r.body.criterion, r.body.code, r.body.locator, r.body.artifactName,
    r.body.intendedUse, person(r.actor)].join(' ').toLocaleLowerCase().includes(term))
    && (review === 'all' || !isAssessment(r) || workbenchReviewState(r, all) === review));
}
