"use client";
import { ChevronRight,FileText,CheckCircle2 } from 'lucide-react';
import { useEffect,useState } from 'react';
import { Button } from '@/components/ui/button';
import { paperChecklist,type PaperTarget } from '@/lib/paper-workflow';
import { stagePaperQueue,auditStageIndex } from '@/lib/auditor-workflow';
import type { Engagement,Paper,Role } from '@/lib/domain';
export function NextSteps({engagement:e,role,userId,onPaper,onViewAll}:{engagement:Engagement;role:Role;userId:string;onPaper:(p:Paper,target?:PaperTarget)=>void;onViewAll:()=>void}){
 const {active,later,waiting,teamOutstanding,earlierOutstanding}=stagePaperQueue(e,role,userId);
 const [showAll,setShowAll]=useState(false);
 useEffect(()=>setShowAll(false),[e.id,e.stage]);
 function row(item:typeof active[number],index:number,primary=false){
  const carryover=auditStageIndex(item.paper.stage)>=0&&auditStageIndex(item.paper.stage)<auditStageIndex(e.stage);
  const missing=item.paper.status==='draft'?paperChecklist(item.paper,e.artifacts).filter(c=>!c.done):[];
  const detail=item.target==='review'?item.reason:missing.length?`${missing.length} submission ${missing.length===1?'requirement':'requirements'} remaining`:item.reason;
  return <button className={'next-step-row '+(primary&&index===0?'next-step-primary':'')} key={item.paper.id} onClick={()=>onPaper(item.paper,item.target)}><FileText size={18}/><span><b>{item.paper.title}</b><small>{item.paper.templateId} · {carryover?'Earlier stage · ':''}{item.paper.stage}</small><small className="queue-requirement">{detail}</small></span><span className="next-step-action">{item.label}<ChevronRight size={14}/></span></button>;
 }
 return <section className="panel next-steps"><div className="panel-head"><h2>Your work queue <span className="count-label">{active.length}</span></h2><Button variant="ghost" size="sm" onClick={onViewAll}>All working papers</Button></div><div className="queue-context"><span>{e.stage}</span><button type="button" onClick={onViewAll}>{teamOutstanding} team {teamOutstanding===1?'paper':'papers'} open{earlierOutstanding?` · ${earlierOutstanding} from earlier stages`:''}</button></div>{(showAll?active:active.slice(0,5)).map((item,index)=>row(item,index,true))}{active.length>5&&<Button variant="ghost" className="more-work" size="sm" onClick={()=>setShowAll(v=>!v)}>{showAll?'Show fewer actions':`View ${active.length-5} more actions`}</Button>}{!active.length&&<div className="queue-empty"><CheckCircle2 size={17}/><span>{teamOutstanding?'No personal paper actions in this stage. Team work remains.':'No personal actions pending in this stage.'}</span></div>}{!!waiting.length&&<details className="waiting-papers"><summary>Waiting on independent review or sign-off <span>{waiting.length}</span></summary>{waiting.map((item,index)=>row(item,index))}</details>}{!!later.length&&<details className="waiting-papers"><summary>Prepare later & other work <span>{later.length}</span></summary>{later.map((item,index)=>row(item,index))}</details>}</section>;
}
