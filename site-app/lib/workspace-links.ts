import {navigationRoutes,permittedNavigationRoutes} from './navigation-preferences';
import type {Role} from './domain';
export type WorkspaceLink={tenantId:string;engagementId:string;module:string;kind:string;recordId:string;section:string};
export function readWorkspaceLink(search:string):WorkspaceLink|null{
 const q=new URLSearchParams(search),module=q.get('view');if(!module)return null;
 if(!navigationRoutes.includes(module as any))return null;
 const value={tenantId:q.get('practice')??'',engagementId:q.get('engagement')??'',module,kind:q.get('kind')??'',recordId:q.get('record')??'',section:q.get('section')??''};
 if(Object.values(value).some(v=>v.length>300)||!['','paper','procedure','evidence','request','finding','report','model','run'].includes(value.kind))return null;
 return value;
}
export function authorizedLink(link:WorkspaceLink,role:Role,hasEngagement:boolean){return permittedNavigationRoutes(role,hasEngagement).includes(link.module as any)&&(!['Client Viewer','Client Contributor'].includes(role)||!['paper','procedure','model','run'].includes(link.kind));}
export function linkQuery(link:WorkspaceLink){return new URLSearchParams(Object.fromEntries(Object.entries({practice:link.tenantId,engagement:link.engagementId,view:link.module,kind:link.kind,record:link.recordId,section:link.section}).filter(([,v])=>v))).toString();}
