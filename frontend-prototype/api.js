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
const send = (path, method, body, headers) =>
  apiFetch(`/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const api = {
  me: () => get("/auth/me"),
  login: (x) => send("/auth/login", "POST", x),
  register: (x) => send("/auth/register", "POST", x),
  logout: () => send("/auth/logout", "POST"),
  profile: (x) => send("/users/me", "PATCH", x),
  teams: () => get("/teams"),
  createTeam: (x) =>
    send("/teams", "POST", x, {
      "Idempotency-Key": crypto.randomUUID(),
    }),
  updateTeam: (t, x) => send(team(t), "PATCH", x),
  archiveTeam: (t, x) => send(`${team(t)}/archive`, "POST", x),
  restoreTeam: (t, x) => send(`${team(t)}/restore`, "POST", x),
  members: (t, status = "active") => get(`${team(t)}/members`, { status }),
  removeMember: (t, u) => send(`${team(t)}/members/${id(u)}`, "DELETE"),
  leaveTeam: (t) => send(`${team(t)}/leave`, "POST"),
  teamInvitations: (t, x) => get(`${team(t)}/invitations`, x),
  invite: (t, x) => send(`${team(t)}/invitations`, "POST", x),
  revokeInvitation: (t, k) =>
    send(`${team(t)}/invitations/${id(k)}/revoke`, "POST", {}),
  myInvitations: (x) => get("/users/me/invitations", x),
  acceptInvitation: (k) =>
    send(`/users/me/invitations/${id(k)}/accept`, "POST", {}),
  declineInvitation: (k) =>
    send(`/users/me/invitations/${id(k)}/decline`, "POST", {}),
  dashboard: (t) => get(`${team(t)}/dashboard`),
  projects: (t, x) => get(`${team(t)}/projects`, x),
  project: (t, p) => get(project(t, p)),
  createProject: (t, x) => send(`${team(t)}/projects`, "POST", x),
  updateProject: (t, p, x) => send(project(t, p), "PATCH", x),
  archiveProject: (t, p, x) => send(`${project(t, p)}/archive`, "POST", x),
  restoreProject: (t, p, x) => send(`${project(t, p)}/restore`, "POST", x),
  deleteProject: (t, p, x) => send(project(t, p), "DELETE", x),
  tasks: (t, p, x) => get(`${project(t, p)}/tasks`, x),
  task: (t, p, k) => get(task(t, p, k)),
  createTask: (t, p, x) => send(`${project(t, p)}/tasks`, "POST", x),
  updateTask: (t, p, k, x) => send(task(t, p, k), "PATCH", x),
  deleteTask: (t, p, k, x) => send(task(t, p, k), "DELETE", x),
  moveTask: (t, p, k, x) => send(`${task(t, p, k)}/move`, "POST", x),
  gantt: (t, p, x) => get(`${project(t, p)}/gantt`, x),
  schedule: (t, p, k, x) => send(`${task(t, p, k)}/schedule`, "PATCH", x),
  trash: (t, x) => get(`${team(t)}/trash`, x),
  restoreTrashProject: (t, p, x) =>
    send(`${team(t)}/trash/projects/${id(p)}/restore`, "POST", x),
  restoreTrashTask: (t, k, x) =>
    send(`${team(t)}/trash/tasks/${id(k)}/restore`, "POST", x),
  activity: (t, x) => get(`${team(t)}/activity`, x),
};
