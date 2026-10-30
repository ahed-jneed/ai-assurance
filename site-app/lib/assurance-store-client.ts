import type { AssuranceRecord } from './assurance-core';
export function currentAssessments(all:AssuranceRecord[]){const superseded=new Set(all.filter(r=>['assertion','impact','obligation'].includes(r.kind)).map(r=>r.body.supersedesId).filter(Boolean));return all.filter(r=>['assertion','impact','obligation'].includes(r.kind)&&!superseded.has(r.id));}
export function reviewFor(all:AssuranceRecord[],source:AssuranceRecord){return all.filter(r=>r.kind===source.kind+'_review'&&(r.body.assertionId??r.body.impactId??r.body.obligationId)===source.id).at(-1);}
