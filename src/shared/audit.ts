import type { AccessContext } from "./access";

export function auditStatement(
  c: AccessContext,
  teamId: number,
  actorId: number,
  action: string,
  entityType: string,
  entityId: string | number,
  before: unknown,
  after: unknown,
) {
  return c.env.DB.prepare(`
    INSERT INTO audit_logs (
      team_id, actor_id, action, entity_type, entity_id,
      before_json, after_json, request_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    teamId,
    actorId,
    action,
    entityType,
    String(entityId),
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    c.get("requestId"),
    new Date().toISOString(),
  );
}
