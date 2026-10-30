import type { WorkspaceData } from '@/app/workspace-types';



export type SearchItem={kind:'page'|'client'|'engagement'|'paper'|'evidence'|'finding'|'report'|'template'|'procedure'|'model'|'run'|'request';id:string;label:string;context:string;terms:string};

const pages=['My work','Clients','Engagements','Overview','Audit program','Working papers','Evidence vault','Testing lab','Assurance workbench','Findings','Regulatory mapping','Reports & sign-off','Methodology','Users & access'];

const normalize=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

export function workspaceSearch(data:WorkspaceData,query:string):SearchItem[]{

 const viewer=['Client Viewer','Client Contributor'].includes(data.identity.role),engagement=data.engagement,items:SearchItem[]=[];

 for(const page of pages){if(!engagement&&!['My work','Clients','Engagements','Users & access'].includes(page))continue;if(viewer&&['My work','Audit program','Working papers','Testing lab','Assurance workbench','Regulatory mapping','Methodology'].includes(page))continue;items.push({kind:'page',id:page,label:page==='Users & access'?'Members & access':page==='Methodology'?'Templates & history':page,context:'Page',terms:page});}

 for(const client of data.clients)items.push({kind:'client',id:client.id,label:client.name,context:client.sector,terms:client.sector});

 for(const audit of data.engagements)items.push({kind:'engagement',id:audit.id,label:audit.title,context:data.clients.find(c=>c.id===audit.client_id)?.name??'',terms:audit.stage});

 if(engagement){

  if(!viewer){for(const p of engagement.workflow?.procedures??[])items.push({kind:'procedure',id:p.id,label:p.title,context:p.templateId+' · '+p.state,terms:p.criterion});for(const m of engagement.models??[])items.push({kind:'model',id:m.id,label:m.name+' · '+m.version,context:m.task,terms:m.format});for(const r of engagement.runs??[])items.push({kind:'run',id:r.id,label:(engagement.models?.find(m=>m.id===r.modelId)?.name??'Model')+' evaluation',context:r.state+' · '+new Date(r.createdAt).toLocaleDateString(),terms:r.id});for(const r of engagement.evidenceRequests??[])items.push({kind:'request',id:r.id,label:r.subject,context:r.status+' · due '+r.dueDate,terms:r.responsibleParty});}

  if(!viewer)for(const paper of engagement.papers)items.push({kind:'paper',id:paper.id,label:paper.title,context:paper.templateId+' · '+paper.stage,terms:paper.templateId+' '+paper.articleRefs.join(' ')});

  for(const evidence of engagement.artifacts)items.push({kind:'evidence',id:evidence.id,label:evidence.name,context:evidence.category,terms:evidence.category});

  for(const finding of engagement.findings)items.push({kind:'finding',id:finding.id,label:finding.title,context:finding.severity+' · '+finding.status.replaceAll('_',' '),terms:finding.owner+' '+finding.id});

  for(const report of engagement.reports)items.push({kind:'report',id:report.id,label:(report.kind==='final'?'Final report':'Draft report')+' · '+new Date(report.createdAt).toLocaleDateString(),context:String(report.snapshot.opinion??''),terms:report.id+' '+String(report.snapshot.summary??'')});

  if(!viewer)for(const template of data.catalog?.items??[])items.push({kind:'template',id:template.id,label:template.title,context:template.id+' · '+(template.kind==='memo'?'Memo':'Template'),terms:template.id+' '+template.stage});

 }

 const words=normalize(query.trim()).split(/\s+/).filter(Boolean);

 if(!words.length)return items.filter(item=>item.kind==='page');

 const score=(item:SearchItem)=>normalize(item.label)===normalize(query)?2:normalize(item.label).startsWith(normalize(query))?1:0;

 return items.filter(item=>words.every(word=>normalize(item.label+' '+item.context+' '+item.terms).includes(word))).sort((a,b)=>score(b)-score(a)||a.label.localeCompare(b.label));

}

