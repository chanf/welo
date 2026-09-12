import type { Context } from "hono";
import { currentAuth } from "./auth";
import { ApiError } from "./errors";

export type TeamStatus = "active" | "archived";
export type ProjectStatus = "active" | "archived";
export type TeamRole = "admin" | "member";

export type TeamRow = {
  id: number;
  name: string;
  description: string | null;
  status: TeamStatus;
  created_by: number;
  created_at: string;
  updated_at: string;
  updated_by: number | null;
};

export type ProjectRow = {
  id: number;
  team_id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_by: number;
  deleted_at: string | null;
  deleted_by: number | null;
  created_at: string;
  updated_at: string;
  updated_by: number | null;
};

export type TeamAccess = { team: TeamRow; role: TeamRole };
export type ProjectAccess = { team: TeamAccess; project: ProjectRow };

type App = { Bindings: Env; Variables: { requestId: string; auth: ReturnType<typeof currentAuth> } };
export type AccessContext = Context<App>;

const invisible = () => new ApiError(404, "NOT_FOUND", "资源不存在或当前用户不可见");

export async function teamAccess(c: AccessContext, teamId: number, write = false): Promise<TeamAccess> {
  const auth = currentAuth(c);
  const row = await c.env.DB.prepare(`
    SELECT t.*, CASE WHEN t.created_by = ? THEN 1 ELSE 0 END AS is_admin
    FROM teams t
    JOIN team_members m ON m.team_id = t.id
    WHERE t.id = ? AND m.user_id = ? AND m.status = 'active'
  `).bind(auth.user.id, teamId, auth.user.id).first<TeamRow & { is_admin: 0 | 1 }>();
  if (!row) throw invisible();
  const { is_admin: isAdmin, ...team } = row;
  if (write && team.status !== "active") {
    throw new ApiError(409, "TEAM_ARCHIVED", "团队已归档，业务数据只读");
  }
  return { team, role: isAdmin ? "admin" : "member" };
}

export async function requireTeamAdmin(c: AccessContext, teamId: number, options: { requireActive?: boolean } = {}) {
  const access = await teamAccess(c, teamId);
  if (access.role !== "admin") throw new ApiError(403, "FORBIDDEN", "仅团队管理员可执行此操作");
  if (options.requireActive && access.team.status !== "active") {
    throw new ApiError(409, "TEAM_ARCHIVED", "团队已归档，不能发起新邀请");
  }
  return access;
}

export async function projectAccess(c: AccessContext, teamId: number, projectId: number, write = false): Promise<ProjectAccess> {
  const team = await teamAccess(c, teamId, write);
  const project = await c.env.DB.prepare(
    "SELECT * FROM projects WHERE id = ? AND team_id = ? AND deleted_at IS NULL",
  ).bind(projectId, teamId).first<ProjectRow>();
  if (!project) throw invisible();
  if (write && project.status !== "active") {
    throw new ApiError(409, "PROJECT_ARCHIVED", "项目已归档，任务只读");
  }
  return { team, project };
}
