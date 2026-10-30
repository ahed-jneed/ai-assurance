import { z } from 'zod';
import { ApiError, checkOrigin, context, db, getEngagement, freshEngagement, id, now, readBounded, requireAdmin, responseError, sha256 } from '@/lib/store';

export const dynamic = 'force-dynamic';
const short = z.string().trim().min(1).max(300);
const command = z.object({tenantId: short, expectedVersion: z.number().int().positive(), op: z.enum(['createClient','updateClient','createEngagement','grantMember','updateMember','revokeMember']), data: z.record(z.unknown())}).strict();

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const payload = command.parse(JSON.parse(new TextDecoder().decode(await readBounded(request, 16384))));
    const ctx = await context(payload.tenantId);
    requireAdmin(ctx);
    const commandId = id('MGMT'), timestamp = now();
    const guard = 'EXISTS(SELECT 1 FROM tenants WHERE id=? AND last_command_id=?)';
    const statements: D1PreparedStatement[] = [];
    let details: Record<string, unknown> = {};
    if (payload.op === 'createClient' || payload.op === 'updateClient') {
      const a = z.object({name: short, sector: short, clientId: short.optional()}).parse(payload.data);
      const clientId = payload.op === 'createClient' ? id('CL') : a.clientId;
      if (!clientId || payload.op === 'updateClient' && !await db().prepare('SELECT id FROM clients WHERE tenant_id=? AND id=?').bind(ctx.tenantId, clientId).first()) throw new ApiError(404, 'Client not found');
      statements.push(payload.op === 'createClient'
        ? db().prepare('INSERT INTO clients(tenant_id,id,name,sector,created_at) SELECT ?,?,?,?,? WHERE '+guard).bind(ctx.tenantId,clientId,a.name,a.sector,timestamp,ctx.tenantId,commandId)
        : db().prepare('UPDATE clients SET name=?,sector=? WHERE tenant_id=? AND id=? AND '+guard).bind(a.name,a.sector,ctx.tenantId,clientId,ctx.tenantId,commandId));
      details = {clientId, name: a.name, sector: a.sector};
    } else if (payload.op === 'createEngagement') {
      const a = z.object({clientId: short, title: short}).parse(payload.data);
      if (!await db().prepare('SELECT id FROM clients WHERE tenant_id=? AND id=?').bind(ctx.tenantId,a.clientId).first()) throw new ApiError(404,'Client not found');
      const engagement = freshEngagement(a.clientId,a.title,ctx.user.userId,true), body = JSON.stringify(engagement);
      statements.push(db().prepare('INSERT INTO engagements(tenant_id,id,client_id,title,version,body,last_command_id) SELECT ?,?,?,?,?,?,? WHERE '+guard).bind(ctx.tenantId,engagement.id,a.clientId,a.title,1,body,'init',ctx.tenantId,commandId));
      statements.push(db().prepare('INSERT INTO engagement_snapshots(tenant_id,engagement_id,version,body,sha256,created_at) SELECT ?,?,?,?,?,? WHERE '+guard).bind(ctx.tenantId,engagement.id,1,body,await sha256(body),timestamp,ctx.tenantId,commandId));
      statements.push(db().prepare('INSERT INTO engagement_access_policies(tenant_id,engagement_id,created_at) SELECT ?,?,? WHERE '+guard).bind(ctx.tenantId,engagement.id,timestamp,ctx.tenantId,commandId));
      statements.push(db().prepare('INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT ?,?,?,1,?,? WHERE '+guard).bind(ctx.tenantId,engagement.id,ctx.user.userId,ctx.user.userId,timestamp,ctx.tenantId,commandId));
      details = {engagementId: engagement.id, clientId: a.clientId, title: a.title};
    } else {
      const a = z.object({userId: short,displayName:short.optional(),role:z.enum(['Auditor','Lead Auditor','Client Viewer','Client Contributor','Reviewer']).optional(),clientId:z.string().max(300).nullable().optional(),engagementIds:z.array(short).max(50).refine(v=>new Set(v).size===v.length).optional()}).parse(payload.data);
      if (a.userId === ctx.user.userId) throw new ApiError(400,'You cannot change or revoke your own access');
      const existing = await db().prepare('SELECT user_id,status FROM memberships WHERE tenant_id=? AND user_id=?').bind(ctx.tenantId,a.userId).first<{user_id:string;status:string}>();
      if (payload.op !== 'grantMember' && !existing) throw new ApiError(404,'User not found in this practice');
      if (payload.op === 'updateMember' && existing?.status !== 'active') throw new ApiError(409,'Restore revoked access before editing the role');
      if (payload.op === 'revokeMember') {
        statements.push(db().prepare('UPDATE memberships SET status=? WHERE tenant_id=? AND user_id=? AND '+guard).bind('revoked',ctx.tenantId,a.userId,ctx.tenantId,commandId));
        details = {userId:a.userId,status:'revoked'};
      } else {
        if (!a.displayName || !a.role) throw new ApiError(400,'Enter a name and select a role');
        if (['Client Viewer','Client Contributor'].includes(a.role) && (!a.clientId || !await db().prepare('SELECT id FROM clients WHERE tenant_id=? AND id=?').bind(ctx.tenantId,a.clientId).first())) throw new ApiError(400,'Select a client for client access');
        const clientId = ['Client Viewer','Client Contributor'].includes(a.role) ? a.clientId! : null;
        if (payload.op === 'updateMember') statements.push(db().prepare('UPDATE memberships SET display_name=?,role=?,client_id=? WHERE tenant_id=? AND user_id=? AND status=? AND '+guard).bind(a.displayName,a.role,clientId,ctx.tenantId,a.userId,'active',ctx.tenantId,commandId));
        else statements.push(db().prepare('INSERT INTO memberships(tenant_id,user_id,role,client_id,display_name,status) SELECT ?,?,?,?,?,? WHERE '+guard+' ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role,client_id=excluded.client_id,display_name=excluded.display_name,status=excluded.status').bind(ctx.tenantId,a.userId,a.role,clientId,a.displayName,'active',ctx.tenantId,commandId));
        if(a.engagementIds?.length){
          if(ctx.role!=='Lead Auditor'||['Client Viewer','Client Contributor'].includes(a.role))throw new ApiError(403,'Only a Lead Auditor may assign internal engagement access');
          for(const engagementId of a.engagementIds){await getEngagement(ctx,engagementId);statements.push(db().prepare('INSERT INTO engagement_access(tenant_id,engagement_id,user_id,active,actor,updated_at) SELECT ?,?,?,1,?,? WHERE '+guard+' ON CONFLICT(tenant_id,engagement_id,user_id) DO UPDATE SET active=1,actor=excluded.actor,updated_at=excluded.updated_at').bind(ctx.tenantId,engagementId,a.userId,ctx.user.userId,timestamp,ctx.tenantId,commandId));}
        }
        details = {userId:a.userId,displayName:a.displayName,role:a.role,clientId,status:'active',engagementIds:a.engagementIds??[]};
      }
    }
    const event = {id:id('ME'),actor:ctx.user.userId,action:payload.op,details,createdAt:timestamp};
    const result = await db().batch([
      db().prepare("UPDATE tenants SET version=version+1,last_command_id=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM memberships m JOIN practice_admins a ON a.tenant_id=m.tenant_id AND a.user_id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND a.active=1)").bind(commandId,ctx.tenantId,payload.expectedVersion,ctx.tenantId,ctx.user.userId),
      ...statements,
      db().prepare('INSERT INTO management_events(tenant_id,id,actor,action,details,hash,created_at) SELECT ?,?,?,?,?,?,? WHERE '+guard).bind(ctx.tenantId,event.id,event.actor,event.action,JSON.stringify(details),await sha256(JSON.stringify(event)),timestamp,ctx.tenantId,commandId)
    ]);
    if (!result[0].meta.changes) throw new ApiError(409,'Client or access settings changed. Reload before saving.');
    return Response.json({details,managementVersion:payload.expectedVersion+1});
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({error:error.issues.map(i=>i.message).join('; ')},{status:400});
    return responseError(error);
  }
}
