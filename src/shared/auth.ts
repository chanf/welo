import type { Context, MiddlewareHandler } from "hono";
import { ApiError } from "./errors";
import { sha256 } from "./crypto";

export type AuthUser = { id: number; username: string; email: string; systemRole: "super_admin" | "member"; createdAt: string };
export type AuthContext = { user: AuthUser; tokenHash: string };

type AuthApp = { Bindings: Env; Variables: { requestId: string; auth: AuthContext } };

export const authRequired: MiddlewareHandler<AuthApp> = async (c, next) => {
  const authorization = c.req.header("Authorization");
  const cookie = c.req.header("Cookie")?.match(/(?:^|;\s*)welo_session=([^;]+)/)?.[1];
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? cookie;
  if (!token) throw new ApiError(401, "UNAUTHENTICATED", "请先登录");
  const tokenHash = await sha256(token);
  const row = await c.env.DB.prepare(`
    SELECT u.id, u.username, u.email, u.system_role, u.created_at, s.token_hash
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
  `).bind(tokenHash).first<{ id: number; username: string; email: string; system_role: AuthUser["systemRole"]; created_at: string; token_hash: string }>();
  if (!row) throw new ApiError(401, "UNAUTHENTICATED", "登录已失效");
  c.set("auth", { tokenHash, user: { id: row.id, username: row.username, email: row.email, systemRole: row.system_role, createdAt: row.created_at } });
  await next();
};

export function currentAuth(c: Context<AuthApp>): AuthContext {
  return c.get("auth");
}

export function requireAdmin(c: Context<AuthApp>) {
  if (currentAuth(c).user.systemRole !== "super_admin") throw new ApiError(403, "FORBIDDEN", "仅超级管理员可执行此操作");
}

export function cookieHeader(token: string, ttlSeconds: number): string {
  return `welo_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
}
