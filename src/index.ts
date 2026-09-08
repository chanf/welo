import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { authRequired, cookieHeader, currentAuth, requireAdmin } from "./shared/auth";
import { hashPassword, randomToken, sha256, verifyPassword } from "./shared/crypto";
import { ApiError, notFound } from "./shared/errors";
import { fail, ok } from "./shared/response";
import { isoTimestamp, nextTaskVersion } from "./shared/task-version";
import { allocateUserColor } from "./shared/user-color";

type App = { Bindings: Env; Variables: { requestId: string; auth: ReturnType<typeof currentAuth> } };
type AppContext = Context<App>;
const app = new Hono<App>();
const taskDateTime = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):(?:00|30)$/, "任务时间格式必须为 YYYY-MM-DDTHH:mm，且按 30 分钟对齐")
  .refine((value) => {
    const parsed = Date.parse(`${value}:00Z`);
    return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value.slice(0, 10);
  }, "任务时间不存在");
const userSchema = z.object({ username: z.string().min(2).max(32), email: z.string().email().max(255), password: z.string().min(8), passwordConfirmation: z.string().min(8) });
const loginSchema = z.object({ account: z.string().min(1).max(255), password: z.string().min(1) });
const id = (value: string | undefined) => {
  const parsed = Number(value);
  if (!value || !Number.isSafeInteger(parsed) || parsed < 1) throw new ApiError(400, "VALIDATION_ERROR", "ID 格式无效");
  return parsed;
};
const jsonBody = async <T extends z.ZodType>(c: AppContext, schema: T): Promise<z.infer<T>> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败", parsed.error.issues.map((issue) => ({ field: issue.path.join("."), reason: issue.message })));
  return parsed.data;
};
const rowUser = (row: { id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string }) => ({
  id: String(row.id), username: row.username, email: row.email, color: row.color, systemRole: row.system_role, createdAt: row.created_at,
});
const teamAccess = async (c: AppContext, teamId: number, write = false) => {
  const auth = currentAuth(c);
  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId).first<{ id: number; name: string; status: "active" | "archived"; created_by: number; created_at: string; updated_at: string; description: string | null }>();
  if (!team) throw new ApiError(404, "NOT_FOUND", "团队不存在或当前用户不可见");
  if (auth.user.systemRole !== "super_admin") {
    const member = await c.env.DB.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?").bind(teamId, auth.user.id).first();
    if (!member) throw new ApiError(404, "NOT_FOUND", "团队不存在或当前用户不可见");
  }
  if (write && team.status !== "active") throw new ApiError(409, "CONFLICT", "归档团队为只读");
  return team;
};
const projectAccess = async (c: AppContext, teamId: number, projectId: number, write = false) => {
  await teamAccess(c, teamId, write);
  const project = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ? AND team_id = ? AND deleted_at IS NULL").bind(projectId, teamId).first<{ id: number; team_id: number; name: string; description: string | null; status: "active" | "archived"; created_by: number; created_at: string; updated_at: string }>();
  if (!project) throw new ApiError(404, "NOT_FOUND", "项目不存在或当前用户不可见");
  if (write && project.status !== "active") throw new ApiError(409, "CONFLICT", "归档项目为只读");
  return project;
};

app.use("*", async (c, next) => {
  const id = c.req.header("X-Request-Id") || `req_${crypto.randomUUID()}`;
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
});
app.use("/api/v1/*", cors({
  origin: (origin, c) => {
    const allowed = (c.env.CORS_ORIGINS || "").split(",").map((value: string) => value.trim()).filter(Boolean);
    return origin && allowed.includes(origin) ? origin : allowed[0] || "";
  },
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
}));

app.get("/health", (c) => ok(c, { status: "ok", environment: c.env.ENVIRONMENT }));

app.post("/api/v1/auth/register", async (c) => {
  const body = userSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败", body.error.issues.map((issue) => ({ field: issue.path.join("."), reason: issue.message })));
  if (body.data.password !== body.data.passwordConfirmation) throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败", [{ field: "passwordConfirmation", reason: "两次密码不一致" }]);
  const email = body.data.email.toLowerCase();
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE username = ? OR email = ?").bind(body.data.username, email).first();
  if (exists) throw new ApiError(409, "CONFLICT", "用户名或邮箱已存在");
  const color = await allocateUserColor(c.env.DB);
  const result = await c.env.DB.prepare("INSERT INTO users (username, email, password_hash, color) VALUES (?, ?, ?, ?)").bind(body.data.username, email, await hashPassword(body.data.password), color).run();
  const user = { id: Number(result.meta.last_row_id), username: body.data.username, email, color, systemRole: "member" as const, createdAt: new Date().toISOString() };
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime(CURRENT_TIMESTAMP, ?))").bind(await sha256(token), user.id, `+${Number(c.env.SESSION_TTL_DAYS || 14)} days`).run();
  c.header("Set-Cookie", cookieHeader(token, Number(c.env.SESSION_TTL_DAYS || 14) * 86400));
  return ok(c, { user, onboardingRequired: true }, 201);
});

app.post("/api/v1/auth/login", async (c) => {
  const body = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败");
  const account = body.data.account.includes("@") ? body.data.account.toLowerCase() : body.data.account;
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE username = ? OR email = ?").bind(account, account).first<{ id: number; username: string; email: string; color: string; password_hash: string; system_role: "super_admin" | "member"; failed_login_count: number; locked_until: string | null; created_at: string }>();
  if (!row) throw new ApiError(401, "INVALID_CREDENTIALS", "账号或密码错误");
  if (row.locked_until && row.locked_until > new Date().toISOString()) throw new ApiError(423, "ACCOUNT_LOCKED", "账号已锁定，请稍后再试");
  if (!(await verifyPassword(body.data.password, row.password_hash))) {
    const nextCount = row.failed_login_count + 1;
    await c.env.DB.prepare("UPDATE users SET failed_login_count = ?, locked_until = CASE WHEN ? >= 5 THEN datetime(CURRENT_TIMESTAMP, '+15 minutes') ELSE locked_until END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(nextCount, nextCount, row.id).run();
    throw new ApiError(nextCount >= 5 ? 423 : 401, nextCount >= 5 ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS", nextCount >= 5 ? "账号已锁定，请稍后再试" : "账号或密码错误");
  }
  await c.env.DB.prepare("UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime(CURRENT_TIMESTAMP, ?))").bind(await sha256(token), row.id, `+${Number(c.env.SESSION_TTL_DAYS || 14)} days`).run();
  c.header("Set-Cookie", cookieHeader(token, Number(c.env.SESSION_TTL_DAYS || 14) * 86400));
  return ok(c, { user: { id: String(row.id), username: row.username, email: row.email, color: row.color, systemRole: row.system_role, createdAt: row.created_at }, onboardingRequired: false });
});

app.use("/api/v1/*", authRequired);
app.post("/api/v1/auth/logout", async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(currentAuth(c).tokenHash).run();
  c.header("Set-Cookie", cookieHeader("", 0));
  return ok(c, null);
});
app.get("/api/v1/auth/me", async (c) => {
  const auth = currentAuth(c);
  const teams = await c.env.DB.prepare(`
    SELECT t.id, t.name, t.description, t.status, t.created_by, t.created_at, t.updated_at
    FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE tm.user_id = ? ORDER BY t.name
  `).bind(auth.user.id).all();
  return ok(c, { user: auth.user, teams: teams.results.map((team) => ({ id: String(team.id), name: team.name, description: team.description, status: team.status, createdAt: team.created_at, updatedAt: team.updated_at })) });
});

app.get("/api/v1/teams", async (c) => {
  const auth = currentAuth(c);
  const result = auth.user.systemRole === "super_admin"
    ? await c.env.DB.prepare("SELECT * FROM teams ORDER BY name").all()
    : await c.env.DB.prepare("SELECT t.* FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE tm.user_id = ? ORDER BY t.name").bind(auth.user.id).all();
  return ok(c, result.results);
});
app.post("/api/v1/teams", async (c) => {
  requireAdmin(c);
  const body = await jsonBody(c, z.object({ name: z.string().min(2).max(64), description: z.string().max(500).nullable().optional() }));
  const auth = currentAuth(c);
  const result = await c.env.DB.prepare("INSERT INTO teams (name, description, created_by) VALUES (?, ?, ?)").bind(body.name, body.description ?? null, auth.user.id).run();
  await c.env.DB.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").bind(result.meta.last_row_id, auth.user.id).run();
  return ok(c, { id: String(result.meta.last_row_id), ...body, status: "active", createdBy: auth.user, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, 201);
});

app.patch("/api/v1/users/me", async (c) => {
  const auth = currentAuth(c);
  const body = await jsonBody(c, z.object({ username: z.string().min(2).max(32).optional(), email: z.string().email().max(255).optional() }).refine((value) => Object.keys(value).length > 0));
  const email = body.email?.toLowerCase();
  const conflict = await c.env.DB.prepare("SELECT id FROM users WHERE (username = ? OR email = ?) AND id <> ?").bind(body.username ?? "", email ?? "", auth.user.id).first();
  if (conflict) throw new ApiError(409, "CONFLICT", "用户名或邮箱已存在");
  await c.env.DB.prepare("UPDATE users SET username = COALESCE(?, username), email = COALESCE(?, email), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(body.username ?? null, email ?? null, auth.user.id).run();
  const updated = await c.env.DB.prepare("SELECT id, username, email, color, system_role, created_at FROM users WHERE id = ?").bind(auth.user.id).first<{ id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string }>();
  return ok(c, updated ? rowUser(updated) : auth.user);
});

app.get("/api/v1/teams/:teamId", async (c) => {
  const team = await teamAccess(c, id(c.req.param("teamId")));
  const creator = await c.env.DB.prepare("SELECT id, username, email, color, system_role, created_at FROM users WHERE id = ?").bind(team.created_by).first<{ id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string }>();
  return ok(c, { id: String(team.id), name: team.name, description: team.description, status: team.status, createdBy: creator ? rowUser(creator) : null, createdAt: team.created_at, updatedAt: team.updated_at });
});

app.patch("/api/v1/teams/:teamId", async (c) => {
  requireAdmin(c);
  const teamId = id(c.req.param("teamId"));
  const team = await teamAccess(c, teamId);
  const body = await jsonBody(c, z.object({ name: z.string().min(2).max(64).optional(), description: z.string().max(500).nullable().optional(), status: z.enum(["active", "archived"]).optional() }).refine((value) => Object.keys(value).length > 0));
  await c.env.DB.prepare("UPDATE teams SET name = COALESCE(?, name), description = CASE WHEN ? THEN ? ELSE description END, status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(body.name ?? null, body.description !== undefined ? 1 : 0, body.description ?? null, body.status ?? null, teamId).run();
  return ok(c, { ...team, ...body, id: String(team.id), updatedAt: new Date().toISOString() });
});

app.get("/api/v1/teams/:teamId/members", async (c) => {
  requireAdmin(c);
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId);
  const members = await c.env.DB.prepare(`
    SELECT u.id, u.username, u.email, u.color, u.system_role, u.created_at
    FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ? ORDER BY u.username
  `).bind(teamId).all<{ id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string }>();
  return ok(c, members.results.map((member) => ({ user: rowUser(member), groups: [] })));
});

app.post("/api/v1/teams/:teamId/members", async (c) => {
  requireAdmin(c);
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId, true);
  const body = await jsonBody(c, z.object({ userId: z.string().regex(/^\d+$/) }));
  const userId = id(body.userId);
  const user = await c.env.DB.prepare("SELECT id, username, email, color, system_role, created_at FROM users WHERE id = ?").bind(userId).first<{ id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string }>();
  if (!user) throw new ApiError(404, "NOT_FOUND", "用户不存在");
  await c.env.DB.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").bind(teamId, userId).run();
  return ok(c, { user: rowUser(user), groups: [] }, 201);
});

app.delete("/api/v1/teams/:teamId/members/:userId", async (c) => {
  requireAdmin(c);
  const teamId = id(c.req.param("teamId"));
  const userId = id(c.req.param("userId"));
  await teamAccess(c, teamId, true);
  const assignments = await c.env.DB.prepare(`
    SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE p.team_id = ? AND t.assignee_id = ? AND t.deleted_at IS NULL LIMIT 1
  `).bind(teamId, userId).first();
  if (assignments) throw new ApiError(409, "MEMBER_HAS_ASSIGNMENTS", "成员仍负责未删除任务");
  const result = await c.env.DB.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").bind(teamId, userId).run();
  if (!result.meta.changes) throw new ApiError(404, "NOT_FOUND", "成员不存在");
  await c.env.DB.prepare("DELETE FROM group_members WHERE user_id = ? AND group_id IN (SELECT id FROM team_groups WHERE team_id = ?)").bind(userId, teamId).run();
  return ok(c, null);
});

const groupDto = (row: { id: number; team_id: number; name: string; description: string | null; status: "active" | "disabled"; member_count?: number }) => ({
  id: String(row.id), teamId: String(row.team_id), name: row.name, description: row.description, status: row.status, memberCount: Number(row.member_count ?? 0),
});

app.get("/api/v1/teams/:teamId/groups", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId);
  const groups = await c.env.DB.prepare(`
    SELECT g.*, COUNT(gm.id) AS member_count
    FROM team_groups g LEFT JOIN group_members gm ON gm.group_id = g.id
    WHERE g.team_id = ? GROUP BY g.id ORDER BY g.name
  `).bind(teamId).all<{ id: number; team_id: number; name: string; description: string | null; status: "active" | "disabled"; member_count: number }>();
  return ok(c, groups.results.map(groupDto));
});

app.post("/api/v1/teams/:teamId/groups", async (c) => {
  requireAdmin(c);
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId, true);
  const body = await jsonBody(c, z.object({ name: z.string().min(1).max(64), description: z.string().max(500).nullable().optional() }));
  const auth = currentAuth(c);
  const result = await c.env.DB.prepare("INSERT INTO team_groups (team_id, name, description, created_by) VALUES (?, ?, ?, ?)")
    .bind(teamId, body.name, body.description ?? null, auth.user.id).run();
  return ok(c, { id: String(result.meta.last_row_id), teamId: String(teamId), ...body, status: "active", memberCount: 0 }, 201);
});

app.patch("/api/v1/teams/:teamId/groups/:groupId", async (c) => {
  requireAdmin(c);
  const teamId = id(c.req.param("teamId"));
  const groupId = id(c.req.param("groupId"));
  await teamAccess(c, teamId, true);
  const group = await c.env.DB.prepare("SELECT * FROM team_groups WHERE id = ? AND team_id = ?").bind(groupId, teamId).first<{ id: number; team_id: number; name: string; description: string | null; status: "active" | "disabled" }>();
  if (!group) throw notFound();
  const body = await jsonBody(c, z.object({ name: z.string().min(1).max(64).optional(), description: z.string().max(500).nullable().optional(), status: z.enum(["active", "disabled"]).optional() }).refine((value) => Object.keys(value).length > 0));
  await c.env.DB.prepare("UPDATE team_groups SET name = COALESCE(?, name), description = CASE WHEN ? THEN ? ELSE description END, status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(body.name ?? null, body.description !== undefined ? 1 : 0, body.description ?? null, body.status ?? null, groupId).run();
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM group_members WHERE group_id = ?").bind(groupId).first<{ count: number }>();
  return ok(c, groupDto({ ...group, ...body, member_count: Number(count?.count ?? 0) }));
});

app.post("/api/v1/teams/:teamId/groups/:groupId/members", async (c) => {
  requireAdmin(c);
  const teamId = id(c.req.param("teamId"));
  const groupId = id(c.req.param("groupId"));
  await teamAccess(c, teamId, true);
  const group = await c.env.DB.prepare("SELECT id, team_id FROM team_groups WHERE id = ? AND team_id = ?").bind(groupId, teamId).first();
  if (!group) throw notFound();
  const body = await jsonBody(c, z.object({ userId: z.string().regex(/^\d+$/) }));
  const userId = id(body.userId);
  const member = await c.env.DB.prepare("SELECT u.id, u.username, u.email, u.color, u.system_role, u.created_at FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE u.id = ? AND tm.team_id = ?").bind(userId, teamId).first<{ id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string }>();
  if (!member) throw new ApiError(409, "CONFLICT", "小组成员必须先属于该团队");
  await c.env.DB.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)").bind(groupId, userId).run();
  return ok(c, { user: rowUser(member), groups: [groupDto({ id: groupId, team_id: teamId, name: "", description: null, status: "active" })] }, 201);
});

app.get("/api/v1/teams/:teamId/groups/:groupId/members", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const groupId = id(c.req.param("groupId"));
  await teamAccess(c, teamId);
  const group = await c.env.DB.prepare("SELECT id FROM team_groups WHERE id = ? AND team_id = ?").bind(groupId, teamId).first();
  if (!group) throw notFound();
  const auth = currentAuth(c);
  if (auth.user.systemRole !== "super_admin") {
    const membership = await c.env.DB.prepare("SELECT id FROM group_members WHERE group_id = ? AND user_id = ?").bind(groupId, auth.user.id).first();
    if (!membership) throw notFound();
  }
  const members = await c.env.DB.prepare(`
    SELECT u.id, u.username, COUNT(t.id) AS open_task_count
    FROM users u
    JOIN group_members gm ON gm.user_id = u.id
    LEFT JOIN tasks t ON t.assignee_id = u.id
      AND t.deleted_at IS NULL
      AND t.status <> 'done'
      AND t.group_id IN (SELECT id FROM team_groups WHERE team_id = ?)
    WHERE gm.group_id = ?
    GROUP BY u.id, u.username
    ORDER BY u.username
  `).bind(teamId, groupId).all<{ id: number; username: string; open_task_count: number }>();
  return ok(c, members.results.map(user => ({ id: String(user.id), username: user.username, openTaskCount: Number(user.open_task_count) })));
});

app.delete("/api/v1/teams/:teamId/groups/:groupId/members/:userId", async (c) => {
  requireAdmin(c);
  const teamId = id(c.req.param("teamId"));
  const groupId = id(c.req.param("groupId"));
  const userId = id(c.req.param("userId"));
  await teamAccess(c, teamId, true);
  const result = await c.env.DB.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").bind(groupId, userId).run();
  if (!result.meta.changes) throw notFound();
  return ok(c, null);
});

const projectDto = (row: { id: number; team_id: number; name: string; description: string | null; status: "active" | "archived"; created_by: number; created_at: string; updated_at: string; task_count?: number }, creator?: ReturnType<typeof rowUser>) => ({
  id: String(row.id), teamId: String(row.team_id), name: row.name, description: row.description, status: row.status, taskCount: Number(row.task_count ?? 0),
  createdBy: creator ?? { id: String(row.created_by), username: "", email: "", color: "#2563EB", systemRole: "member" as const, createdAt: row.created_at }, createdAt: row.created_at, updatedAt: row.updated_at,
});

app.get("/api/v1/teams/:teamId/projects", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId);
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") || 20)));
  const keyword = c.req.query("keyword")?.trim() ?? "";
  const status = c.req.query("status");
  const access = currentAuth(c).user.systemRole === "super_admin" ? "" : "AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = p.team_id AND tm.user_id = ?)";
  const params: (string | number)[] = [teamId];
  let where = "p.team_id = ? AND p.deleted_at IS NULL";
  if (keyword) { where += " AND (p.name LIKE ? OR p.description LIKE ?)"; params.push(`%${keyword}%`, `%${keyword}%`); }
  if (status === "active" || status === "archived") { where += " AND p.status = ?"; params.push(status); }
  if (currentAuth(c).user.systemRole !== "super_admin") params.push(currentAuth(c).user.id);
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM projects p WHERE ${where} ${access}`).bind(...params).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`
    SELECT p.*, COUNT(t.id) AS task_count FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
    WHERE ${where} ${access} GROUP BY p.id ORDER BY p.updated_at DESC LIMIT ? OFFSET ?
  `).bind(...params, pageSize, (page - 1) * pageSize).all<{ id: number; team_id: number; name: string; description: string | null; status: "active" | "archived"; created_by: number; created_at: string; updated_at: string; task_count: number }>();
  return ok(c, rows.results.map((row) => projectDto(row)), 200, { page, pageSize, total: Number(count?.count ?? 0), totalPages: Math.ceil(Number(count?.count ?? 0) / pageSize) });
});

app.post("/api/v1/teams/:teamId/projects", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId, true);
  const body = await jsonBody(c, z.object({ name: z.string().min(2).max(64), description: z.string().max(2000).nullable().optional() }));
  const auth = currentAuth(c);
  if (auth.user.systemRole !== "super_admin") {
    const member = await c.env.DB.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?").bind(teamId, auth.user.id).first();
    if (!member) throw new ApiError(403, "FORBIDDEN", "不属于该团队");
  }
  const result = await c.env.DB.prepare("INSERT INTO projects (team_id, name, description, created_by) VALUES (?, ?, ?, ?)")
    .bind(teamId, body.name, body.description ?? null, auth.user.id).run();
  return ok(c, { id: String(result.meta.last_row_id), teamId: String(teamId), ...body, status: "active", taskCount: 0, createdBy: auth.user, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, 201);
});

app.get("/api/v1/teams/:teamId/projects/:projectId", async (c) => {
  const project = await projectAccess(c, id(c.req.param("teamId")), id(c.req.param("projectId")));
  const creator = await c.env.DB.prepare("SELECT id, username, email, color, system_role, created_at FROM users WHERE id = ?").bind(project.created_by).first<{ id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string }>();
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND deleted_at IS NULL").bind(project.id).first<{ count: number }>();
  return ok(c, projectDto({ ...project, task_count: Number(count?.count ?? 0) }, creator ? rowUser(creator) : undefined));
});

app.patch("/api/v1/teams/:teamId/projects/:projectId", async (c) => {
  requireAdmin(c);
  const projectId = id(c.req.param("projectId"));
  const project = await projectAccess(c, id(c.req.param("teamId")), projectId);
  const body = await jsonBody(c, z.object({ name: z.string().min(2).max(64).optional(), description: z.string().max(2000).nullable().optional(), status: z.enum(["active", "archived"]).optional() }).refine((value) => Object.keys(value).length > 0));
  await c.env.DB.prepare("UPDATE projects SET name = COALESCE(?, name), description = CASE WHEN ? THEN ? ELSE description END, status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(body.name ?? null, body.description !== undefined ? 1 : 0, body.description ?? null, body.status ?? null, projectId).run();
  return ok(c, projectDto({ ...project, ...body, updated_at: new Date().toISOString() }));
});

app.delete("/api/v1/teams/:teamId/projects/:projectId", async (c) => {
  requireAdmin(c);
  const projectId = id(c.req.param("projectId"));
  const project = await projectAccess(c, id(c.req.param("teamId")), projectId);
  if (c.req.query("confirmName") !== project.name) throw new ApiError(400, "VALIDATION_ERROR", "confirmName 与项目名称不一致");
  await c.env.DB.prepare("UPDATE projects SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(projectId).run();
  return ok(c, null);
});

const taskRow = z.object({
  title: z.string().min(1).max(200), detail: z.string().max(10000).nullable().optional(), groupId: z.string().regex(/^\d+$/),
  assigneeId: z.string().regex(/^\d+$/), startDate: taskDateTime.nullable().optional(), endDate: taskDateTime, status: z.enum(["todo", "in_progress", "done"]).optional(), priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});
const taskDto = (row: { id: number; project_id: number; group_id: number; group_team_id: number; group_name: string; group_description: string | null; group_status: "active" | "disabled"; group_member_count: number; title: string; detail: string | null; assignee_id: number; assignee_name: string; assignee_color: string; start_date: string | null; end_date: string; status: "todo" | "in_progress" | "done"; priority: "low" | "medium" | "high" | "urgent"; completed_at: string | null; created_by: number; creator_name: string; created_at: string; updated_at: string }) => ({
  id: String(row.id), projectId: String(row.project_id), group: { id: String(row.group_id), name: row.group_name, status: row.group_status, teamId: String(row.group_team_id), description: row.group_description, memberCount: Number(row.group_member_count) },
  title: row.title, detail: row.detail, assignee: { id: String(row.assignee_id), username: row.assignee_name, color: row.assignee_color }, startDate: row.start_date, endDate: row.end_date, renderStartDate: row.start_date ?? row.end_date, isVirtualStart: row.start_date === null, status: row.status, priority: row.priority, completedAt: row.completed_at, createdBy: { id: String(row.created_by), username: row.creator_name }, createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at),
});
const taskSelect = `
  SELECT t.*, g.team_id AS group_team_id, g.name AS group_name, g.description AS group_description, g.status AS group_status,
    (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS group_member_count,
    a.username AS assignee_name, a.color AS assignee_color, u.username AS creator_name
  FROM tasks t JOIN team_groups g ON g.id = t.group_id JOIN users a ON a.id = t.assignee_id JOIN users u ON u.id = t.created_by
`;
const visibleTask = async (c: AppContext, teamId: number, projectId: number, taskId: number) => {
  const project = await projectAccess(c, teamId, projectId);
  const auth = currentAuth(c);
  const access = auth.user.systemRole === "super_admin" ? "" : "AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = ? AND tm.user_id = ?) AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = ?)";
  const params = auth.user.systemRole === "super_admin" ? [taskId, projectId] : [taskId, projectId, teamId, auth.user.id, auth.user.id];
  const task = await c.env.DB.prepare(`${taskSelect} WHERE t.id = ? AND t.project_id = ? AND t.deleted_at IS NULL ${access}`).bind(...params).first<Parameters<typeof taskDto>[0]>();
  if (!task) throw notFound();
  return { project, task };
};

app.get("/api/v1/teams/:teamId/projects/:projectId/tasks", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  await projectAccess(c, teamId, projectId);
  const auth = currentAuth(c);
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") || 20)));
  const clauses = ["t.project_id = ?", "t.deleted_at IS NULL"];
  const params: (number | string)[] = [projectId];
  if (auth.user.systemRole !== "super_admin") { clauses.push("EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = ? AND tm.user_id = ?)", "EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = ?)"); params.push(teamId, auth.user.id, auth.user.id); }
  for (const [query, column] of [["groupId", "t.group_id"], ["assigneeId", "t.assignee_id"]] as const) if (c.req.query(query)) { clauses.push(`${column} = ?`); params.push(id(c.req.query(query))); }
  for (const column of ["status", "priority"] as const) if (c.req.query(column)) { clauses.push(`t.${column} = ?`); params.push(c.req.query(column)!); }
  const keyword = c.req.query("keyword")?.trim(); if (keyword) { clauses.push("(t.title LIKE ? OR t.detail LIKE ?)"); params.push(`%${keyword}%`, `%${keyword}%`); }
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE ${clauses.join(" AND ")}`).bind(...params).first<{ count: number }>();
  const sort = ({ endDate: "t.end_date", createdAt: "t.created_at", priority: "CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END" } as Record<string, string>)[c.req.query("sortBy") || "endDate"] || "t.end_date";
  const order = c.req.query("sortOrder") === "desc" ? "DESC" : "ASC";
  const rows = await c.env.DB.prepare(`${taskSelect} WHERE ${clauses.join(" AND ")} ORDER BY ${sort} ${order}, t.id ASC LIMIT ? OFFSET ?`).bind(...params, pageSize, (page - 1) * pageSize).all<Parameters<typeof taskDto>[0]>();
  return ok(c, rows.results.map(taskDto), 200, { page, pageSize, total: Number(count?.count ?? 0), totalPages: Math.ceil(Number(count?.count ?? 0) / pageSize) });
});

app.post("/api/v1/teams/:teamId/projects/:projectId/tasks", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const project = await projectAccess(c, teamId, projectId, true);
  const body = await jsonBody(c, taskRow);
  const groupId = id(body.groupId);
  const assigneeId = id(body.assigneeId);
  const group = await c.env.DB.prepare("SELECT id, team_id, status FROM team_groups WHERE id = ? AND team_id = ?").bind(groupId, teamId).first<{ id: number; team_id: number; status: "active" | "disabled" }>();
  if (!group) throw notFound();
  if (group.status !== "active") throw new ApiError(409, "CONFLICT", "停用小组不可创建新任务");
  const auth = currentAuth(c);
  if (auth.user.systemRole !== "super_admin") {
    const member = await c.env.DB.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").bind(groupId, auth.user.id).first();
    if (!member) throw new ApiError(403, "FORBIDDEN", "不属于该任务小组");
  }
  const assignee = await c.env.DB.prepare("SELECT id FROM group_members WHERE group_id = ? AND user_id = ?").bind(groupId, assigneeId).first();
  if (!assignee) throw new ApiError(409, "CONFLICT", "负责人必须属于任务小组");
  if (body.startDate && body.startDate > body.endDate) throw new ApiError(400, "VALIDATION_ERROR", "开始时间不能晚于结束时间");
  const status = body.status ?? "todo";
  const completedAt = status === "done" ? new Date().toISOString() : null;
  const result = await c.env.DB.prepare(`
    INSERT INTO tasks (project_id, group_id, title, detail, assignee_id, start_date, end_date, status, priority, completed_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(project.id, groupId, body.title, body.detail ?? null, assigneeId, body.startDate ?? null, body.endDate, status, body.priority ?? "medium", completedAt, auth.user.id).run();
  const loaded = await visibleTask(c, teamId, projectId, Number(result.meta.last_row_id));
  return ok(c, taskDto(loaded.task), 201);
});

app.get("/api/v1/teams/:teamId/projects/:projectId/tasks/:taskId", async (c) => {
  const loaded = await visibleTask(c, id(c.req.param("teamId")), id(c.req.param("projectId")), id(c.req.param("taskId")));
  return ok(c, taskDto(loaded.task));
});

app.patch("/api/v1/teams/:teamId/projects/:projectId/tasks/:taskId", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const taskId = id(c.req.param("taskId"));
  const loaded = await visibleTask(c, teamId, projectId, taskId);
  const body = await jsonBody(c, z.object({ ...taskRow.shape, expectedUpdatedAt: z.string().datetime().optional() }).partial().refine((value) => Object.keys(value).length > 0));
  if (body.startDate && body.endDate && body.startDate > body.endDate) throw new ApiError(400, "VALIDATION_ERROR", "开始时间不能晚于结束时间");
  let groupId = body.groupId ? id(body.groupId) : loaded.task.group_id;
  const assigneeId = body.assigneeId ? id(body.assigneeId) : loaded.task.assignee_id;
  if (body.groupId || body.assigneeId) {
    const group = await c.env.DB.prepare("SELECT id, status FROM team_groups WHERE id = ? AND team_id = ?").bind(groupId, teamId).first<{ id: number; status: "active" | "disabled" }>();
    if (!group) throw notFound();
    const assignee = await c.env.DB.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").bind(groupId, assigneeId).first();
    if (!assignee) throw new ApiError(409, "CONFLICT", "负责人必须属于任务小组");
  }
  const status = body.status ?? loaded.task.status;
  const completedAt = status === "done" ? (loaded.task.completed_at ?? new Date().toISOString()) : null;
  await projectAccess(c, teamId, projectId, true);
  const startDate = body.startDate === undefined ? loaded.task.start_date : body.startDate;
  if (startDate && startDate > (body.endDate ?? loaded.task.end_date)) throw new ApiError(400, "VALIDATION_ERROR", "开始时间不能晚于结束时间");
  if (body.expectedUpdatedAt && body.expectedUpdatedAt !== isoTimestamp(loaded.task.updated_at)) throw new ApiError(409, "VERSION_CONFLICT", "任务已被其他请求更新，请重新加载");
  const expected = loaded.task.updated_at;
  const result = await c.env.DB.prepare(`
    UPDATE tasks SET title = COALESCE(?, title), detail = CASE WHEN ? THEN ? ELSE detail END, group_id = ?, assignee_id = ?,
    start_date = CASE WHEN ? THEN ? ELSE start_date END, end_date = COALESCE(?, end_date), status = ?, priority = COALESCE(?, priority),
    completed_at = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND updated_at = ?
  `).bind(body.title ?? null, body.detail !== undefined ? 1 : 0, body.detail ?? null, groupId, assigneeId, body.startDate !== undefined ? 1 : 0, body.startDate ?? null, body.endDate ?? null, status, body.priority ?? null, completedAt, nextTaskVersion(expected), taskId, projectId, expected).run();
  if (!result.meta.changes) throw new ApiError(409, "VERSION_CONFLICT", "任务已被其他请求更新，请重新加载");
  const fresh = await visibleTask(c, teamId, projectId, taskId);
  return ok(c, taskDto(fresh.task));
});

app.delete("/api/v1/teams/:teamId/projects/:projectId/tasks/:taskId", async (c) => {
  requireAdmin(c);
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const taskId = id(c.req.param("taskId"));
  await projectAccess(c, teamId, projectId);
  const result = await c.env.DB.prepare("UPDATE tasks SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ? AND deleted_at IS NULL").bind(taskId, projectId).run();
  if (!result.meta.changes) throw notFound();
  return ok(c, null);
});

app.patch("/api/v1/teams/:teamId/projects/:projectId/tasks/:taskId/schedule", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const taskId = id(c.req.param("taskId"));
  const loaded = await visibleTask(c, teamId, projectId, taskId);
  const body = await jsonBody(c, z.object({ startDate: taskDateTime.nullable().optional(), endDate: taskDateTime, expectedUpdatedAt: z.string().datetime() }));
  await projectAccess(c, teamId, projectId, true);
  if (body.expectedUpdatedAt !== isoTimestamp(loaded.task.updated_at)) throw new ApiError(409, "VERSION_CONFLICT", "任务排期已被其他请求更新，请重新加载");
  if (body.startDate && body.startDate > body.endDate) throw new ApiError(400, "VALIDATION_ERROR", "开始时间不能晚于结束时间");
  const result = await c.env.DB.prepare("UPDATE tasks SET start_date = ?, end_date = ?, updated_at = ? WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND updated_at = ?")
    .bind(body.startDate ?? null, body.endDate, nextTaskVersion(loaded.task.updated_at), taskId, projectId, loaded.task.updated_at).run();
  if (!result.meta.changes) throw new ApiError(409, "VERSION_CONFLICT", "任务排期已被其他请求更新，请重新加载");
  const fresh = await visibleTask(c, teamId, projectId, taskId);
  return ok(c, taskDto(fresh.task));
});

app.get("/api/v1/teams/:teamId/projects/:projectId/gantt", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const project = await projectAccess(c, teamId, projectId);
  const auth = currentAuth(c);
  const params: (number | string)[] = [projectId];
  const clauses = ["t.project_id = ?", "t.deleted_at IS NULL"];
  if (auth.user.systemRole !== "super_admin") { clauses.push("EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = ?)"); params.push(auth.user.id); }
  const rows = await c.env.DB.prepare(`${taskSelect} WHERE ${clauses.join(" AND ")} ORDER BY t.end_date, t.id`).bind(...params).all<Parameters<typeof taskDto>[0]>();
  const tasks = rows.results.map(taskDto);
  const dates = tasks.flatMap((task) => [task.renderStartDate, task.endDate]).sort();
  const shift = (value: string, days: number) => { const d = new Date(Date.parse(`${value.slice(0, 10)}T00:00:00Z`)); d.setUTCDate(d.getUTCDate() + days); return `${d.toISOString().slice(0, 10)}T00:00`; };
  const today = `${new Date().toISOString().slice(0, 10)}T00:00`;
  return ok(c, { project: projectDto(project), range: { startDate: dates.length ? shift(dates[0], -3) : today, endDate: dates.length ? shift(dates.at(-1)!, 3) : today, granularity: c.req.query("granularity") || "week" }, tasks });
});

app.get("/api/v1/teams/:teamId/dashboard", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId);
  const auth = currentAuth(c);
  const visible = auth.user.systemRole === "super_admin" ? "" : "AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = t.group_id AND gm.user_id = ?)";
  const bind = auth.user.systemRole === "super_admin" ? [teamId] : [teamId, auth.user.id];
  const stats = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM projects p WHERE p.team_id = ? AND p.status = 'active' AND p.deleted_at IS NULL) AS in_progress_project_count,
      COUNT(t.id) AS visible_task_count,
      SUM(CASE WHEN t.assignee_id = ? AND t.status <> 'done' THEN 1 ELSE 0 END) AS my_open_task_count,
      SUM(CASE WHEN t.status <> 'done' AND substr(t.end_date, 1, 10) < date('now') THEN 1 ELSE 0 END) AS overdue_task_count,
      SUM(CASE WHEN t.status <> 'done' AND substr(t.end_date, 1, 10) >= date('now') AND substr(t.end_date, 1, 10) <= date('now', '+7 day') THEN 1 ELSE 0 END) AS upcoming_deadline_count
    FROM tasks t JOIN projects p ON p.id = t.project_id AND p.team_id = ? AND p.deleted_at IS NULL
    WHERE t.deleted_at IS NULL ${visible}
  `).bind(teamId, auth.user.id, teamId, ...(auth.user.systemRole === "super_admin" ? [] : [auth.user.id])).first<{ in_progress_project_count: number; visible_task_count: number; my_open_task_count: number; overdue_task_count: number; upcoming_deadline_count: number }>();
  const recent = await c.env.DB.prepare("SELECT * FROM projects WHERE team_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5").bind(teamId).all<Parameters<typeof projectDto>[0]>();
  const deadlines = await c.env.DB.prepare(`${taskSelect} WHERE t.deleted_at IS NULL AND substr(t.end_date, 1, 10) >= date('now') AND substr(t.end_date, 1, 10) <= date('now', '+7 day') AND t.project_id IN (SELECT id FROM projects WHERE team_id = ? AND deleted_at IS NULL) ${visible} ORDER BY t.end_date LIMIT 5`).bind(teamId, ...(auth.user.systemRole === "super_admin" ? [] : [auth.user.id])).all<Parameters<typeof taskDto>[0]>();
  return ok(c, { inProgressProjectCount: Number(stats?.in_progress_project_count ?? 0), visibleTaskCount: Number(stats?.visible_task_count ?? 0), myOpenTaskCount: Number(stats?.my_open_task_count ?? 0), overdueTaskCount: Number(stats?.overdue_task_count ?? 0), upcomingDeadlineCount: Number(stats?.upcoming_deadline_count ?? 0), recentProjects: recent.results.map((row) => projectDto(row)), upcomingDeadlines: deadlines.results.map(taskDto) });
});

app.get("/api/v1/admin/overview", async (c) => {
  requireAdmin(c);
  const row = await c.env.DB.prepare(`
    SELECT (SELECT COUNT(*) FROM users) AS user_count, (SELECT COUNT(*) FROM teams WHERE status = 'active') AS active_team_count,
    (SELECT COUNT(*) FROM projects WHERE status = 'active' AND deleted_at IS NULL) AS in_progress_project_count,
    (SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL) AS task_count
  `).first<{ user_count: number; active_team_count: number; in_progress_project_count: number; task_count: number }>();
  return ok(c, { userCount: Number(row?.user_count ?? 0), activeTeamCount: Number(row?.active_team_count ?? 0), inProgressProjectCount: Number(row?.in_progress_project_count ?? 0), taskCount: Number(row?.task_count ?? 0) });
});

app.get("/api/v1/admin/users", async (c) => {
  requireAdmin(c);
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") || 20)));
  const keyword = c.req.query("keyword")?.trim() ?? "";
  const role = c.req.query("systemRole");
  const clauses = ["1 = 1"];
  const params: (number | string)[] = [];
  if (keyword) { clauses.push("(username LIKE ? OR email LIKE ?)"); params.push(`%${keyword}%`, `%${keyword}%`); }
  if (role === "member" || role === "super_admin") { clauses.push("system_role = ?"); params.push(role); }
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM users WHERE ${clauses.join(" AND ")}`).bind(...params).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`SELECT id, username, email, color, system_role, created_at FROM users WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...params, pageSize, (page - 1) * pageSize).all<{ id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string }>();
  return ok(c, rows.results.map(rowUser), 200, { page, pageSize, total: Number(count?.count ?? 0), totalPages: Math.ceil(Number(count?.count ?? 0) / pageSize) });
});

app.patch("/api/v1/admin/users/:userId/role", async (c) => {
  requireAdmin(c);
  const userId = id(c.req.param("userId"));
  const body = await jsonBody(c, z.object({ systemRole: z.enum(["super_admin", "member"]) }));
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!user) throw notFound();
  if (userId === currentAuth(c).user.id && body.systemRole !== "super_admin") throw new ApiError(409, "CONFLICT", "不能撤销当前账号的超级管理员权限");
  await c.env.DB.prepare("UPDATE users SET system_role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(body.systemRole, userId).run();
  const updated = await c.env.DB.prepare("SELECT id, username, email, color, system_role, created_at FROM users WHERE id = ?").bind(userId).first<{ id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string }>();
  return ok(c, updated ? rowUser(updated) : null);
});

app.onError((error, c) => {
  if (error instanceof ApiError) return fail(c, error.code, error.message, error.status, error.details);
  console.error(JSON.stringify({ requestId: c.get("requestId"), error: error.message }));
  return fail(c, "INTERNAL_ERROR", "服务器内部错误", 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env) {
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
    console.log(JSON.stringify({ event: "session_cleanup", scheduledTime: controller.scheduledTime }));
  },
};
