import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { authRequired, cookieHeader, currentAuth } from "./shared/auth";
import { hashPassword, randomToken, sha256, verifyPassword } from "./shared/crypto";
import { ApiError, notFound } from "./shared/errors";
import { fail, ok } from "./shared/response";
import { isoTimestamp, nextTaskVersion, nowIso, shanghaiToday } from "./shared/task-version";
import { allocateUserColor } from "./shared/user-color";
import { projectAccess, requireTeamAdmin, teamAccess, type AccessContext, type ProjectRow, type TeamRow } from "./shared/access";
import { auditStatement } from "./shared/audit";
import { clearFeedbackAttempt, feedbackSchema, isFeedbackRateLimited, recordFeedbackAttempt, sendFeedbackToTelegram } from "./shared/feedback";

type App = { Bindings: Env; Variables: { requestId: string; auth: ReturnType<typeof currentAuth> } };
type AppContext = Context<App>;
const app = new Hono<App>();

const taskDateTime = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):(?:00|30)$/, "任务时间格式必须为 YYYY-MM-DDTHH:mm，且按 30 分钟对齐")
  .refine((value) => {
    const parsed = Date.parse(`${value}:00Z`);
    return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value.slice(0, 10);
  }, "任务时间不存在");

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

type PublicUserRow = { id: number; username: string; color: string };
const publicUser = (row: PublicUserRow) => ({ id: String(row.id), username: row.username, color: row.color });
type AccountRow = { id: number; username: string; email: string; color: string; system_role: "super_admin" | "member"; created_at: string };
const accountDto = (row: AccountRow) => ({ id: String(row.id), username: row.username, email: row.email, color: row.color, systemRole: row.system_role, createdAt: row.created_at });

type TeamListRow = TeamRow & { role: "admin" | "member"; member_count: number };
const teamDto = (row: TeamRow & { role?: "admin" | "member"; member_count?: number }) => ({
  id: String(row.id),
  name: row.name,
  description: row.description,
  status: row.status,
  createdBy: { id: String(row.created_by), username: "", color: "#2563EB" },
  role: row.role ?? "member",
  memberCount: Number(row.member_count ?? 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

type ProjectListRow = ProjectRow & { task_count?: number };
const projectDto = (row: ProjectListRow) => ({
  id: String(row.id),
  teamId: String(row.team_id),
  name: row.name,
  description: row.description,
  status: row.status,
  taskCount: Number(row.task_count ?? 0),
  createdBy: { id: String(row.created_by), username: "", color: "#2563EB" },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

type TaskDtoRow = {
  id: number;
  project_id: number;
  team_id: number;
  title: string;
  detail: string | null;
  assignee_id: number;
  assignee_name: string;
  assignee_color: string;
  assignee_member_status: string | null;
  start_date: string | null;
  end_date: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  completed_at: string | null;
  created_by: number;
  creator_name: string;
  updated_by: number | null;
  updater_name: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

const taskDto = (row: TaskDtoRow) => ({
  id: String(row.id),
  teamId: String(row.team_id),
  projectId: String(row.project_id),
  title: row.title,
  detail: row.detail,
  assignee: {
    id: String(row.assignee_id),
    username: row.assignee_name,
    color: row.assignee_color,
    isActiveMember: row.assignee_member_status === "active",
  },
  startDate: row.start_date,
  endDate: row.end_date,
  renderStartDate: row.start_date ?? row.end_date,
  isVirtualStart: row.start_date === null,
  status: row.status,
  priority: row.priority,
  completedAt: row.completed_at,
  createdBy: { id: String(row.created_by), username: row.creator_name },
  updatedBy: row.updated_by === null ? null : { id: String(row.updated_by), username: row.updater_name ?? "" },
  createdAt: isoTimestamp(row.created_at),
  updatedAt: isoTimestamp(row.updated_at),
});

const taskSelect = `
  SELECT t.*, p.team_id, a.username AS assignee_name, a.color AS assignee_color,
    am.status AS assignee_member_status, c.username AS creator_name, u.username AS updater_name
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  JOIN users a ON a.id = t.assignee_id
  JOIN users c ON c.id = t.created_by
  LEFT JOIN users u ON u.id = t.updated_by
  LEFT JOIN team_members am ON am.team_id = p.team_id AND am.user_id = t.assignee_id
`;

const versionMismatch = (message = "资源已被其他请求更新，请重新加载") => new ApiError(409, "VERSION_CONFLICT", message);
const assertVersion = (expected: string, actual: string) => {
  if (expected !== isoTimestamp(actual)) throw versionMismatch();
};
const pageParams = (c: AppContext) => {
  const page = Number(c.req.query("page") || 1);
  const pageSize = Number(c.req.query("pageSize") || 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new ApiError(400, "VALIDATION_ERROR", "分页参数无效");
  return { page, pageSize, offset: (page - 1) * pageSize };
};
const pagination = (page: number, pageSize: number, total: number) => ({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
const retired = (c: AppContext) => c.json({ data: null, meta: { requestId: c.get("requestId"), pagination: null } }, 410);

app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") || `req_${crypto.randomUUID()}`;
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
});
app.use("/api/v1/*", cors({
  origin: (origin, c) => {
    const allowed = (c.env.CORS_ORIGINS || "").split(",").map((value: string) => value.trim()).filter(Boolean);
    return origin && allowed.includes(origin) ? origin : allowed[0] || "";
  },
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization", "X-Request-Id", "Idempotency-Key"],
}));

app.get("/health", (c) => ok(c, { status: "ok", environment: c.env.ENVIRONMENT }));

const userSchema = z.object({ username: z.string().min(2).max(32), email: z.string().email().max(255), password: z.string().min(8), passwordConfirmation: z.string().min(8) });
app.post("/api/v1/auth/register", async (c) => {
  const body = await jsonBody(c, userSchema);
  if (body.password !== body.passwordConfirmation) throw new ApiError(400, "VALIDATION_ERROR", "请求参数校验失败", [{ field: "passwordConfirmation", reason: "两次密码不一致" }]);
  const email = body.email.toLowerCase();
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE username = ? OR email = ?").bind(body.username, email).first();
  if (exists) throw new ApiError(409, "CONFLICT", "用户名或邮箱已存在");
  const color = await allocateUserColor(c.env.DB);
  const result = await c.env.DB.prepare("INSERT INTO users (username, email, password_hash, color) VALUES (?, ?, ?, ?)").bind(body.username, email, await hashPassword(body.password), color).run();
  const user = { id: Number(result.meta.last_row_id), username: body.username, email, color, systemRole: "member" as const, createdAt: nowIso() };
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime(CURRENT_TIMESTAMP, ?))").bind(await sha256(token), user.id, `+${Number(c.env.SESSION_TTL_DAYS || 14)} days`).run();
  c.header("Set-Cookie", cookieHeader(token, Number(c.env.SESSION_TTL_DAYS || 14) * 86400));
  return ok(c, { user, onboardingRequired: true }, 201);
});

const loginSchema = z.object({ account: z.string().min(1).max(255), password: z.string().min(1) });
app.post("/api/v1/auth/login", async (c) => {
  const body = await jsonBody(c, loginSchema);
  const account = body.account.includes("@") ? body.account.toLowerCase() : body.account;
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE username = ? OR email = ?").bind(account, account).first<AccountRow & { password_hash: string; failed_login_count: number; locked_until: string | null }>();
  if (!row) throw new ApiError(401, "INVALID_CREDENTIALS", "账号或密码错误");
  if (row.locked_until && row.locked_until > nowIso()) throw new ApiError(423, "ACCOUNT_LOCKED", "账号已锁定，请稍后再试");
  if (!(await verifyPassword(body.password, row.password_hash))) {
    const nextCount = row.failed_login_count + 1;
    await c.env.DB.prepare("UPDATE users SET failed_login_count = ?, locked_until = CASE WHEN ? >= 5 THEN datetime(CURRENT_TIMESTAMP, '+15 minutes') ELSE locked_until END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(nextCount, nextCount, row.id).run();
    throw new ApiError(nextCount >= 5 ? 423 : 401, nextCount >= 5 ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS", nextCount >= 5 ? "账号已锁定，请稍后再重试" : "账号或密码错误");
  }
  await c.env.DB.prepare("UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
  const token = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime(CURRENT_TIMESTAMP, ?))").bind(await sha256(token), row.id, `+${Number(c.env.SESSION_TTL_DAYS || 14)} days`).run();
  c.header("Set-Cookie", cookieHeader(token, Number(c.env.SESSION_TTL_DAYS || 14) * 86400));
  return ok(c, { user: accountDto(row), onboardingRequired: false });
});

app.post("/api/v1/public/feedback", async (c) => {
  const body = await jsonBody(c, feedbackSchema);
  const ip = c.req.header("CF-Connecting-IP")?.trim() || "unknown";
  const ipHash = await sha256(`welo-feedback:${ip}`);
  if (await isFeedbackRateLimited(c.env.DB, ipHash)) throw new ApiError(429, "RATE_LIMITED", "留言提交过于频繁，请稍后再试");
  const attemptId = await recordFeedbackAttempt(c.env.DB, ipHash);
  try {
    await sendFeedbackToTelegram(c.env, body);
  } catch (error) {
    // A failed Telegram delivery is not a successful submission. Release the
    // reservation so the visitor can retry once the upstream service recovers.
    try {
      await clearFeedbackAttempt(c.env.DB, attemptId);
    } catch {
      // Preserve the original, user-safe Telegram error if cleanup itself fails.
    }
    throw error;
  }
  return ok(c, { status: "sent" }, 201);
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
    SELECT t.*, CASE WHEN t.created_by = ? THEN 'admin' ELSE 'member' END AS role,
      (SELECT COUNT(*) FROM team_members mc WHERE mc.team_id = t.id AND mc.status = 'active') AS member_count
    FROM teams t JOIN team_members m ON m.team_id = t.id
    WHERE m.user_id = ? AND m.status = 'active'
    ORDER BY t.name, t.id
  `).bind(auth.user.id, auth.user.id).all<TeamListRow>();
  const invitations = await c.env.DB.prepare(`
    SELECT COUNT(*) AS count FROM team_invitations
    WHERE invitee_user_id = ? AND status = 'pending' AND expires_at > ?
  `).bind(auth.user.id, nowIso()).first<{ count: number }>();
  return ok(c, {
    user: auth.user,
    teams: teams.results.map(teamDto),
    pendingInvitationCount: Number(invitations?.count ?? 0),
    onboardingRequired: teams.results.length === 0,
  });
});

app.patch("/api/v1/users/me", async (c) => {
  const auth = currentAuth(c);
  const body = await jsonBody(c, z.object({ username: z.string().min(2).max(32).optional(), email: z.string().email().max(255).optional() }).refine((value) => Object.keys(value).length > 0));
  const email = body.email?.toLowerCase();
  const conflict = await c.env.DB.prepare("SELECT id FROM users WHERE (username = ? OR email = ?) AND id <> ?").bind(body.username ?? "", email ?? "", auth.user.id).first();
  if (conflict) throw new ApiError(409, "CONFLICT", "用户名或邮箱已存在");
  await c.env.DB.prepare("UPDATE users SET username = COALESCE(?, username), email = COALESCE(?, email), updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(body.username ?? null, email ?? null, auth.user.id).run();
  const updated = await c.env.DB.prepare("SELECT id, username, email, color, system_role, created_at FROM users WHERE id = ?").bind(auth.user.id).first<AccountRow>();
  return ok(c, updated ? accountDto(updated) : auth.user);
});

const fallbackCreator = (id: number) => ({ id: String(id), username: "", color: "#2563EB" });
const teamListDto = async (c: AppContext, row: TeamRow) => {
  const creator = await c.env.DB.prepare("SELECT id, username, color FROM users WHERE id = ?").bind(row.created_by).first<PublicUserRow>();
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM team_members WHERE team_id = ? AND status = 'active'").bind(row.id).first<{ count: number }>();
  return {
    ...teamDto(row),
    role: row.created_by === currentAuth(c).user.id ? ("admin" as const) : ("member" as const),
    memberCount: Number(count?.count ?? 0),
    createdBy: creator ? publicUser(creator) : fallbackCreator(row.created_by),
  };
};

app.get("/api/v1/teams", async (c) => {
  const auth = currentAuth(c);
  const result = await c.env.DB.prepare(`
    SELECT t.*, CASE WHEN t.created_by = ? THEN 'admin' ELSE 'member' END AS role,
      (SELECT COUNT(*) FROM team_members mc WHERE mc.team_id = t.id AND mc.status = 'active') AS member_count
    FROM teams t JOIN team_members m ON m.team_id = t.id
    WHERE m.user_id = ? AND m.status = 'active'
    ORDER BY t.name, t.id
  `).bind(auth.user.id, auth.user.id).all<TeamListRow>();
  const creatorRows = await c.env.DB.prepare(`
    SELECT DISTINCT u.id, u.username, u.color FROM users u
    JOIN teams t ON t.created_by = u.id
    WHERE t.id IN (SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active')
  `).bind(auth.user.id).all<PublicUserRow>();
  const creators = new Map(creatorRows.results.map((row) => [String(row.id), publicUser(row)]));
  return ok(c, result.results.map((row) => ({ ...teamDto(row), createdBy: creators.get(String(row.created_by)) ?? fallbackCreator(row.created_by) })));
});

const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(64),
  description: z.string().max(500).nullable().optional(),
}).strict();

app.post("/api/v1/teams", async (c) => {
  const auth = currentAuth(c);
  const body = await jsonBody(c, createTeamSchema);
  const key = c.req.header("Idempotency-Key")?.trim();
  if (!key || key.length < 8 || key.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "创建团队必须提供 8-255 位 Idempotency-Key");
  const requestHash = await sha256(JSON.stringify(body));
  const existing = await c.env.DB.prepare("SELECT id, request_hash, resource_id, expires_at FROM idempotency_keys WHERE user_id = ? AND operation = 'create_team' AND key = ?").bind(auth.user.id, key).first<{ id: number; request_hash: string; resource_id: string; expires_at: string }>();
  if (existing && existing.expires_at > nowIso()) {
    if (existing.request_hash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "相同幂等键已绑定不同请求");
    const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(Number(existing.resource_id)).first<TeamRow>();
    if (!team) throw notFound();
    return ok(c, await teamListDto(c, team));
  }
  if (existing) await c.env.DB.prepare("DELETE FROM idempotency_keys WHERE id = ?").bind(existing.id).run();
  const createdAt = nowIso();
  const inserted = await c.env.DB.prepare("INSERT INTO teams (name, description, created_by, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(body.name, body.description ?? null, auth.user.id, createdAt, createdAt, auth.user.id).first<{ id: number }>();
  const teamId = Number(inserted?.id);
  const expires = new Date(Date.now() + 86400000).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO idempotency_keys (user_id, operation, key, request_hash, resource_id, created_at, expires_at) VALUES (?, 'create_team', ?, ?, ?, ?, ?)").bind(auth.user.id, key, requestHash, String(teamId), createdAt, expires),
    auditStatement(c, teamId, auth.user.id, "team.created", "team", teamId, null, { id: String(teamId), name: body.name, description: body.description ?? null }),
  ]);
  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId).first<TeamRow>();
  if (!team) throw notFound();
  return ok(c, await teamListDto(c, team), 201);
});

app.get("/api/v1/teams/:teamId", async (c) => {
  const access = await teamAccess(c, id(c.req.param("teamId")));
  return ok(c, await teamListDto(c, access.team));
});

const teamPatchSchema = z.object({
  name: z.string().trim().min(2).max(64).optional(),
  description: z.string().max(500).nullable().optional(),
  expectedUpdatedAt: z.string().datetime(),
}).strict().refine(({ name, description }) => name !== undefined || description !== undefined);

app.patch("/api/v1/teams/:teamId", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const access = await teamAccess(c, teamId, true);
  const body = await jsonBody(c, teamPatchSchema);
  assertVersion(body.expectedUpdatedAt, access.team.updated_at);
  const before = teamDto(access.team);
  const updatedAt = nextTaskVersion(access.team.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE teams SET name = COALESCE(?, name), description = CASE WHEN ? THEN ? ELSE description END,
        updated_at = ?, updated_by = ? WHERE id = ? AND updated_at = ? AND status = 'active'
    `).bind(body.name ?? null, body.description !== undefined ? 1 : 0, body.description ?? null, updatedAt, currentAuth(c).user.id, teamId, access.team.updated_at),
    c.env.DB.prepare(`
      INSERT INTO audit_logs (team_id, actor_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at)
      SELECT ?, ?, 'team.updated', 'team', ?, ?, json_object('name', name, 'description', description, 'updatedAt', updated_at), ?, ?
      FROM teams WHERE id = ? AND updated_at = ? AND updated_by = ?
    `).bind(teamId, currentAuth(c).user.id, String(teamId), JSON.stringify(before), c.get("requestId"), updatedAt, teamId, updatedAt, currentAuth(c).user.id),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId).first<TeamRow>();
  if (!team) throw notFound();
  return ok(c, await teamListDto(c, team));
});

app.post("/api/v1/teams/:teamId/archive", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const access = await teamAccess(c, teamId, true);
  const body = await jsonBody(c, z.object({ expectedUpdatedAt: z.string().datetime() }).strict());
  assertVersion(body.expectedUpdatedAt, access.team.updated_at);
  const updatedAt = nextTaskVersion(access.team.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE teams SET status = 'archived', updated_at = ?, updated_by = ? WHERE id = ? AND status = 'active' AND updated_at = ?").bind(updatedAt, currentAuth(c).user.id, teamId, access.team.updated_at),
    auditStatement(c, teamId, currentAuth(c).user.id, "team.archived", "team", teamId, { status: "active", updatedAt: body.expectedUpdatedAt }, { status: "archived", updatedAt }),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId).first<TeamRow>();
  if (!team) throw notFound();
  return ok(c, await teamListDto(c, team));
});

app.post("/api/v1/teams/:teamId/restore", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const access = await teamAccess(c, teamId);
  if (access.team.status !== "archived") throw new ApiError(409, "CONFLICT", "团队不是归档状态");
  const body = await jsonBody(c, z.object({ expectedUpdatedAt: z.string().datetime() }).strict());
  assertVersion(body.expectedUpdatedAt, access.team.updated_at);
  const updatedAt = nextTaskVersion(access.team.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE teams SET status = 'active', updated_at = ?, updated_by = ? WHERE id = ? AND status = 'archived' AND updated_at = ?").bind(updatedAt, currentAuth(c).user.id, teamId, access.team.updated_at),
    auditStatement(c, teamId, currentAuth(c).user.id, "team.restored", "team", teamId, { status: "archived", updatedAt: body.expectedUpdatedAt }, { status: "active", updatedAt }),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(teamId).first<TeamRow>();
  if (!team) throw notFound();
  return ok(c, await teamListDto(c, team));
});

type MemberRow = {
  user_id: number; username: string; color: string; status: "active" | "removed" | "left";
  joined_at: string | null; ended_at: string | null; ended_by: number | null;
  open_task_count: number; is_admin: 0 | 1;
};
app.get("/api/v1/teams/:teamId/members", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId);
  const status = c.req.query("status");
  const filter = status === "active" || status === "removed" || status === "left" ? status : "active";
  const rows = await c.env.DB.prepare(`
    SELECT m.user_id, u.username, u.color, m.status, m.joined_at, m.ended_at, m.ended_by,
      CASE WHEN t.created_by = m.user_id THEN 1 ELSE 0 END AS is_admin,
      (SELECT COUNT(*) FROM tasks tk JOIN projects p ON p.id = tk.project_id
       WHERE p.team_id = ? AND tk.assignee_id = m.user_id AND tk.deleted_at IS NULL AND tk.status <> 'done') AS open_task_count
    FROM team_members m JOIN users u ON u.id = m.user_id JOIN teams t ON t.id = m.team_id
    WHERE m.team_id = ? AND m.status = ? ORDER BY u.username, m.user_id
  `).bind(teamId, teamId, filter).all<MemberRow>();
  return ok(c, rows.results.map((row) => ({
    user: publicUser({ id: row.user_id, username: row.username, color: row.color }),
    role: row.is_admin ? "admin" : "member",
    status: row.status,
    joinedAt: row.joined_at,
    endedAt: row.ended_at,
    openTaskCount: Number(row.open_task_count),
    isActiveMember: row.status === "active",
  })));
});

app.post("/api/v1/teams/:teamId/members", (c) => retired(c));

const removeMember = async (c: AppContext, teamId: number, userId: number, status: "removed" | "left") => {
  await teamAccess(c, teamId);
  const member = await c.env.DB.prepare(`
    SELECT m.user_id, m.status, t.created_by FROM team_members m JOIN teams t ON t.id = m.team_id
    WHERE m.team_id = ? AND m.user_id = ?
  `).bind(teamId, userId).first<{ user_id: number; status: "active" | "removed" | "left"; created_by: number }>();
  if (!member) throw notFound();
  if (member.created_by === userId) throw new ApiError(409, status === "left" ? "ADMIN_CANNOT_LEAVE" : "CANNOT_REMOVE_ADMIN", "团队创建者不能离队或被移除");
  if (member.status !== "active") return ok(c, null);
  const endedAt = nowIso();
  const endedBy = currentAuth(c).user.id;
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE team_members SET status = ?, ended_at = ?, ended_by = ?, updated_at = ?
      WHERE team_id = ? AND user_id = ? AND status = 'active'
    `).bind(status, endedAt, endedBy, endedAt, teamId, userId),
    c.env.DB.prepare("UPDATE team_invitations SET status = 'revoked', responded_at = ?, updated_at = ? WHERE team_id = ? AND invitee_user_id = ? AND status = 'pending'").bind(endedAt, endedAt, teamId, userId),
    auditStatement(c, teamId, endedBy, status === "removed" ? "member.removed" : "member.left", "member", userId, { userId: String(userId), status: "active" }, { userId: String(userId), status }),
  ]);
  if (!result[0].meta.changes) throw versionMismatch("成员状态已变化，请刷新后重试");
  return ok(c, null);
};

app.delete("/api/v1/teams/:teamId/members/:userId", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await requireTeamAdmin(c, teamId);
  return removeMember(c, teamId, id(c.req.param("userId")), "removed");
});

app.post("/api/v1/teams/:teamId/leave", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const access = await teamAccess(c, teamId);
  if (access.role === "admin") throw new ApiError(409, "ADMIN_CANNOT_LEAVE", "团队创建者不能退出团队");
  return removeMember(c, teamId, currentAuth(c).user.id, "left");
});

type InvitationRow = {
  id: number; team_id: number; team_name: string; team_status: "active" | "archived";
  inviter_user_id: number; inviter_name: string; invitee_user_id: number; invitee_name: string;
  message: string | null; status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  expires_at: string; responded_at: string | null; created_at: string; updated_at: string;
};
const invitationDto = (row: InvitationRow, includeMessage: boolean) => ({
  id: String(row.id),
  team: { id: String(row.team_id), name: row.team_name, status: row.team_status },
  inviter: { id: String(row.inviter_user_id), username: row.inviter_name },
  invitee: { id: String(row.invitee_user_id), username: row.invitee_name },
  message: includeMessage ? row.message : null,
  status: row.status,
  expiresAt: row.expires_at,
  respondedAt: row.responded_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const invitationSelect = `
  SELECT i.*, t.name AS team_name, t.status AS team_status, iv.username AS inviter_name, ee.username AS invitee_name
  FROM team_invitations i
  JOIN teams t ON t.id = i.team_id
  JOIN users iv ON iv.id = i.inviter_user_id
  JOIN users ee ON ee.id = i.invitee_user_id
`;

app.post("/api/v1/teams/:teamId/invitations", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await requireTeamAdmin(c, teamId, { requireActive: true });
  const body = await jsonBody(c, z.object({ account: z.string().trim().min(2).max(255), message: z.string().trim().max(500).nullable().optional() }).strict());
  const account = body.account.toLowerCase();
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE username = ? OR email = ?").bind(body.account, account).first<{ id: number }>();
  if (!user) throw new ApiError(404, "NOT_FOUND", "无法邀请该账号，请核对账号或确认对方已注册");
  const active = await c.env.DB.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'").bind(teamId, user.id).first();
  if (active) throw new ApiError(409, "ALREADY_TEAM_MEMBER", "该账号已是团队成员");
  const now = nowIso();
  const pending = await c.env.DB.prepare("SELECT * FROM team_invitations WHERE team_id = ? AND invitee_user_id = ? AND status = 'pending'").bind(teamId, user.id).first<InvitationRow>();
  if (pending) {
    if (pending.expires_at <= now) throw new ApiError(409, "INVITATION_EXPIRED", "邀请已过期，请刷新后再重新发起");
    return ok(c, invitationDto(pending, true));
  }
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const result = await c.env.DB.prepare("INSERT INTO team_invitations (team_id, inviter_user_id, invitee_user_id, message, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING id")
    .bind(teamId, currentAuth(c).user.id, user.id, body.message ?? null, expiresAt, now, now).first<{ id: number }>();
  const invitationId = Number(result?.id);
  await c.env.DB.batch([auditStatement(c, teamId, currentAuth(c).user.id, "invitation.created", "invitation", invitationId, null, { inviteeUserId: String(user.id), expiresAt })]);
  const row = await c.env.DB.prepare(`${invitationSelect} WHERE i.id = ?`).bind(invitationId).first<InvitationRow>();
  if (!row) throw notFound();
  return ok(c, invitationDto(row, true), 201);
});

app.get("/api/v1/teams/:teamId/invitations", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await requireTeamAdmin(c, teamId);
  const { page, pageSize, offset } = pageParams(c);
  const status = c.req.query("status");
  const clauses = ["i.team_id = ?"];
  const params: (number | string)[] = [teamId];
  if (status === "pending" || status === "accepted" || status === "declined" || status === "revoked" || status === "expired") { clauses.push("i.status = ?"); params.push(status); }
  const where = clauses.join(" AND ");
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM team_invitations i WHERE ${where}`).bind(...params).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`${invitationSelect} WHERE ${where} ORDER BY CASE i.status WHEN 'pending' THEN 0 ELSE 1 END, i.created_at DESC, i.id DESC LIMIT ? OFFSET ?`).bind(...params, pageSize, offset).all<InvitationRow>();
  return ok(c, rows.results.map((row) => invitationDto(row, true)), 200, pagination(page, pageSize, Number(count?.count ?? 0)));
});

app.post("/api/v1/teams/:teamId/invitations/:invitationId/revoke", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const invitationId = id(c.req.param("invitationId"));
  await requireTeamAdmin(c, teamId);
  const row = await c.env.DB.prepare(`${invitationSelect} WHERE i.id = ? AND i.team_id = ?`).bind(invitationId, teamId).first<InvitationRow>();
  if (!row) throw notFound();
  if (row.expires_at <= nowIso()) throw new ApiError(409, "INVITATION_EXPIRED", "邀请已过期");
  if (row.status !== "pending") throw new ApiError(409, "INVITATION_NOT_PENDING", "邀请已处理，不能撤销");
  const updatedAt = nowIso();
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE team_invitations SET status = 'revoked', responded_at = ?, updated_at = ? WHERE id = ? AND team_id = ? AND status = 'pending'").bind(updatedAt, updatedAt, invitationId, teamId),
    c.env.DB.prepare(`
      INSERT INTO audit_logs (team_id, actor_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at)
      SELECT ?, ?, 'invitation.revoked', 'invitation', ?, ?, ?, ?, ? FROM team_invitations WHERE id = ? AND status = 'revoked' AND updated_at = ?
    `).bind(teamId, currentAuth(c).user.id, String(invitationId), JSON.stringify({ status: "pending" }), JSON.stringify({ status: "revoked" }), c.get("requestId"), updatedAt, invitationId, updatedAt),
  ]);
  if (!result[0].meta.changes) throw new ApiError(409, "INVITATION_NOT_PENDING", "邀请已被处理");
  const fresh = await c.env.DB.prepare(`${invitationSelect} WHERE i.id = ?`).bind(invitationId).first<InvitationRow>();
  if (!fresh) throw notFound();
  return ok(c, invitationDto(fresh, true));
});

app.get("/api/v1/users/me/invitations", async (c) => {
  const auth = currentAuth(c);
  const { page, pageSize, offset } = pageParams(c);
  const now = nowIso();
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM team_invitations WHERE invitee_user_id = ? AND (status <> 'pending' OR expires_at > ?)").bind(auth.user.id, now).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`${invitationSelect} WHERE i.invitee_user_id = ? AND (i.status <> 'pending' OR i.expires_at > ?) ORDER BY CASE i.status WHEN 'pending' THEN 0 ELSE 1 END, i.created_at DESC, i.id DESC LIMIT ? OFFSET ?`).bind(auth.user.id, now, pageSize, offset).all<InvitationRow>();
  return ok(c, rows.results.map((row) => invitationDto(row, row.status === "pending")), 200, pagination(page, pageSize, Number(count?.count ?? 0)));
});

const myInvitation = async (c: AppContext, invitationId: number) => {
  const row = await c.env.DB.prepare(`${invitationSelect} WHERE i.id = ? AND i.invitee_user_id = ?`).bind(invitationId, currentAuth(c).user.id).first<InvitationRow>();
  if (!row) throw notFound();
  return row;
};

app.post("/api/v1/users/me/invitations/:invitationId/accept", async (c) => {
  const auth = currentAuth(c);
  const invitationId = id(c.req.param("invitationId"));
  const invitation = await myInvitation(c, invitationId);
  if (invitation.status === "accepted") {
    const member = await c.env.DB.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'").bind(invitation.team_id, auth.user.id).first();
    if (member) {
      const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(invitation.team_id).first<TeamRow>();
      if (team) return ok(c, await teamListDto(c, team));
    }
    throw new ApiError(409, "INVITATION_ALREADY_USED", "该邀请已使用，需要管理员重新邀请");
  }
  if (invitation.status !== "pending") throw new ApiError(409, "INVITATION_NOT_PENDING", "邀请已处理，不能接受");
  if (invitation.expires_at <= nowIso()) throw new ApiError(409, "INVITATION_EXPIRED", "邀请已过期");
  const active = await c.env.DB.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'").bind(invitation.team_id, auth.user.id).first();
  if (active) throw new ApiError(409, "ALREADY_TEAM_MEMBER", "你已是团队成员");
  const updatedAt = nowIso();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE team_invitations SET status = 'accepted', responded_at = ?, updated_at = ?
      WHERE id = ? AND invitee_user_id = ? AND status = 'pending' AND expires_at > ?
    `).bind(updatedAt, updatedAt, invitationId, auth.user.id, updatedAt),
    c.env.DB.prepare(`
      INSERT INTO audit_logs (team_id, actor_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at)
      SELECT ?, ?, 'invitation.accepted', 'invitation', ?, ?, ?, ?, ? FROM team_invitations WHERE id = ? AND status = 'accepted' AND updated_at = ?
    `).bind(invitation.team_id, auth.user.id, String(invitationId), JSON.stringify({ status: "pending" }), JSON.stringify({ status: "accepted" }), c.get("requestId"), updatedAt, invitationId, updatedAt),
  ]);
  if (!result[0].meta.changes) throw new ApiError(409, "INVITATION_NOT_PENDING", "邀请已被处理或已过期");
  const team = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(invitation.team_id).first<TeamRow>();
  if (!team) throw notFound();
  return ok(c, await teamListDto(c, team));
});

app.post("/api/v1/users/me/invitations/:invitationId/decline", async (c) => {
  const invitationId = id(c.req.param("invitationId"));
  const invitation = await myInvitation(c, invitationId);
  if (invitation.expires_at <= nowIso()) throw new ApiError(409, "INVITATION_EXPIRED", "邀请已过期");
  if (invitation.status !== "pending") throw new ApiError(409, "INVITATION_NOT_PENDING", "邀请已处理，不能拒绝");
  const updatedAt = nowIso();
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE team_invitations SET status = 'declined', responded_at = ?, updated_at = ? WHERE id = ? AND invitee_user_id = ? AND status = 'pending'").bind(updatedAt, updatedAt, invitationId, currentAuth(c).user.id),
    c.env.DB.prepare(`
      INSERT INTO audit_logs (team_id, actor_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at)
      SELECT ?, ?, 'invitation.declined', 'invitation', ?, ?, ?, ?, ? FROM team_invitations WHERE id = ? AND status = 'declined' AND updated_at = ?
    `).bind(invitation.team_id, currentAuth(c).user.id, String(invitationId), JSON.stringify({ status: "pending" }), JSON.stringify({ status: "declined" }), c.get("requestId"), updatedAt, invitationId, updatedAt),
  ]);
  if (!result[0].meta.changes) throw new ApiError(409, "INVITATION_NOT_PENDING", "邀请已被处理");
  return ok(c, null);
});

app.all("/api/v1/teams/:teamId/groups/*", (c) => retired(c));

const requirePlatformAdmin = (c: AppContext) => {
  if (currentAuth(c).user.systemRole !== "super_admin") throw new ApiError(403, "FORBIDDEN", "仅超级管理员可执行此操作");
};

app.get("/api/v1/admin/overview", async (c) => {
  requirePlatformAdmin(c);
  const row = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS user_count,
      (SELECT COUNT(*) FROM teams WHERE status = 'active') AS active_team_count,
      (SELECT COUNT(*) FROM projects WHERE status = 'active' AND deleted_at IS NULL) AS in_progress_project_count,
      (SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL) AS task_count
  `).first<{ user_count: number; active_team_count: number; in_progress_project_count: number; task_count: number }>();
  return ok(c, {
    userCount: Number(row?.user_count ?? 0),
    activeTeamCount: Number(row?.active_team_count ?? 0),
    inProgressProjectCount: Number(row?.in_progress_project_count ?? 0),
    taskCount: Number(row?.task_count ?? 0),
  });
});

app.get("/api/v1/admin/users", async (c) => {
  requirePlatformAdmin(c);
  const { page, pageSize, offset } = pageParams(c);
  const keyword = c.req.query("keyword")?.trim() ?? "";
  const role = c.req.query("systemRole");
  const clauses = ["1 = 1"];
  const params: (number | string)[] = [];
  if (keyword) {
    clauses.push("(username LIKE ? OR email LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (role === "member" || role === "super_admin") {
    clauses.push("system_role = ?");
    params.push(role);
  }
  const where = clauses.join(" AND ");
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM users WHERE ${where}`).bind(...params).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`SELECT id, username, email, color, system_role, created_at FROM users WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(...params, pageSize, offset).all<AccountRow>();
  return ok(c, rows.results.map(accountDto), 200, pagination(page, pageSize, Number(count?.count ?? 0)));
});

type PlatformProjectRow = ProjectRow & {
  team_name: string;
  team_status: "active" | "archived";
  creator_username: string;
  task_count: number;
};
const platformProjectDto = (row: PlatformProjectRow) => ({
  id: String(row.id),
  team: { id: String(row.team_id), name: row.team_name, status: row.team_status },
  name: row.name,
  description: row.description,
  status: row.status,
  deletedAt: row.deleted_at,
  taskCount: Number(row.task_count),
  createdBy: { id: String(row.created_by), username: row.creator_username },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

app.get("/api/v1/admin/projects", async (c) => {
  requirePlatformAdmin(c);
  const { page, pageSize, offset } = pageParams(c);
  const keyword = c.req.query("keyword")?.trim() ?? "";
  const status = c.req.query("status");
  const teamIdValue = c.req.query("teamId");
  const clauses = ["1 = 1"];
  const params: (number | string)[] = [];
  if (keyword) {
    clauses.push("(p.name LIKE ? OR p.description LIKE ? OR t.name LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (status === "active" || status === "archived") {
    clauses.push("p.status = ?");
    params.push(status);
  }
  if (teamIdValue) {
    const teamId = id(teamIdValue);
    clauses.push("p.team_id = ?");
    params.push(teamId);
  }
  const where = clauses.join(" AND ");
  const count = await c.env.DB.prepare(`
    SELECT COUNT(*) AS count FROM projects p JOIN teams t ON t.id = p.team_id WHERE ${where}
  `).bind(...params).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`
    SELECT p.*, t.name AS team_name, t.status AS team_status, u.username AS creator_username,
      (SELECT COUNT(*) FROM tasks tk WHERE tk.project_id = p.id AND tk.deleted_at IS NULL) AS task_count
    FROM projects p
    JOIN teams t ON t.id = p.team_id
    JOIN users u ON u.id = p.created_by
    WHERE ${where}
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).bind(...params, pageSize, offset).all<PlatformProjectRow>();
  return ok(c, rows.results.map(platformProjectDto), 200, pagination(page, pageSize, Number(count?.count ?? 0)));
});

app.all("/api/v1/admin/users/:userId/role", (c) => retired(c));

app.get("/api/v1/teams/:teamId/projects", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId);
  const { page, pageSize, offset } = pageParams(c);
  const keyword = c.req.query("keyword")?.trim() ?? "";
  const status = c.req.query("status");
  const clauses = ["p.team_id = ?", "p.deleted_at IS NULL"];
  const params: (number | string)[] = [teamId];
  if (keyword) { clauses.push("(p.name LIKE ? OR p.description LIKE ?)"); params.push(`%${keyword}%`, `%${keyword}%`); }
  if (status === "active" || status === "archived") { clauses.push("p.status = ?"); params.push(status); }
  const where = clauses.join(" AND ");
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM projects p WHERE ${where}`).bind(...params).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`
    SELECT p.*, COUNT(t.id) AS task_count FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
    WHERE ${where} GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?
  `).bind(...params, pageSize, offset).all<ProjectListRow>();
  return ok(c, rows.results.map(projectDto), 200, pagination(page, pageSize, Number(count?.count ?? 0)));
});

app.post("/api/v1/teams/:teamId/projects", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId, true);
  const body = await jsonBody(c, z.object({ name: z.string().trim().min(2).max(64), description: z.string().max(2000).nullable().optional() }).strict());
  const auth = currentAuth(c);
  const now = nowIso();
  let inserted;
  try {
    inserted = await c.env.DB.prepare("INSERT INTO projects (team_id, name, description, created_by, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(teamId, body.name, body.description ?? null, auth.user.id, now, now, auth.user.id).first<{ id: number }>();
  } catch (error) {
    if (error instanceof Error && error.message.includes("projects_team_live_name")) throw new ApiError(409, "PROJECT_NAME_CONFLICT", "团队内未删除项目名称已存在");
    throw error;
  }
  const projectId = Number(inserted?.id);
  await c.env.DB.batch([auditStatement(c, teamId, auth.user.id, "project.created", "project", projectId, null, { id: String(projectId), name: body.name, description: body.description ?? null })]);
  const project = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first<ProjectRow>();
  if (!project) throw notFound();
  return ok(c, projectDto(project), 201);
});

app.get("/api/v1/teams/:teamId/projects/:projectId", async (c) => {
  const access = await projectAccess(c, id(c.req.param("teamId")), id(c.req.param("projectId")));
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND deleted_at IS NULL").bind(access.project.id).first<{ count: number }>();
  return ok(c, projectDto({ ...access.project, task_count: Number(count?.count ?? 0) }));
});

const projectPatchSchema = z.object({
  name: z.string().trim().min(2).max(64).optional(),
  description: z.string().max(2000).nullable().optional(),
  expectedUpdatedAt: z.string().datetime(),
}).strict().refine(({ name, description }) => name !== undefined || description !== undefined);

app.patch("/api/v1/teams/:teamId/projects/:projectId", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const access = await projectAccess(c, teamId, projectId, true);
  const body = await jsonBody(c, projectPatchSchema);
  assertVersion(body.expectedUpdatedAt, access.project.updated_at);
  const before = projectDto(access.project);
  const updatedAt = nextTaskVersion(access.project.updated_at);
  let result;
  try {
    result = await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE projects SET name = COALESCE(?, name), description = CASE WHEN ? THEN ? ELSE description END,
          updated_at = ?, updated_by = ? WHERE id = ? AND team_id = ? AND updated_at = ? AND deleted_at IS NULL AND status = 'active'
      `).bind(body.name ?? null, body.description !== undefined ? 1 : 0, body.description ?? null, updatedAt, currentAuth(c).user.id, projectId, teamId, access.project.updated_at),
      c.env.DB.prepare(`
        INSERT INTO audit_logs (team_id, actor_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at)
        SELECT ?, ?, 'project.updated', 'project', ?, ?, json_object('name', name, 'description', description, 'updatedAt', updated_at), ?, ?
        FROM projects WHERE id = ? AND updated_at = ? AND updated_by = ?
      `).bind(teamId, currentAuth(c).user.id, String(projectId), JSON.stringify(before), c.get("requestId"), updatedAt, projectId, updatedAt, currentAuth(c).user.id),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("projects_team_live_name")) throw new ApiError(409, "PROJECT_NAME_CONFLICT", "团队内未删除项目名称已存在");
    throw error;
  }
  if (!result[0].meta.changes) throw versionMismatch();
  const project = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first<ProjectRow>();
  if (!project) throw notFound();
  return ok(c, projectDto(project));
});

const projectStatus = async (c: AppContext, teamId: number, projectId: number, next: "active" | "archived") => {
  const access = await projectAccess(c, teamId, projectId, next === "archived");
  const body = await jsonBody(c, z.object({ expectedUpdatedAt: z.string().datetime() }).strict());
  assertVersion(body.expectedUpdatedAt, access.project.updated_at);
  const updatedAt = nextTaskVersion(access.project.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE projects SET status = ?, updated_at = ?, updated_by = ? WHERE id = ? AND team_id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL")
      .bind(next, updatedAt, currentAuth(c).user.id, projectId, teamId, next === "active" ? "archived" : "active", access.project.updated_at),
    auditStatement(c, teamId, currentAuth(c).user.id, next === "active" ? "project.restored" : "project.archived", "project", projectId, { status: access.project.status, updatedAt: body.expectedUpdatedAt }, { status: next, updatedAt }),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  const project = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first<ProjectRow>();
  if (!project) throw notFound();
  return ok(c, projectDto(project));
};

app.post("/api/v1/teams/:teamId/projects/:projectId/archive", (c) => projectStatus(c, id(c.req.param("teamId")), id(c.req.param("projectId")), "archived"));
app.post("/api/v1/teams/:teamId/projects/:projectId/restore", (c) => projectStatus(c, id(c.req.param("teamId")), id(c.req.param("projectId")), "active"));

app.delete("/api/v1/teams/:teamId/projects/:projectId", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const access = await projectAccess(c, teamId, projectId);
  if (access.team.team.status !== "active") throw new ApiError(409, "TEAM_ARCHIVED", "团队已归档，业务数据只读");
  const body = await jsonBody(c, z.object({ expectedUpdatedAt: z.string().datetime() }).strict());
  assertVersion(body.expectedUpdatedAt, access.project.updated_at);
  const updatedAt = nextTaskVersion(access.project.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE projects SET deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ? WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND updated_at = ?")
      .bind(updatedAt, currentAuth(c).user.id, updatedAt, currentAuth(c).user.id, projectId, teamId, access.project.updated_at),
    auditStatement(c, teamId, currentAuth(c).user.id, "project.deleted", "project", projectId, { status: access.project.status, updatedAt: body.expectedUpdatedAt }, { deletedAt: updatedAt }),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  return ok(c, null);
});

const visibleTask = async (c: AppContext, teamId: number, projectId: number, taskId: number, includeDeleted = false) => {
  const access = await projectAccess(c, teamId, projectId);
  const task = await c.env.DB.prepare(`${taskSelect} WHERE t.id = ? AND t.project_id = ? AND t.deleted_at ${includeDeleted ? "IS NOT" : "IS"} NULL`)
    .bind(taskId, projectId).first<TaskDtoRow>();
  if (!task) throw notFound();
  return { ...access, task };
};

const taskFilters = (c: AppContext) => {
  const clauses = ["t.project_id = ?", "t.deleted_at IS NULL"];
  const params: (number | string)[] = [id(c.req.param("projectId"))];
  if (c.req.query("assigneeId")) { clauses.push("t.assignee_id = ?"); params.push(id(c.req.query("assigneeId"))); }
  for (const column of ["status", "priority"] as const) if (c.req.query(column)) { clauses.push(`t.${column} = ?`); params.push(c.req.query(column)!); }
  const keyword = c.req.query("keyword")?.trim();
  if (keyword) { clauses.push("(t.title LIKE ? OR t.detail LIKE ?)"); params.push(`%${keyword}%`, `%${keyword}%`); }
  return { clauses, params };
};

app.get("/api/v1/teams/:teamId/projects/:projectId/tasks", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  await projectAccess(c, teamId, projectId);
  const { page, pageSize, offset } = pageParams(c);
  const { clauses, params } = taskFilters(c);
  const where = clauses.join(" AND ");
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE ${where}`).bind(...params).first<{ count: number }>();
  const sort = ({ endDate: "t.end_date", createdAt: "t.created_at", priority: "CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END" } as Record<string, string>)[c.req.query("sortBy") || "endDate"] || "t.end_date";
  const order = c.req.query("sortOrder") === "desc" ? "DESC" : "ASC";
  const rows = await c.env.DB.prepare(`${taskSelect} WHERE ${where} ORDER BY ${sort} ${order}, t.id ASC LIMIT ? OFFSET ?`).bind(...params, pageSize, offset).all<TaskDtoRow>();
  return ok(c, rows.results.map(taskDto), 200, pagination(page, pageSize, Number(count?.count ?? 0)));
});

const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().max(10000).nullable().optional(),
  assigneeId: z.string().regex(/^\d+$/).optional(),
  startDate: taskDateTime.nullable().optional(),
  endDate: taskDateTime,
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
}).strict();

const requireAssignee = async (c: AppContext, teamId: number, assigneeId: number) => {
  const member = await c.env.DB.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'").bind(teamId, assigneeId).first();
  if (!member) throw new ApiError(409, "ASSIGNEE_NOT_TEAM_MEMBER", "负责人必须是当前团队的有效成员");
};

app.post("/api/v1/teams/:teamId/projects/:projectId/tasks", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  await projectAccess(c, teamId, projectId, true);
  const body = await jsonBody(c, taskCreateSchema);
  const auth = currentAuth(c);
  const assigneeId = body.assigneeId ? id(body.assigneeId) : auth.user.id;
  await requireAssignee(c, teamId, assigneeId);
  if (body.startDate && body.startDate > body.endDate) throw new ApiError(400, "VALIDATION_ERROR", "开始时间不能晚于结束时间");
  const now = nowIso();
  const status = body.status ?? "todo";
  const completedAt = status === "done" ? now : null;
  let taskId = 0;
  try {
    const inserted = await c.env.DB.prepare(`
      INSERT INTO tasks (project_id, title, detail, assignee_id, start_date, end_date, status, priority, completed_at, created_by, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).bind(projectId, body.title, body.detail ?? null, assigneeId, body.startDate ?? null, body.endDate, status, body.priority ?? "medium", completedAt, auth.user.id, now, now, auth.user.id).first<{ id: number }>();
    taskId = Number(inserted?.id);
    await c.env.DB.batch([auditStatement(c, teamId, auth.user.id, "task.created", "task", taskId, null, { id: String(taskId), title: body.title, assigneeId: String(assigneeId), endDate: body.endDate })]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("TASK_PARTICIPANT_NOT_TEAM_MEMBER")) throw new ApiError(409, "ASSIGNEE_NOT_TEAM_MEMBER", "负责人必须是当前团队的有效成员");
    if (message.includes("WRITER_NOT_TEAM_MEMBER")) throw notFound();
    throw error;
  }
  const loaded = await visibleTask(c, teamId, projectId, taskId);
  return ok(c, taskDto(loaded.task), 201);
});

app.get("/api/v1/teams/:teamId/projects/:projectId/tasks/:taskId", async (c) => {
  const loaded = await visibleTask(c, id(c.req.param("teamId")), id(c.req.param("projectId")), id(c.req.param("taskId")));
  return ok(c, taskDto(loaded.task));
});

const taskPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().max(10000).nullable().optional(),
  assigneeId: z.string().regex(/^\d+$/).optional(),
  startDate: taskDateTime.nullable().optional(),
  endDate: taskDateTime.optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  expectedUpdatedAt: z.string().datetime(),
}).strict().refine(({ title, detail, assigneeId, startDate, endDate, status, priority }) => [title, detail, assigneeId, startDate, endDate, status, priority].some((value) => value !== undefined));

app.patch("/api/v1/teams/:teamId/projects/:projectId/tasks/:taskId", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const taskId = id(c.req.param("taskId"));
  const loaded = await visibleTask(c, teamId, projectId, taskId);
  const body = await jsonBody(c, taskPatchSchema);
  await projectAccess(c, teamId, projectId, true);
  assertVersion(body.expectedUpdatedAt, loaded.task.updated_at);
  const assigneeId = body.assigneeId ? id(body.assigneeId) : loaded.task.assignee_id;
  if (body.assigneeId) await requireAssignee(c, teamId, assigneeId);
  const startDate = body.startDate === undefined ? loaded.task.start_date : body.startDate;
  const endDate = body.endDate ?? loaded.task.end_date;
  if (startDate && startDate > endDate) throw new ApiError(400, "VALIDATION_ERROR", "开始时间不能晚于结束时间");
  const status = body.status ?? loaded.task.status;
  const completedAt = status === "done" ? (loaded.task.completed_at ?? nowIso()) : null;
  const before = taskDto(loaded.task);
  const updatedAt = nextTaskVersion(loaded.task.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE tasks SET title = COALESCE(?, title), detail = CASE WHEN ? THEN ? ELSE detail END, assignee_id = ?,
        start_date = CASE WHEN ? THEN ? ELSE start_date END, end_date = COALESCE(?, end_date), status = COALESCE(?, status),
        priority = COALESCE(?, priority), completed_at = ?, updated_at = ?, updated_by = ?
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND updated_at = ?
    `).bind(body.title ?? null, body.detail !== undefined ? 1 : 0, body.detail ?? null, assigneeId, body.startDate !== undefined ? 1 : 0, body.startDate ?? null, body.endDate ?? null, body.status ?? null, body.priority ?? null, completedAt, updatedAt, currentAuth(c).user.id, taskId, projectId, loaded.task.updated_at),
    c.env.DB.prepare(`
      INSERT INTO audit_logs (team_id, actor_id, action, entity_type, entity_id, before_json, after_json, request_id, created_at)
      SELECT ?, ?, 'task.updated', 'task', ?, ?, json_object('title', title, 'detail', detail, 'assigneeId', assignee_id, 'startDate', start_date, 'endDate', end_date, 'status', status, 'priority', priority, 'updatedAt', updated_at), ?, ?
      FROM tasks WHERE id = ? AND updated_at = ? AND updated_by = ?
    `).bind(teamId, currentAuth(c).user.id, String(taskId), JSON.stringify(before), c.get("requestId"), updatedAt, taskId, updatedAt, currentAuth(c).user.id),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  const fresh = await visibleTask(c, teamId, projectId, taskId);
  return ok(c, taskDto(fresh.task));
});

app.patch("/api/v1/teams/:teamId/projects/:projectId/tasks/:taskId/schedule", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const taskId = id(c.req.param("taskId"));
  const loaded = await visibleTask(c, teamId, projectId, taskId);
  const body = await jsonBody(c, z.object({ startDate: taskDateTime, endDate: taskDateTime, expectedUpdatedAt: z.string().datetime() }).strict());
  await projectAccess(c, teamId, projectId, true);
  assertVersion(body.expectedUpdatedAt, loaded.task.updated_at);
  if (body.startDate > body.endDate) throw new ApiError(400, "VALIDATION_ERROR", "开始时间不能晚于结束时间");
  const before = taskDto(loaded.task);
  const updatedAt = nextTaskVersion(loaded.task.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE tasks SET start_date = ?, end_date = ?, updated_at = ?, updated_by = ? WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND updated_at = ?")
      .bind(body.startDate, body.endDate, updatedAt, currentAuth(c).user.id, taskId, projectId, loaded.task.updated_at),
    auditStatement(c, teamId, currentAuth(c).user.id, "task.schedule_updated", "task", taskId, { startDate: before.startDate, endDate: before.endDate, updatedAt: body.expectedUpdatedAt }, { startDate: body.startDate, endDate: body.endDate, updatedAt }),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  const fresh = await visibleTask(c, teamId, projectId, taskId);
  return ok(c, taskDto(fresh.task));
});

app.post("/api/v1/teams/:teamId/projects/:projectId/tasks/:taskId/move", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const taskId = id(c.req.param("taskId"));
  const loaded = await visibleTask(c, teamId, projectId, taskId);
  const body = await jsonBody(c, z.object({ targetProjectId: z.string().regex(/^\d+$/), expectedUpdatedAt: z.string().datetime() }).strict());
  assertVersion(body.expectedUpdatedAt, loaded.task.updated_at);
  const targetId = id(body.targetProjectId);
  await projectAccess(c, teamId, projectId, true);
  if (targetId === projectId) return ok(c, taskDto(loaded.task));
  await projectAccess(c, teamId, targetId, true);
  const before = taskDto(loaded.task);
  const updatedAt = nextTaskVersion(loaded.task.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE tasks SET project_id = ?, updated_at = ?, updated_by = ? WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND updated_at = ?")
      .bind(targetId, updatedAt, currentAuth(c).user.id, taskId, projectId, loaded.task.updated_at),
    auditStatement(c, teamId, currentAuth(c).user.id, "task.moved", "task", taskId, { projectId: before.projectId, updatedAt: body.expectedUpdatedAt }, { projectId: String(targetId), updatedAt }),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  const fresh = await visibleTask(c, teamId, targetId, taskId);
  return ok(c, taskDto(fresh.task));
});

app.delete("/api/v1/teams/:teamId/projects/:projectId/tasks/:taskId", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const taskId = id(c.req.param("taskId"));
  const loaded = await visibleTask(c, teamId, projectId, taskId);
  await projectAccess(c, teamId, projectId, true);
  const body = await jsonBody(c, z.object({ expectedUpdatedAt: z.string().datetime() }).strict());
  assertVersion(body.expectedUpdatedAt, loaded.task.updated_at);
  const before = taskDto(loaded.task);
  const updatedAt = nextTaskVersion(loaded.task.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE tasks SET deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ? WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND updated_at = ?")
      .bind(updatedAt, currentAuth(c).user.id, updatedAt, currentAuth(c).user.id, taskId, projectId, loaded.task.updated_at),
    auditStatement(c, teamId, currentAuth(c).user.id, "task.deleted", "task", taskId, { title: before.title, updatedAt: body.expectedUpdatedAt }, { deletedAt: updatedAt }),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  return ok(c, null);
});

app.get("/api/v1/teams/:teamId/projects/:projectId/gantt", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  const project = (await projectAccess(c, teamId, projectId)).project;
  const { clauses, params } = taskFilters(c);
  const rows = await c.env.DB.prepare(`${taskSelect} WHERE ${clauses.join(" AND ")} ORDER BY t.end_date, t.id`).bind(...params).all<TaskDtoRow>();
  const tasks = rows.results.map(taskDto);
  const dates = tasks.flatMap((task) => [task.renderStartDate, task.endDate]).sort();
  const shift = (value: string, days: number) => {
    const d = new Date(Date.parse(`${value.slice(0, 10)}T00:00:00Z`));
    d.setUTCDate(d.getUTCDate() + days);
    return `${d.toISOString().slice(0, 10)}T00:00`;
  };
  const today = `${shanghaiToday()}T00:00`;
  const granularity = ["hour", "halfDay", "day"].includes(c.req.query("granularity") || "") ? c.req.query("granularity")! : "day";
  return ok(c, { project: projectDto(project), range: { startDate: dates.length ? shift(dates[0], -3) : today, endDate: dates.length ? shift(dates.at(-1)!, 3) : today, granularity }, tasks });
});

app.get("/api/v1/teams/:teamId/dashboard", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId);
  const auth = currentAuth(c);
  const today = shanghaiToday();
  const stats = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM projects p WHERE p.team_id = ? AND p.status = 'active' AND p.deleted_at IS NULL) AS in_progress_project_count,
      COUNT(t.id) AS visible_task_count,
      SUM(CASE WHEN t.assignee_id = ? AND t.status <> 'done' THEN 1 ELSE 0 END) AS my_open_task_count,
      SUM(CASE WHEN t.status <> 'done' AND substr(t.end_date, 1, 10) < ? THEN 1 ELSE 0 END) AS overdue_task_count,
      SUM(CASE WHEN t.status <> 'done' AND substr(t.end_date, 1, 10) >= ? AND substr(t.end_date, 1, 10) <= date(?, '+7 day') THEN 1 ELSE 0 END) AS upcoming_deadline_count
    FROM tasks t JOIN projects p ON p.id = t.project_id AND p.team_id = ? AND p.deleted_at IS NULL
    WHERE t.deleted_at IS NULL
  `).bind(teamId, auth.user.id, today, today, today, teamId).first<{ in_progress_project_count: number; visible_task_count: number; my_open_task_count: number; overdue_task_count: number; upcoming_deadline_count: number }>();
  const recent = await c.env.DB.prepare("SELECT p.*, COUNT(t.id) AS task_count FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL WHERE p.team_id = ? AND p.deleted_at IS NULL GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 5").bind(teamId).all<ProjectListRow>();
  const deadlines = await c.env.DB.prepare(`
    ${taskSelect} WHERE t.deleted_at IS NULL AND substr(t.end_date, 1, 10) >= ? AND substr(t.end_date, 1, 10) <= date(?, '+7 day')
      AND t.project_id IN (SELECT id FROM projects WHERE team_id = ? AND deleted_at IS NULL)
    ORDER BY t.end_date LIMIT 5
  `).bind(today, today, teamId).all<TaskDtoRow>();
  return ok(c, {
    inProgressProjectCount: Number(stats?.in_progress_project_count ?? 0),
    visibleTaskCount: Number(stats?.visible_task_count ?? 0),
    myOpenTaskCount: Number(stats?.my_open_task_count ?? 0),
    overdueTaskCount: Number(stats?.overdue_task_count ?? 0),
    upcomingDeadlineCount: Number(stats?.upcoming_deadline_count ?? 0),
    recentProjects: recent.results.map(projectDto),
    upcomingDeadlines: deadlines.results.map(taskDto),
  });
});

const restoreDeadline = (deletedAt: string) => {
  const deadline = Date.parse(isoTimestamp(deletedAt)) + 30 * 86400000;
  return { deadline: new Date(deadline).toISOString(), expired: deadline <= Date.now() };
};

app.get("/api/v1/teams/:teamId/trash", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId);
  const type = c.req.query("type");
  if (type !== "project" && type !== "task") throw new ApiError(400, "VALIDATION_ERROR", "type 必须是 project 或 task");
  const { page, pageSize, offset } = pageParams(c);
  if (type === "project") {
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM projects WHERE team_id = ? AND deleted_at IS NOT NULL").bind(teamId).first<{ count: number }>();
    const rows = await c.env.DB.prepare("SELECT * FROM projects WHERE team_id = ? AND deleted_at IS NOT NULL ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?").bind(teamId, pageSize, offset).all<ProjectRow>();
    return ok(c, rows.results.map((row) => ({ type, project: projectDto(row), deletedAt: row.deleted_at, restorableUntil: restoreDeadline(row.deleted_at!).deadline, expired: restoreDeadline(row.deleted_at!).expired })), 200, pagination(page, pageSize, Number(count?.count ?? 0)));
  }
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.team_id = ? AND t.deleted_at IS NOT NULL").bind(teamId).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`${taskSelect} WHERE p.team_id = ? AND t.deleted_at IS NOT NULL ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`).bind(teamId, pageSize, offset).all<TaskDtoRow>();
  return ok(c, rows.results.map((row) => ({ type, task: taskDto(row), deletedAt: row.deleted_at, restorableUntil: restoreDeadline(row.deleted_at!).deadline, expired: restoreDeadline(row.deleted_at!).expired })), 200, pagination(page, pageSize, Number(count?.count ?? 0)));
});

app.post("/api/v1/teams/:teamId/trash/projects/:projectId/restore", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const projectId = id(c.req.param("projectId"));
  await teamAccess(c, teamId, true);
  const project = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ? AND team_id = ? AND deleted_at IS NOT NULL").bind(projectId, teamId).first<ProjectRow>();
  if (!project) throw notFound();
  const deadline = restoreDeadline(project.deleted_at!);
  if (deadline.expired) throw new ApiError(409, "RESTORE_EXPIRED", "删除超过 30 天，不能恢复");
  const body = await jsonBody(c, z.object({ expectedUpdatedAt: z.string().datetime(), name: z.string().trim().min(2).max(64).optional() }).strict());
  assertVersion(body.expectedUpdatedAt, project.updated_at);
  const updatedAt = nextTaskVersion(project.updated_at);
  let result;
  try {
    result = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE projects SET name = COALESCE(?, name), deleted_at = NULL, deleted_by = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND team_id = ? AND deleted_at IS NOT NULL AND updated_at = ?")
        .bind(body.name ?? null, updatedAt, currentAuth(c).user.id, projectId, teamId, project.updated_at),
      auditStatement(c, teamId, currentAuth(c).user.id, "project.restored", "project", projectId, { deletedAt: project.deleted_at, name: project.name }, { name: body.name ?? project.name, updatedAt }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("projects_team_live_name")) throw new ApiError(409, "PROJECT_NAME_CONFLICT", "团队内未删除项目名称已存在");
    throw error;
  }
  if (!result[0].meta.changes) throw versionMismatch();
  const restored = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first<ProjectRow>();
  if (!restored) throw notFound();
  return ok(c, projectDto(restored));
});

app.post("/api/v1/teams/:teamId/trash/tasks/:taskId/restore", async (c) => {
  const teamId = id(c.req.param("teamId"));
  const taskId = id(c.req.param("taskId"));
  await teamAccess(c, teamId, true);
  const task = await c.env.DB.prepare(`${taskSelect} WHERE t.id = ? AND p.team_id = ? AND t.deleted_at IS NOT NULL`).bind(taskId, teamId).first<TaskDtoRow>();
  if (!task) throw notFound();
  const parent = await c.env.DB.prepare("SELECT id FROM projects WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND status = 'active'").bind(task.project_id, teamId).first<{ id: number }>();
  if (!parent) throw new ApiError(409, "PARENT_NOT_ACTIVE", "父项目不存在、已删除或已归档");
  const deadline = restoreDeadline(task.deleted_at!);
  if (deadline.expired) throw new ApiError(409, "RESTORE_EXPIRED", "删除超过 30 天，不能恢复");
  const body = await jsonBody(c, z.object({ expectedUpdatedAt: z.string().datetime() }).strict());
  assertVersion(body.expectedUpdatedAt, task.updated_at);
  const updatedAt = nextTaskVersion(task.updated_at);
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE tasks SET deleted_at = NULL, deleted_by = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NOT NULL AND updated_at = ?")
      .bind(updatedAt, currentAuth(c).user.id, taskId, task.updated_at),
    auditStatement(c, teamId, currentAuth(c).user.id, "task.restored", "task", taskId, { deletedAt: task.deleted_at }, { updatedAt }),
  ]);
  if (!result[0].meta.changes) throw versionMismatch();
  const restored = await visibleTask(c, teamId, task.project_id, taskId);
  return ok(c, taskDto(restored.task));
});

app.get("/api/v1/teams/:teamId/activity", async (c) => {
  const teamId = id(c.req.param("teamId"));
  await teamAccess(c, teamId);
  const { page, pageSize, offset } = pageParams(c);
  const entityType = c.req.query("entityType");
  const entityId = c.req.query("entityId");
  const clauses = ["a.team_id = ?"];
  const params: (number | string)[] = [teamId];
  if (entityType) { clauses.push("a.entity_type = ?"); params.push(entityType); }
  if (entityId) { clauses.push("a.entity_id = ?"); params.push(entityId); }
  const where = clauses.join(" AND ");
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM audit_logs a WHERE ${where}`).bind(...params).first<{ count: number }>();
  const rows = await c.env.DB.prepare(`
    SELECT a.*, u.username AS actor_name FROM audit_logs a JOIN users u ON u.id = a.actor_id
    WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?
  `).bind(...params, pageSize, offset).all<{ id: number; action: string; entity_type: string; entity_id: string; actor_id: number; actor_name: string; before_json: string | null; after_json: string | null; request_id: string | null; created_at: string }>();
  return ok(c, rows.results.map((row) => ({
    id: String(row.id),
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actor: row.entity_type === "invitation" ? null : { id: String(row.actor_id), username: row.actor_name },
    before: row.entity_type === "invitation" ? null : JSON.parse(row.before_json ?? "null"),
    after: row.entity_type === "invitation" ? null : JSON.parse(row.after_json ?? "null"),
    createdAt: row.created_at,
  })), 200, pagination(page, pageSize, Number(count?.count ?? 0)));
});

app.onError((error, c) => {
  if (error instanceof ApiError) return fail(c, error.code, error.message, error.status, error.details);
  const message = error instanceof Error ? error.message : "";
  console.error(JSON.stringify({ requestId: c.get("requestId"), error: message }));
  if (message.includes("WRITER_NOT_TEAM_MEMBER")) return fail(c, "NOT_FOUND", "资源不存在或当前用户不可见", 404);
  if (message.includes("TASK_PARTICIPANT_NOT_TEAM_MEMBER")) return fail(c, "ASSIGNEE_NOT_TEAM_MEMBER", "负责人必须是当前团队的有效成员", 409);
  if (message.includes("INVALID_INVITATION_TRANSITION")) return fail(c, "INVITATION_NOT_PENDING", "邀请状态已变化，请刷新后重试", 409);
  if (message.includes("MEMBER_NOT_ACTIVE")) return fail(c, "CONFLICT", "成员状态已变化，请刷新后重试", 409);
  if (message.includes("projects_team_live_name")) return fail(c, "PROJECT_NAME_CONFLICT", "团队内未删除项目名称已存在", 409);
  return fail(c, "INTERNAL_ERROR", "服务器内部错误", 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP"),
      env.DB.prepare("UPDATE team_invitations SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP"),
      env.DB.prepare("DELETE FROM feedback_rate_limits WHERE created_at < datetime(CURRENT_TIMESTAMP, '-1 hour')"),
    ]);
    console.log(JSON.stringify({ event: "scheduled_cleanup", scheduledTime: controller.scheduledTime }));
  },
};
