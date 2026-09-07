const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);
export class ApiRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiRequestError";
    Object.assign(this, {
      code: "UNKNOWN_ERROR",
      status: 0,
      details: [],
      requestId: "",
      ...options,
    });
  }
}
export async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
      signal: options.signal ?? AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiRequestError("无法连接服务器，请稍后重试", {
      code: "NETWORK_ERROR",
    });
  }
  const payload = await response.json().catch(() => null);
  const requestId =
    payload?.meta?.requestId ?? response.headers.get("X-Request-Id") ?? "";
  if (!response.ok)
    throw new ApiRequestError(payload?.error?.message ?? "请求失败", {
      ...payload?.error,
      status: response.status,
      requestId,
    });
  if (!payload || !Object.hasOwn(payload, "data"))
    throw new ApiRequestError("服务器响应格式异常", {
      code: "INVALID_RESPONSE",
      status: response.status,
      requestId,
    });
  return payload;
}
export const query = (params = {}) => {
  const value = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== "" && v != null),
  );
  return value.toString() ? `?${value}` : "";
};
const id = (value) => encodeURIComponent(String(value));
const team = (t) => `/teams/${id(t)}`;
const project = (t, p) => `${team(t)}/projects/${id(p)}`;
const task = (t, p, k) => `${project(t, p)}/tasks/${id(k)}`;
const get = (path, params) => apiFetch(`/api/v1${path}${query(params)}`);
const send = (path, method, body) =>
  apiFetch(`/api/v1${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
export const api = {
  me: () => get("/auth/me"),
  login: (x) => send("/auth/login", "POST", x),
  register: (x) => send("/auth/register", "POST", x),
  logout: () => send("/auth/logout", "POST"),
  profile: (x) => send("/users/me", "PATCH", x),
  teams: () => get("/teams"),
  createTeam: (x) => send("/teams", "POST", x),
  updateTeam: (t, x) => send(team(t), "PATCH", x),
  members: (t) => get(`${team(t)}/members`),
  addMember: (t, u) => send(`${team(t)}/members`, "POST", { userId: u }),
  removeMember: (t, u) => send(`${team(t)}/members/${id(u)}`, "DELETE"),
  groups: (t) => get(`${team(t)}/groups`),
  createGroup: (t, x) => send(`${team(t)}/groups`, "POST", x),
  updateGroup: (t, g, x) => send(`${team(t)}/groups/${id(g)}`, "PATCH", x),
  groupMembers: (t, g) => get(`${team(t)}/groups/${id(g)}/members`),
  addGroupMember: (t, g, u) =>
    send(`${team(t)}/groups/${id(g)}/members`, "POST", { userId: u }),
  removeGroupMember: (t, g, u) =>
    send(`${team(t)}/groups/${id(g)}/members/${id(u)}`, "DELETE"),
  dashboard: (t) => get(`${team(t)}/dashboard`),
  projects: (t, x) => get(`${team(t)}/projects`, x),
  project: (t, p) => get(project(t, p)),
  createProject: (t, x) => send(`${team(t)}/projects`, "POST", x),
  updateProject: (t, p, x) => send(project(t, p), "PATCH", x),
  deleteProject: (t, p, n) =>
    send(`${project(t, p)}${query({ confirmName: n })}`, "DELETE"),
  tasks: (t, p, x) => get(`${project(t, p)}/tasks`, x),
  task: (t, p, k) => get(task(t, p, k)),
  createTask: (t, p, x) => send(`${project(t, p)}/tasks`, "POST", x),
  updateTask: (t, p, k, x) => send(task(t, p, k), "PATCH", x),
  deleteTask: (t, p, k) => send(task(t, p, k), "DELETE"),
  gantt: (t, p, x) => get(`${project(t, p)}/gantt`, x),
  schedule: (t, p, k, x) => send(`${task(t, p, k)}/schedule`, "PATCH", x),
  adminOverview: () => get("/admin/overview"),
  adminUsers: (x) => get("/admin/users", x),
  updateRole: (u, r) =>
    send(`/admin/users/${id(u)}/role`, "PATCH", { systemRole: r }),
};
