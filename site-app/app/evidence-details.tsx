"use client";

import {useState,useEffect,useRef} from 'react';

import { Download, Check, Link2, FileText, FlaskConical, AlertTriangle, Box } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { canWrite, type Artifact, type Engagement, type Paper, type Role, type Run, type Finding, type Model, type EvidenceRequest } from '@/lib/domain';

import { humanLabel } from '@/lib/presentation';

import { evidenceSize, evidenceVisibility } from './audit-registers';

import type { ReactNode } from 'react';

function LinkGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {

  if (!count) return null;

  return <details className="evidence-link-group" open><summary>{title}{' '}<span className="view-count">{count}</span></summary><div>{children}</div></details>;

}

export function EvidenceDetails({ artifact, engagement, tenantId, role, busy, resolve, onAccept, onPaper, onRun, onFinding, onModel, onLink, onRequest }: {

  artifact: Artifact; engagement: Engagement; tenantId: string; role: Role; busy: boolean; resolve: (id: string) => string;

  onAccept: () => void; onPaper: (p: Paper) => void; onRun: (r: Run) => void; onFinding: (f: Finding) => void; onModel: (m: Model) => void; onLink: () => void; onRequest: (r: EvidenceRequest) => void;

}) {

  const current = engagement.artifacts.find(a => a.id === artifact.id) ?? artifact;
  const previewAllowed = current.status === 'accepted' && current.size <= 256*1024 && /\.(txt|md|csv|json|log)$/i.test(current.name);

  const models = engagement.models.filter(m => m.artifactId === current.id), papers = engagement.papers.filter(p => p.evidenceIds.includes(current.id));

  const runs = engagement.runs.filter(r => r.datasetId === current.id || engagement.models.some(m => m.id === r.modelId && m.artifactId === current.id));

  const requests = (engagement.evidenceRequests ?? []).filter(r => r.evidenceIds.includes(current.id));

  const findings = engagement.findings.filter(f => f.retestEvidenceIds.includes(current.id) || f.support?.evidenceIds.includes(current.id) || f.retest?.evidenceIds.includes(current.id));

  const linkedCount = models.length + papers.length + runs.length + requests.length + findings.length;

  const canLink = engagement.papers.some(p => p.status !== 'signed');

  return <div className="evidence-record">

    <div className="detail-status"><span className={'badge ' + (current.status === 'accepted' ? 'green' : 'amber')}>{current.status === 'unverified' ? 'Awaiting acceptance' : humanLabel(current.status)}</span><span className="subtle">{current.category}</span></div>

    <div className="record-primary-actions">{canWrite(role) && current.status === 'unverified' && <Button disabled={busy} onClick={onAccept}><Check size={15}/>Accept evidence</Button>}{canWrite(role) && current.status === 'accepted' && <Button disabled={busy || !canLink} title={!canLink ? 'Create or reopen a working paper to link this file.' : undefined} onClick={onLink}><Link2 size={15}/>Link to paper</Button>}<a className="download-link" href={'/api/evidence?' + new URLSearchParams({ tenantId, engagementId: engagement.id, artifactId: current.id })}><Download size={15}/>Download file</a></div>

    {current.status === 'unverified' && canWrite(role) && <p className="record-decision-note">Check the source, version and handling basis before accepting this file. Record its relevance and sufficiency in the working paper.</p>}

    {current.status === 'quarantined' && <p className="record-decision-note">Quarantined files cannot be accepted as audit evidence. Model binaries may be retained for inventory in the Testing lab.</p>}

    {previewAllowed&&<EvidenceFilePreview key={JSON.stringify([tenantId,engagement.id,current.id,current.status,current.name,current.size])} tenantId={tenantId} engagementId={engagement.id} artifactId={current.id}/>}

    <dl className="record-summary-grid"><div><dt>Uploaded by</dt><dd>{current.uploadedBy ? resolve(current.uploadedBy) : 'Not available'}</dd></div><div><dt>Uploaded</dt><dd>{new Date(current.createdAt).toLocaleString()}</dd></div><div><dt>File size</dt><dd>{evidenceSize(current.size)}</dd></div><div><dt>Visibility</dt><dd>{evidenceVisibility(current)}</dd></div></dl>

    <section className="record-links"><h3>Linked audit records <span className="subtle">{linkedCount}</span></h3>

      <LinkGroup title="Working papers" count={papers.length}>{papers.map(p => <button key={p.id} className="linked-record" onClick={() => onPaper(p)}><FileText size={16}/><span><b>{p.title}</b><small>{p.templateId} · Revision {p.revision}</small></span><span className="badge neutral">{humanLabel(p.status)}</span></button>)}</LinkGroup>

      <LinkGroup title="Evidence requests" count={requests.length}>{requests.map(r => <button key={r.id} className="linked-record" onClick={() => onRequest(r)}><FileText size={16}/><span><b>{r.subject}</b><small>Due {r.dueDate}</small></span></button>)}</LinkGroup>

      <LinkGroup title="Models" count={models.length}>{models.map(m => <button key={m.id} className="linked-record" onClick={() => onModel(m)}><Box size={16}/><span><b>{m.name}</b><small>Version {m.version}</small></span><span className="badge neutral">{humanLabel(m.status)}</span></button>)}</LinkGroup>

      <LinkGroup title="Evaluations" count={runs.length}>{runs.map(r => <button key={r.id} className="linked-record" onClick={() => onRun(r)}><FlaskConical size={16}/><span><b>{engagement.models.find(m => m.id === r.modelId)?.name ?? 'Diagnostic run'}</b><small>{new Date(r.createdAt).toLocaleString()}</small></span><span className="badge neutral">{humanLabel(r.state)}</span></button>)}</LinkGroup>

      <LinkGroup title="Findings" count={findings.length}>{findings.map(f => <button key={f.id} className="linked-record" onClick={() => onFinding(f)}><AlertTriangle size={16}/><span><b>{f.title}</b><small>{f.retestEvidenceIds.includes(current.id) || f.retest?.evidenceIds.includes(current.id) ? 'Retest evidence' : 'Finding support'}</small></span><span className="badge neutral">{humanLabel(f.status)}</span></button>)}</LinkGroup>

      {!linkedCount && <div className="record-empty"><p>This file has no linked audit records.</p>{canWrite(role) && current.status === 'accepted' && canLink && <Button variant="outline" size="sm" disabled={busy} onClick={onLink}><Link2 size={14}/>Link to a working paper</Button>}</div>}

    </section>

    <details className="provenance"><summary>Custody & integrity</summary><span className="hash-text">SHA-256: {current.sha256}</span><p>Acceptance records an audit handling decision. Assess relevance, sufficiency and privacy in the working paper.</p></details>

  </div>;

}


// The record identity key owns the preview lifecycle. Context changes unmount it
// and abort the old request before another file can receive its result.
function EvidenceFilePreview({tenantId,engagementId,artifactId}:{tenantId:string;engagementId:string;artifactId:string}) {
  const request=useRef<AbortController|null>(null);
  const [preview,setPreview]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>()=>{request.current?.abort();},[]);
  async function showPreview(){
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    setBusy(true);setError('');
    const active=()=>!controller.signal.aborted&&request.current===controller;
    try{
      const response=await fetch('/api/evidence?'+new URLSearchParams({tenantId,engagementId,artifactId,preview:'1'}),{cache:'no-store',signal:controller.signal});
      const value=await response.json() as {text:string;error?:string};
      if(!response.ok)throw Error(value.error??'Preview unavailable');
      if(active())setPreview(value.text);
    }catch(err){if(active())setError(err instanceof Error?err.message:'Preview unavailable');}
    finally{if(active())setBusy(false);}
  }
  return <section><Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>preview!==null?setPreview(null):void showPreview()}>{busy?'Loading preview…':preview!==null?'Hide file preview':'Preview file'}</Button>{error&&<p className="form-error" role="alert">{error}</p>}{preview!==null&&<div className="contextual-preview" tabIndex={0} aria-label="File preview"><pre>{preview}</pre></div>}</section>;
}
