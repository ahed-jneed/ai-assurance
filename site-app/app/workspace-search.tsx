"use client";
import { useState } from 'react';
import { Building2,FolderOpen,FileText,Database,AlertTriangle,BookOpen,ClipboardCheck,LayoutDashboard } from 'lucide-react';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { Command,CommandInput,CommandList,CommandEmpty,CommandGroup,CommandItem } from '@/components/ui/command';
import { workspaceSearch,type SearchItem } from '@/lib/workspace-search';
import type { WorkspaceData } from './workspace-types';
const groups=[['page','Pages'],['client','Clients'],['engagement','Engagements'],['procedure','Audit procedures'],['paper','Working papers'],['request','Evidence requests'],['model','Model versions'],['run','Evaluations'],['evidence','Evidence'],['finding','Findings'],['report','Reports'],['template','Templates & memos']] as const;
const icons={page:LayoutDashboard,client:Building2,engagement:FolderOpen,paper:FileText,evidence:Database,finding:AlertTriangle,report:ClipboardCheck,template:BookOpen,procedure:ClipboardCheck,request:FileText,model:Database,run:ClipboardCheck};
export function WorkspaceSearch({data,open,onOpenChange,onSelect}:{data:WorkspaceData;open:boolean;onOpenChange:(open:boolean)=>void;onSelect:(item:SearchItem)=>void}){
 const [query,setQuery]=useState(''),results=workspaceSearch(data,query);
 return <Dialog open={open} onOpenChange={value=>{onOpenChange(value);if(!value)setQuery('');}}><DialogContent className="workspace-search" showCloseButton={false}><DialogHeader className="sr-only"><DialogTitle>Search workspace</DialogTitle><DialogDescription>Find clients, engagements and records in the current engagement.</DialogDescription></DialogHeader><Command shouldFilter={false}><CommandInput aria-label="Search workspace" placeholder="Find a page, client or audit record…" value={query} onValueChange={setQuery}/><CommandList><CommandEmpty>No matching records.</CommandEmpty>{groups.map(([kind,title])=>{const matches=results.filter(r=>r.kind===kind).slice(0,10),Icon=icons[kind];return matches.length?<CommandGroup key={kind} heading={title}>{matches.map(item=><CommandItem value={item.kind+':'+item.id} key={item.id} onSelect={()=>{onOpenChange(false);setQuery('');onSelect(item);}}><Icon size={16}/><span><b>{item.label}</b>{item.context&&item.kind!=='page'&&<small>{item.context}</small>}</span></CommandItem>)}</CommandGroup>:null;})}</CommandList></Command><footer><span>↑ ↓ Navigate</span><span>Enter Open</span><span>Esc Close</span></footer></DialogContent></Dialog>;
}
