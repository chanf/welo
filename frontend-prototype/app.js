import {
  createIcons,
  LayoutDashboard,
  FolderKanban,
  CheckCheck,
  UsersRound,
  Settings2,
  ShieldCheck,
  LogOut,
  LogIn,
  ChevronRight,
  ChevronLeft,
  SunMoon,
  RefreshCw,
  Plus,
  List,
  Search,
  Pencil,
  Save,
  X,
  Check,
  Trash2,
  UserPlus,
  UserMinus,
  CalendarDays,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  MessageSquare,
  Send,
  Play,
  RotateCcw,
  UserRound,
} from "lucide";

import { t, onLangChange, getLang } from "./i18n.js";
const icons = {
  LayoutDashboard,
  FolderKanban,
  CheckCheck,
  UsersRound,
  Settings2,
  ShieldCheck,
  LogOut,
  LogIn,
  ChevronRight,
  ChevronLeft,
  SunMoon,
  RefreshCw,
  Plus,
  List,
  Search,
  Pencil,
  Save,
  X,
  Check,
  Trash2,
  UserPlus,
  UserMinus,
  CalendarDays,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  MessageSquare,
  Send,
  Play,
  RotateCcw,
  UserRound,
};
import { api } from "./api.js";
import "./production.css";

const $ = (selector) => document.querySelector(selector);
const root = $("#root");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const brandMark = `<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="116" fill="#D9EFE5"/><path d="M132 190 L172 324 L216 224 L260 324 L304 190" fill="none" stroke="#167C68" stroke-width="52" stroke-linecap="round" stroke-linejoin="round"/><circle cx="372" cy="324" r="30" fill="#EA705B"/></svg>`;
const bootMark = `<div class="boot"><svg class="boot-icon" viewBox="0 0 512 512" role="img" aria-label="Welo"><rect class="boot-tile" width="512" height="512" rx="116"/><circle class="boot-ripple" cx="372" cy="324" r="34"/><path class="boot-w" d="M132 190 L172 324 L216 224 L260 324 L304 190" pathLength="1"/><circle class="boot-dot" cx="372" cy="324" r="30"/></svg><span class="boot-word">welo</span></div>`;
const labels = {
  onboarding: t("page.createTeamPrompt"),
  workspace: t("nav.admin"),
  projects: t("nav.projects"),
  tasks: t("task.table.task"),
  team: t("team.title"),
  invitations: t("page.myInvitations"),
  trash: t("trash.title"),
  activity: t("activity.title"),
  settings: t("settings.title"),
  admin: t("admin.title"),
};
const statuses = { todo: t("task.status.todo"), in_progress: t("project.active"), done: t("task.markDone") };
const priorities = { low: "低", medium: "中", high: "高", urgent: t("priority.urgent") };
const invitationStatuses = {
  pending: t("task.status"),
  accepted: t("invitation.accept"),
  declined: t("invitation.decline"),
  revoked: t("team.revokeInvitation"),
  expired: t("invitation.expired"),
};
const state = {
  authStatus: "checking",
  user: null,
  teams: [],
  team: null,
  projects: [],
  project: null,
  members: [],
  page: "workspace",
  generation: 0,
  tasks: [],
  gantt: null,
  ganttTimeline: null,
  ganttView: "tasks",
  ganttZoomLevel: 0,
  projectPage: 1,
  taskPage: 1,
  adminPage: 1,
  invitationPage: 1,
  trashPage: 1,
  activityPage: 1,
  trashType: "task",
  filters: {},
};
let toastTimer,
  modalSave,
  modalBusy = false,
  returnFocus;
let feedbackDraft = { nickname: "", contact: "", message: "" };
const admin = () => state.team?.role === "admin";
const platformAdmin = () => state.user?.systemRole === "super_admin";
const writable = () => state.team?.status === "active";
const taskWritable = () => writable() && state.project?.status === "active";
const dateAfter = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-CA");
};
const today = () => dateAfter(0);
const pad = (value) => String(value).padStart(2, "0");
const dateTimeAfter = (days, hour, minute) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return `${date.toLocaleDateString("en-CA")}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const normalizeTaskDateTime = (value) => {
  if (!value) return "";
  const normalized =
    value.length === 10 ? `${value}T00:00` : value.slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):(?:00|30)$/.test(normalized))
    return null;
  const parsed = new Date(`${normalized}:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === normalized.slice(0, 10)
    ? normalized
    : null;
};
const formatTaskDateTime = (value) =>
  value ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : t("task.noStartDate");
const formatInvitationDateTime = (value) => {
  if (!value) return t("task.noDetail");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Shanghai",
      }).format(date);
};
const nowTaskDateTime = () => {
  const date = new Date();
  return `${date.toLocaleDateString("en-CA")}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const parseTaskDate = (value) => {
  if (!value) return Number.NaN;
  const normalized = value.length === 10 ? `${value}T00:00:00Z` : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Date.parse(`${value.slice(0, 16)}:00Z`) : parsed;
};
const taskHalfHours = (value) => parseTaskDate(value) / 1800000;
const addHalfHours = (value, halfHours) =>
  new Date(parseTaskDate(value) + halfHours * 1800000)
    .toISOString()
    .slice(0, 16);
const dayNumber = (value) =>
  Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / 86400000;
const addDays = (value, days) => {
  const hasTime = value.length > 10;
  const parsed = hasTime
    ? Date.parse(`${value}:00Z`)
    : Date.parse(`${value}T00:00:00Z`);
  const result = new Date(parsed + days * 86400000).toISOString();
  return result.slice(0, hasTime ? 16 : 10);
};
const weekdayName = (value) =>
  ["日", "一", "二", "三", "四", "五", "六"][
    new Date(`${value}T00:00:00Z`).getUTCDay()
  ];
const GANTT_GRANULARITIES = {
  hour: {
    label: t("ganttLabels.hour"),
    dayWidth: 768,
    initialDays: 10,
    initialLeftDays: 2,
    trailingDays: 1,
    extensionDays: 5,
    edgeDays: 1,
    snapHalfHours: 2,
    cellHalfHours: 2,
    minDayWidth: 336,
  },
  halfDay: {
    label: t("ganttLabels.halfDay"),
    dayWidth: 128,
    initialDays: 45,
    initialLeftDays: 7,
    trailingDays: 3,
    extensionDays: 21,
    edgeDays: 7,
    snapHalfHours: 24,
    cellHalfHours: 24,
    minDayWidth: 72,
  },
  day: {
    label: t("ganttLabels.day"),
    dayWidth: 64,
    initialDays: 120,
    initialLeftDays: 30,
    trailingDays: 30,
    extensionDays: 60,
    edgeDays: 14,
    snapHalfHours: 48,
    cellHalfHours: 48,
    minDayWidth: 40,
  },
};
const ganttConfig = () =>
  GANTT_GRANULARITIES[state.filters.granularity] ?? GANTT_GRANULARITIES.day;
const GANTT_ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8];
const GANTT_TASK_COLORS = [
  "#2563EB",
  "#DC2626",
  "#059669",
  "#D97706",
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "#65A30D",
  "#EA580C",
  "#0F766E",
  "#9333EA",
  "#BE123C",
];
const ganttDates = () =>
  [
    today(),
    state.gantt?.range?.startDate,
    state.gantt?.range?.endDate,
    ...state.tasks.flatMap((task) => [task.renderStartDate, task.endDate]),
  ].filter(Boolean);
const ganttTaskBounds = (task) => {
  const end = task.isVirtualStart
    ? addHalfHours(task.endDate, ganttConfig().cellHalfHours)
    : task.endDate;
  return [task.renderStartDate, end];
};
const ganttViewSwitch = () =>
  `<div class="view-switch gantt-view-switch" role="group" aria-label=t("gantt.tasks")><button type="button" data-action="gantt-view" data-view="tasks" class="${state.ganttView === "tasks" ? "active" : ""}">任务</button><button type="button" data-action="gantt-view" data-view="assignees" class="${state.ganttView === "assignees" ? "active" : ""}">负责人</button></div>`;
const granularitySwitch = () => {
  const g = state.filters.granularity || "day";
  return `<div class="view-switch granularity-switch" role="radiogroup" aria-label=t("ganttLabels.day")><button type="button" role="radio" aria-checked="${g === "hour"}" data-action="granularity-change" data-granularity="hour" class="${g === "hour" ? "active" : ""}">小时</button><button type="button" role="radio" aria-checked="${g === "halfDay"}" data-action="granularity-change" data-granularity="halfDay" class="${g === "halfDay" ? "active" : ""}">半天</button><button type="button" role="radio" aria-checked="${g === "day"}" data-action="granularity-change" data-granularity="day" class="${g === "day" ? "active" : ""}">天</button></div>`;
};
const ganttZoomLevel = () =>
  Math.min(GANTT_ZOOM_STEPS.length - 1, Math.max(0, state.ganttZoomLevel ?? 0));
const ganttZoomControls = () => {
  const level = ganttZoomLevel();
  const factor = GANTT_ZOOM_STEPS[level];
  return `<div class="zoom-controls" role="group" aria-label=t("gantt.zoomIn")>${tool("gantt-zoom-out", `缩小甘特图（当前 ${factor}x）`, "zoom-out", level <= 0 ? "disabled" : "")}${tool("gantt-zoom-in", `放大甘特图（当前 ${factor}x）`, "zoom-in", level >= GANTT_ZOOM_STEPS.length - 1 ? "disabled" : "")}</div>`;
};
const ganttFullscreenButton = () =>
  tool("gantt-fullscreen", t("gantt.fullscreen"), "maximize-2");
const ganttColor = (value, fallback = GANTT_TASK_COLORS[0]) =>
  /^#[0-9A-F]{6}$/i.test(value ?? "") ? value : fallback;
const taskColor = (task) => {
  let hash = 0;
  for (const character of String(task.id))
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return GANTT_TASK_COLORS[hash % GANTT_TASK_COLORS.length];
};
const options = (items, value = "", blank = null) =>
  `${blank === null ? "" : `<option value="">${esc(blank)}</option>`}${items.map((x) => `<option value="${esc(x.id)}" ${String(x.id) === String(value) ? "selected" : ""}>${esc(x.name ?? x.username)}</option>`).join("")}`;
const teamOptions = () =>
  state.teams
    .map((team) => ({
      id: team.id,
      name: `${team.name} · ${team.role === "admin" ? t("role.admin") : t("role.member")}${
        team.status === "archived" ? t("project.archived") : ""
      }`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
const enumOptions = (items, value, blank) =>
  options(
    Object.entries(items).map(([id, name]) => ({ id, name })),
    value,
    blank,
  );
const button = (action, name, symbol = "plus", extra = "") =>
  `<button type="button" class="btn-secondary" data-action="${action}" ${extra}>${icon(symbol)}${esc(name)}</button>`;
const tool = (action, name, symbol, extra = "") =>
  `<button type="button" class="icon-btn" data-action="${action}" aria-label="${esc(name)}" title="${esc(name)}" ${extra}>${icon(symbol)}</button>`;
const field = (label, name, value = "", type = "text", attrs = "") =>
  `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const textareaField = (label, name, value = "", attrs = "") =>
  `<label class="field"><span>${label}</span><textarea name="${name}" ${attrs}>${esc(value)}</textarea></label>`;
const selectField = (label, name, content) =>
  `<label class="field"><span>${label}</span><select name="${name}" required>${content}</select></label>`;
const empty = (text) => `<div class="empty">${esc(text)}</div>`;
const table = (head, rows) =>
  `<div class="table-scroll"><table class="admin-table"><thead><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}">${empty(t("task.noTasks"))}</td></tr>`}</tbody></table></div>`;
function hydrate() {
  createIcons({ icons });
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast")?.classList.remove("show"), 6000);
}
function errorMessage(error) {
  return `${error.message}${error.details?.length ? `：${error.details.map((x) => `${x.field || ""} ${x.reason}`).join("；")}` : ""}${error.requestId ? `（请求 ${error.requestId}）` : ""}`;
}
function fail(error) {
  if (error.status === 401 && error.code !== "INVALID_CREDENTIALS") {
    state.user = null;
    state.generation++;
    closeDialog(true);
    renderAuth();
  }
  toast(errorMessage(error));
}
async function busy(node, action) {
  if (node?.disabled) return;
  if (node) node.disabled = true;
  try {
    await action();
  } catch (error) {
    fail(error);
  } finally {
    if (node?.isConnected) node.disabled = false;
  }
}
function theme() {
  const next =
    document.documentElement.dataset.theme === "solaris" ? "light" : "solaris";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("welo-theme", next);
  } catch {}
}
function utilities() {
  return '<div class="toast" id="toast" role="status" aria-live="polite"></div><dialog id="dialog" class="modal"></dialog>';
}

function renderSessionLoading(message = t("session.loading")) {
  root.innerHTML = `<section class="session-screen">${bootMark}<div class="session-loading"><span class="session-spinner" aria-hidden="true"></span><p role="status">${esc(message)}</p></div></section>`;
}

function renderSessionError(message) {
  state.authStatus = "error";
  root.innerHTML = `<section class="session-screen">${bootMark}<p class="session-error" role="alert">${esc(message)}</p>${button("session-retry", t("session.retry"), "refresh-cw")}</section>`;
  hydrate();
}

function renderAuth(mode = "login", message = "") {
  state.authStatus = "unauthenticated";
  root.innerHTML = `<section class="auth-screen show"><div class="auth-layout"><aside class="auth-aside"><div class="brand"><div class="brand-mark">${brandMark}</div><span>welo</span></div><div class="auth-quote"><h1>Welo</h1><p>让团队的每一步，都清晰发生。</p></div></aside><div class="auth-form"><div class="auth-tabs"><button data-action="login-mode" class="${mode === "login" ? "active" : ""}">t("auth.login")</button><button data-action="register-mode" class="${mode === "register" ? "active" : ""}">t("auth.register")</button></div><h2>${mode === "login" ? t("auth.login") : t("auth.register")}</h2><p role="status">${esc(message)}</p><form id="authForm" data-mode="${mode}" class="auth-fields">${mode === "login" ? field(t("team.account"), "account", "", "text", 'required autocomplete="username" maxlength="255"') : field(t("auth.username"), "username", "", "text", 'required minlength="2" maxlength="32" autocomplete="username"') + field(t("admin.email"), "email", "", "email", 'required autocomplete="email" maxlength="255"')}${field(t("auth.password"), "password", "", "password", `required ${mode === "register" ? 'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"'}`)}${mode === "register" ? field(t("auth.passwordConfirm"), "passwordConfirmation", "", "password", 'required minlength="8" autocomplete="new-password"') : ""}<button class="btn-primary" type="submit">${icon("log-in")}${mode === "login" ? t("auth.login") : t("auth.register")}</button></form><div class="auth-support">${button("feedback-open", t("auth.feedback"), "message-square")}</div>${tool("theme", t("settings.switchTheme"), "sun-moon")}</div></div></section>${utilities()}`;
  hydrate();
}

function feedbackDialog() {
  openDialog(
    t("auth.feedback"),
    field(
      t("auth.feedbackName"),
      "nickname",
      feedbackDraft.nickname,
      "text",
      'required minlength="1" maxlength="64"',
    ) +
      field(
        t("auth.contact"),
        "contact",
        feedbackDraft.contact,
        "text",
        'required minlength="3" maxlength="128"',
      ) +
      textareaField(
        t("auth.message"),
        "message",
        feedbackDraft.message,
        'required minlength="1" maxlength="1024" rows="6"',
      ),
    async (data) => {
      feedbackDraft = data;
      await api.sendFeedback(data);
      feedbackDraft = { nickname: "", contact: "", message: "" };
      closeDialog(true);
      toast(t("auth.feedbackSent"));
    },
    "",
    t("auth.feedbackSend"),
    "send",
    t("auth.sending"),
  );
}

function shell() {
  drag = null;
  const nav = Object.entries(labels)
    .filter(
      ([key]) => key !== "onboarding" && (key !== "admin" || platformAdmin()),
    )
    .map(
      ([key, label]) =>
        `<button class="nav-item ${state.page === key ? "active" : ""}" data-page="${key}">${icon({ onboarding: "users-round", workspace: "layout-dashboard", projects: "folder-kanban", tasks: "check-check", team: "users-round", invitations: "user-plus", trash: "trash-2", activity: "list", settings: "settings-2", admin: "shield-check" }[key])}${label}</button>`,
    )
    .join("");
  root.innerHTML = `<div class="app"><aside class="sidebar"><div class="brand"><div class="brand-mark">${brandMark}</div><span>welo</span></div><label class="field"><span>当前团队</span><select id="teamSelect" aria-label=t("team.currentTeam")>${options(teamOptions(), state.team?.id, state.teams.length ? null : t("team.noMembers"))}</select></label><nav class="nav">${nav}</nav><div class="sidebar-bottom">${button("logout", t("common.logOut"), "log-out")}<div class="user-mini"><div class="avatar green">${esc(state.user.username.slice(0, 1))}</div><div class="identity"><div class="name">${esc(state.user.username)}</div><small>${state.team ? (admin() ? t("team.role.admin") : t("team.inviteMembers")) : t("team.noMembers")}</small></div></div></div></aside><main class="main"><header class="topbar"><div class="crumbs"><strong>Welo</strong><span>${esc(state.team?.name ?? t("team.noMembers"))}</span>${icon("chevron-right")}<strong id="pageTitle">${labels[state.page]}</strong></div><div class="top-actions">${tool("theme", t("settings.switchTheme"), "sun-moon")}${tool("refresh", t("common.refresh"), "refresh-cw")}<select id="mobileNav" aria-label=t("nav.title")>${options(
    Object.entries(labels)
      .filter(
        ([key]) => key !== "onboarding" && (key !== "admin" || platformAdmin()),
      )
      .map(([id, name]) => ({ id, name })),
    state.page,
  )}</select>${tool("mobile-team", t("team.switchTeam"), "users-round")}</div></header><section class="page-view" id="view" aria-live="polite"></section></main></div>${utilities()}`;
  hydrate();
}

function projectStorageKey(teamId = state.team?.id) {
  return state.user && teamId ? `welo-project:${state.user.id}:${teamId}` : null;
}

function saveSelectedProject(projectId = state.project?.id) {
  const key = projectStorageKey();
  if (!key) return;
  try {
    if (projectId == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(projectId));
  } catch {}
}

function savedProjectId() {
  const key = projectStorageKey();
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function initialize() {
  const me = await api.me();
  state.user = { ...me.data.user, id: String(me.data.user.id) };
  state.teams = (me.data.teams ?? []).map((x) => ({
    ...x,
    id: String(x.id),
  }));
  let saved;
  try {
    saved = localStorage.getItem(`welo-team:${state.user.id}`);
  } catch {}
  state.team =
    state.teams.find((x) => x.id === saved) ?? state.teams[0] ?? null;
  state.page = labels[location.hash.slice(1)]
    ? location.hash.slice(1)
    : "workspace";
  if (!state.team) state.page = "onboarding";
  state.project = null;
  state.filters = {};
  state.authStatus = "authenticated";
  shell();
  await loadTeam();
}
async function loadTeam() {
  const gen = ++state.generation;
  $("#view").innerHTML = empty(t("page.loading"));
  try {
    state.projects = [];
    state.members = [];
    state.tasks = [];
    state.gantt = null;
    if (state.team) {
      const [projects, members] = await Promise.all([
        allProjects(state.team.id),
        api.members(state.team.id),
      ]);
      if (gen !== state.generation) return;
      state.projects = projects;
      state.members = members.data;
      const savedId = savedProjectId();
      state.project =
        projects.find((p) => p.id === state.project?.id) ??
        projects.find((p) => p.id === savedId) ??
        projects[0] ??
        null;
      saveSelectedProject();
    }
    if (gen === state.generation) await navigate(state.page);
  } catch (error) {
    if (gen === state.generation) showLoadError(error, "team-retry");
  }
}
async function allProjects(teamId) {
  const result = await api.projects(teamId, { page: 1, pageSize: 100 });
  const items = [...result.data];
  for (let page = 2; page <= (result.meta.pagination?.totalPages ?? 1); page++)
    items.push(...(await api.projects(teamId, { page, pageSize: 100 })).data);
  return items;
}
function showLoadError(error, action = "refresh") {
  if (error.status === 401) return fail(error);
  $("#view").innerHTML =
    `${empty(errorMessage(error))}${button(action, t("session.retry"), "refresh-cw")}`;
  hydrate();
}
async function navigate(page) {
  drag = null;
  if (!state.user) return;
  state.page = labels[page] ? page : "workspace";
  if (
    !state.team &&
    !["onboarding", "invitations", "settings", "admin"].includes(state.page)
  )
    state.page = "onboarding";
  if (state.team && state.page === "onboarding") state.page = "workspace";
  history.replaceState(null, "", `#${state.page}`);
  $("#pageTitle").textContent = labels[state.page];
  $("#mobileNav").value = state.page;
  document
    .querySelectorAll("[data-page]")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.page === state.page),
    );
  const gen = ++state.generation;
  $("#view").innerHTML = empty(t("page.loading"));
  try {
    await {
      onboarding: onboardingView,
      workspace: workspace,
      projects: projectsView,
      tasks: tasksView,
      team: teamView,
      invitations: invitationsView,
      trash: trashView,
      activity: activityView,
      settings: settingsView,
      admin: adminView,
    }[state.page](gen);
  } catch (error) {
    if (gen === state.generation) showLoadError(error);
  }
  if (gen === state.generation) hydrate();
}
function projectSelector() {
  return `<select id="projectSelect" class="select" aria-label=t("task.currentProject")>${options(state.projects, state.project?.id, state.projects.length ? null : t("project.noProjects"))}</select>`;
}
const nextTaskStatus = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};
const taskStatusActions = {
  todo: { label: t("task.markInProgress"), icon: "play" },
  in_progress: { label: t("task.markDone"), icon: "check" },
  done: { label: t("task.markTodo"), icon: "rotate-ccw" },
};
const taskStatusCell = (task) => {
  const action = taskStatusActions[task.status];
  return `<span class="status ${esc(task.status)}">${esc(statuses[task.status])}</span>${tool(
    "task-cycle-status",
    action.label,
    action.icon,
    `data-id="${esc(task.id)}" data-updated-at="${esc(task.updatedAt)}" ${
      taskWritable() ? "" : "disabled"
    }`,
  )}`;
};
function taskRows(tasks, schedule = false) {
  return tasks
    .map(
      (t) =>
        `<tr><td><button class="text-link" data-action="task-edit" data-id="${esc(t.id)}">${esc(t.title)}</button></td><td>${esc(t.assignee.username)}${t.assignee.isActiveMember === false ? "（已离队）" : ""}</td>${schedule ? `<td>${esc(formatTaskDateTime(t.startDate))}</td>` : ""}<td>${esc(formatTaskDateTime(t.endDate))}</td>${schedule ? `<td><span class="status ${esc(t.status)}">${esc(statuses[t.status])}</span></td>` : `<td>${taskStatusCell(t)}</td>`}${schedule ? "" : `<td>${esc(priorities[t.priority])}</td>`}</tr>`,
    )
    .join("");
}
async function workspace(gen) {
  const [dashboard, gantt] = await Promise.all([
    api.dashboard(state.team.id),
    state.project
      ? api.gantt(state.team.id, state.project.id, {
          granularity: state.filters.granularity || "day",
        })
      : null,
  ]);
  if (gen !== state.generation) return;
  const d = dashboard.data;
  state.gantt = gantt?.data;
  state.tasks = gantt?.data.tasks ?? [];
  const stats = {
    inProgressProjectCount: t("admin.inProgressProjectCount"),
    myOpenTaskCount: t("page.myOpenTasks"),
    visibleTaskCount: t("page.visibleTasks"),
    overdueTaskCount: t("page.overdueTasks"),
  };
  $("#view").innerHTML =
    `<section class="welcome"><div><div class="eyebrow">${esc(today())}</div><h1>你好，${esc(state.user.username)}</h1><p>${d.upcomingDeadlineCount} 个任务即将到期</p></div>${button("task-create", t("task.create"), "plus", taskWritable() ? "" : "disabled")}</section><section class="overview">${Object.entries(
      stats,
    )
      .map(
        ([key, label]) =>
          `<div class="stat"><div class="stat-top">${label}</div><div class="stat-number">${esc(d[key])}</div></div>`,
      )
      .join(
        "",
      )}</section><div class="workspace-grid"><section class="panel"><div class="panel-head"><div><h2>${esc(state.project?.name || t("project.viewSchedule"))}</h2><p>${state.tasks.length} 个可见任务</p></div><div class="head-actions">${projectSelector()}${granularitySwitch()}${ganttZoomControls()}${tool("toggle-view", t("gantt.toggleView"), "list")}${ganttViewSwitch()}${tool("gantt-today", t("gantt.goToday"), "calendar-days")}${ganttFullscreenButton()}</div></div><div id="ganttPanel" class="gantt"></div><div id="scheduleTable" hidden>${table([t("task.table.task"), t("task.table.assignee"), t("task.table.start"), t("task.table.due"), t("task.table.status")], taskRows(state.tasks, true))}</div></section><aside class="side-stack"><section class="panel"><div class="panel-head"><h2>即将到期</h2></div><div class="deadline-list">${d.upcomingDeadlines.map((t) => `<div class="deadline"><div class="date-box"><b>${esc(t.endDate.slice(8, 10))}</b><small>${esc(t.endDate.slice(5, 7))}月</small></div><div class="deadline-name">${esc(t.title)}<small>${esc(t.assignee.username)}</small></div></div>`).join("") || empty(t("page.noUpcoming"))}</div></section><section class="panel"><div class="panel-head"><h2>团队成员</h2></div><div class="members">${state.members.map((m) => `<div class="member-row"><div class="avatar green" style="background:${ganttColor(m.user.color)}">${esc(m.user.username.slice(0, 1))}</div><div class="identity">${esc(m.user.username)}<small>${m.openTaskCount} 个未完成 · ${m.role === "admin" ? t("role.admin") : t("role.member")}</small></div></div>`).join("") || empty(t("team.noMembers"))}</div></section></aside></div>`;
  drawGantt();
}
function resetGanttTimeline() {
  const dates = ganttDates();
  const firstDate = dates.reduce((a, b) => (b < a ? b : a));
  const lastDate = dates.reduce((a, b) => (b > a ? b : a));
  const config = ganttConfig();
  const startDate = addDays(firstDate.slice(0, 10), -config.initialLeftDays);
  state.ganttTimeline = {
    projectId: String(state.project?.id ?? "none"),
    granularity: state.filters.granularity || "day",
    startDate,
    days: Math.max(
      config.initialDays,
      dayNumber(lastDate.slice(0, 10)) +
        config.trailingDays -
        dayNumber(startDate) +
        1,
    ),
    scrollLeft: 0,
    extending: false,
    initialized: false,
  };
}

function ensureGanttTimeline() {
  if (
    !state.ganttTimeline ||
    state.ganttTimeline.projectId !== String(state.project?.id ?? "none") ||
    state.ganttTimeline.granularity !== (state.filters.granularity || "day")
  ) {
    resetGanttTimeline();
    return;
  }

  const timeline = state.ganttTimeline;
  const config = ganttConfig();
  const dates = ganttDates();
  const firstDate = addDays(
    dates.reduce((a, b) => (b < a ? b : a)).slice(0, 10),
    -Math.min(2, config.trailingDays),
  );
  const lastDate = addDays(
    dates.reduce((a, b) => (b > a ? b : a)).slice(0, 10),
    config.trailingDays,
  );
  const currentStart = dayNumber(timeline.startDate);
  if (dayNumber(firstDate) < currentStart) {
    const addedDays = currentStart - dayNumber(firstDate);
    timeline.startDate = firstDate;
    timeline.days += addedDays;
  }
  const requiredDays = dayNumber(lastDate) - dayNumber(timeline.startDate) + 1;
  timeline.days = Math.max(timeline.days, requiredDays);
}

const ganttBarClass = (task) =>
  task.isVirtualStart
    ? "dashed"
    : task.status === "done"
      ? "teal"
      : task.status === "todo"
        ? "coral"
        : "blue";

function ganttBar(
  task,
  timelineStart,
  pixelsPerHalfHour,
  timelineWidth,
  color,
  top = 19,
  conflicted = false,
) {
  const [taskStart, taskEnd] = ganttTaskBounds(task);
  let left = (taskHalfHours(taskStart) - timelineStart) * pixelsPerHalfHour;
  let width =
    (taskHalfHours(taskEnd) - taskHalfHours(taskStart)) * pixelsPerHalfHour;
  if (left < 0) {
    width += left;
    left = 0;
  }
  width = Math.min(width, timelineWidth - left);
  if (width <= 0) return "";
  const barColor = ganttColor(color);
  return `<div class="bar ${ganttBarClass(task)} colored${conflicted ? " conflict" : ""}" data-task-id="${esc(task.id)}" style="--bar-color:${barColor};left:${left}px;width:${width}px;top:${top}px" title="${esc(task.title)}: ${esc(task.startDate ? formatTaskDateTime(task.startDate) : t("task.noStartDate"))} ~ ${esc(formatTaskDateTime(task.endDate))}">${task.isVirtualStart ? "" : '<span class="handle left"></span>'}<span class="bar-label">${esc(task.title)}</span><span class="handle right"></span></div>`;
}

function assigneeGanttRows() {
  const people = new Map();
  for (const task of state.tasks) {
    const id = String(task.assignee.id);
    if (!people.has(id)) people.set(id, { assignee: task.assignee, tasks: [] });
    people.get(id).tasks.push(task);
  }
  return [...people.values()]
    .sort((a, b) =>
      a.assignee.username.localeCompare(b.assignee.username, "zh-Hans-CN"),
    )
    .map((person) => {
      const tasks = [...person.tasks].sort(
        (a, b) =>
          taskHalfHours(a.renderStartDate) - taskHalfHours(b.renderStartDate) ||
          taskHalfHours(a.endDate) - taskHalfHours(b.endDate),
      );
      const conflicts = new Set();
      for (let i = 0; i < tasks.length; i += 1)
        for (let j = i + 1; j < tasks.length; j += 1) {
          const [firstStart, firstEnd] = ganttTaskBounds(tasks[i]);
          const [secondStart, secondEnd] = ganttTaskBounds(tasks[j]);
          if (firstStart < secondEnd && secondStart < firstEnd) {
            conflicts.add(tasks[i].id);
            conflicts.add(tasks[j].id);
          }
        }
      const laneEnds = [];
      const entries = tasks.map((task) => {
        const [start, end] = ganttTaskBounds(task);
        let lane = laneEnds.findIndex((end) => end < start);
        if (lane < 0) {
          lane = laneEnds.length;
          laneEnds.push(taskHalfHours(end));
        } else laneEnds[lane] = taskHalfHours(end);
        return { task, lane };
      });
      return { ...person, entries, laneCount: laneEnds.length, conflicts };
    });
}

function taskGanttRows(
  timelineStart,
  pixelsPerHalfHour,
  timelineWidth,
  config,
  dayWidth,
) {
  return state.tasks
    .map(
      (task) =>
        `<div class="timeline-row" style="grid-template-columns:220px ${timelineWidth}px"><div class="task-info"><button class="task-title text-link" data-action="task-edit" data-id="${esc(task.id)}">${esc(task.title)}</button><div class="task-meta">${esc(task.assignee.username)} </div></div><div class="track granularity-${esc(state.filters.granularity || "day")}" style="--gantt-day-width:${dayWidth}px">${ganttBar(task, timelineStart, pixelsPerHalfHour, timelineWidth, task.assignee.color)}</div></div>`,
    )
    .join("");
}

function assigneeRows(
  timelineStart,
  pixelsPerHalfHour,
  timelineWidth,
  config,
  dayWidth,
) {
  return assigneeGanttRows()
    .map((person) => {
      const rowHeight = Math.max(65, person.laneCount * 38 + 18);
      const conflictCount = person.conflicts.size;
      const personColor = ganttColor(person.assignee.color, "#167C68");
      return `<div class="timeline-row assignee-row" style="grid-template-columns:220px ${timelineWidth}px;min-height:${rowHeight}px"><div class="person-info"><div class="avatar" style="background:${personColor}">${esc(person.assignee.username.slice(0, 1))}</div><div class="identity"><strong>${esc(person.assignee.username)}</strong><small>${person.tasks.length} 项任务${conflictCount ? ` · <span class="conflict-count">${conflictCount} 项冲突</span>` : ""}</small></div></div><div class="track assignee-track granularity-${esc(state.filters.granularity || "day")}" style="--gantt-day-width:${dayWidth}px;height:${rowHeight}px">${person.entries.map(({ task, lane }) => ganttBar(task, timelineStart, pixelsPerHalfHour, timelineWidth, taskColor(task), 9 + lane * 38, person.conflicts.has(task.id))).join("")}</div></div>`;
    })
    .join("");
}

function isGanttFullscreen() {
  const panel = $("#ganttPanel");
  return Boolean(
    panel &&
    (document.fullscreenElement === panel ||
      panel.classList.contains("gantt-fallback-fullscreen")),
  );
}

function updateGanttFullscreenControls() {
  const panel = $("#ganttPanel");
  const active = isGanttFullscreen();
  document
    .querySelectorAll('[data-action="gantt-fullscreen"]')
    .forEach((button) => {
      const label = active ? t("gantt.exitFullscreen") : t("gantt.fullscreen");
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.innerHTML = icon(active ? "minimize-2" : "maximize-2");
    });
  hydrate();
}

async function toggleGanttFullscreen() {
  const panel = $("#ganttPanel");
  if (!panel) return;
  if (document.fullscreenElement === panel) {
    await document.exitFullscreen();
    return;
  }
  if (document.fullscreenElement) await document.exitFullscreen();
  if (panel.requestFullscreen) {
    try {
      await panel.requestFullscreen();
      return;
    } catch {}
  }
  panel.classList.toggle("gantt-fallback-fullscreen");
  updateGanttFullscreenControls();
}

function ganttHeader(startDate, days, config, dayWidth) {
  const granularity = state.filters.granularity || "day";
  const now = nowTaskDateTime();

  if (granularity === "day") {
    const labelMode =
      dayWidth >= 72 ? "full" : dayWidth >= 52 ? "date" : "compact";
    const cells = Array.from({ length: days }, (_, index) => {
      const date = addDays(startDate, index);
      const isToday = date === now.slice(0, 10);
      const label =
        labelMode === "full"
          ? `<strong>${date.slice(5)}</strong><span>周${weekdayName(date)}</span>`
          : labelMode === "date"
            ? `<strong>${date.slice(5)}</strong>`
            : `<strong>${date.slice(8)}</strong>`;
      return `<div class="gantt-cell day-cell day-label-${labelMode}${isToday ? " current" : ""}" style="width:${dayWidth}px" title="${date} 周${weekdayName(date)}" aria-label="${date}，周${weekdayName(date)}">${label}</div>`;
    }).join("");
    return `<div class="timeline-cells granularity-day">${cells}</div>`;
  }

  if (granularity === "halfDay") {
    const halfDayLabel = dayWidth / 2 >= 42 ? [t("ganttLabels.morning"), t("ganttLabels.afternoon")] : [t("ganttLabels.early"), t("ganttLabels.late")];
    const groups = Array.from({ length: days }, (_, index) => {
      const date = addDays(startDate, index);
      const isToday = date === now.slice(0, 10);
      const isMorningActive =
        now.slice(0, 10) === date && Number(now.slice(11, 13)) < 12;
      const isAfternoonActive =
        now.slice(0, 10) === date && Number(now.slice(11, 13)) >= 12;
      const dayLabel =
        dayWidth >= 112
          ? `<strong>${date.slice(5)}</strong><span>周${weekdayName(date)}</span>`
          : `<strong>${date.slice(5)}</strong>`;
      return `<div class="day-group${isToday ? " today" : ""}" style="width:${dayWidth}px"><div class="day-group-label">${dayLabel}</div><div class="day-cells"><div class="gantt-cell${isMorningActive ? " current" : ""}" style="width:${dayWidth / 2}px" aria-label="${date} 上午">${halfDayLabel[0]}</div><div class="gantt-cell${isAfternoonActive ? " current" : ""}" style="width:${dayWidth / 2}px" aria-label="${date} 下午">${halfDayLabel[1]}</div></div></div>`;
    }).join("");
    return `<div class="timeline-cells granularity-halfDay">${groups}</div>`;
  }

  const hourWidth = dayWidth / 24;
  const hourStep = hourWidth >= 28 ? 3 : hourWidth >= 14 ? 6 : 12;
  const groups = Array.from({ length: days }, (_, index) => {
    const date = addDays(startDate, index);
    const isToday = date === now.slice(0, 10);
    const cells = Array.from({ length: 24 }, (_, hour) => {
      const label = hour % hourStep === 0 ? pad(hour) : "";
      const isActive = isToday && Number(now.slice(11, 13)) === hour;
      return `<div class="gantt-cell${isActive ? " current" : ""}" style="width:${hourWidth}px" aria-label="${date} ${pad(hour)}:00">${label}</div>`;
    }).join("");
    return `<div class="day-group${isToday ? " today" : ""}" style="width:${dayWidth}px"><div class="day-group-label"><strong>${date.slice(5)}</strong><span>周${weekdayName(date)}</span></div><div class="day-cells">${cells}</div></div>`;
  }).join("");
  return `<div class="timeline-cells granularity-hour">${groups}</div>`;
}

function responsiveDayWidth() {
  const target = $("#ganttPanel");
  if (!target) return ganttConfig().dayWidth;
  const containerWidth = target.clientWidth;
  const timeline = state.ganttTimeline;
  if (!timeline || !containerWidth) return ganttConfig().dayWidth;
  const labelWidth = 220;
  const available = containerWidth - labelWidth;
  if (available <= 0) return ganttConfig().dayWidth;
  const zoom = GANTT_ZOOM_STEPS[ganttZoomLevel()] ?? 1;
  return Math.max(ganttConfig().minDayWidth, available / timeline.days) * zoom;
}
function drawGantt() {
  const target = $("#ganttPanel");
  if (!target) return;
  if (!state.gantt || !state.tasks.length) {
    state.ganttTimeline = null;
    target.innerHTML = empty(t("task.noTasks"));
    updateGanttZoomControls();
    return;
  }

  ensureGanttTimeline();
  const timeline = state.ganttTimeline;
  const start = timeline.startDate;
  const config = ganttConfig();
  const dayWidth = responsiveDayWidth();
  state.ganttDayWidth = dayWidth;
  const timelineStart = taskHalfHours(start);
  const pixelsPerHalfHour = dayWidth / 48;
  const total = timeline.days;
  const timelineWidth = total * dayWidth;
  const ticks = ganttHeader(start, total, config, dayWidth);

  const rows =
    state.ganttView === "assignees"
      ? assigneeRows(
          timelineStart,
          pixelsPerHalfHour,
          timelineWidth,
          config,
          dayWidth,
        )
      : taskGanttRows(
          timelineStart,
          pixelsPerHalfHour,
          timelineWidth,
          config,
          dayWidth,
        );
  const heading =
    state.ganttView === "assignees" ? "负责人 / 任务" : "任务 / 负责人";
  target.dataset.granularity = state.filters.granularity || "day";
  target.style.setProperty("--gantt-day-width", `${dayWidth}px`);
  target.style.setProperty("--gantt-half-day-width", `${dayWidth / 2}px`);
  target.style.setProperty("--gantt-hour-width", `${dayWidth / 24}px`);
  target.innerHTML = `<div class="gantt-screen-tools">${tool("gantt-fullscreen", t("gantt.exitFullscreen"), "minimize-2")}</div><div class="gantt-inner" style="min-width:${timelineWidth + 220}px"><div class="timeline-head" style="grid-template-columns:220px ${timelineWidth}px"><div class="timeline-spacer">${heading}</div>${ticks}</div>${rows}</div>`;
  updateGanttFullscreenControls();
  updateGanttZoomControls();
  if (!timeline.initialized) {
    timeline.scrollLeft = Math.max(
      0,
      (taskHalfHours(nowTaskDateTime()) - timelineStart) * pixelsPerHalfHour -
        target.clientWidth / 2,
    );
    timeline.initialized = true;
  }
  target.scrollLeft = timeline.scrollLeft;
}

function updateGanttZoomControls() {
  const level = ganttZoomLevel();
  const factor = GANTT_ZOOM_STEPS[level];
  const hasTimeline = Boolean(state.ganttTimeline);
  document
    .querySelectorAll(
      '[data-action="gantt-zoom-in"], [data-action="gantt-zoom-out"]',
    )
    .forEach((button) => {
      const zoomIn = button.dataset.action === "gantt-zoom-in";
      const atBound = zoomIn
        ? level >= GANTT_ZOOM_STEPS.length - 1
        : level <= 0;
      const label = `${zoomIn ? t("gantt.zoomIn") : t("gantt.zoomOut")}甘特图（当前 ${factor}x）`;
      button.disabled = !hasTimeline || atBound;
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    });
}

function setGanttZoom(direction) {
  const viewport = $("#ganttPanel");
  const timeline = state.ganttTimeline;
  if (!viewport || !timeline || timeline.extending) return;
  const level = ganttZoomLevel();
  const nextLevel = level + direction;
  if (nextLevel < 0 || nextLevel >= GANTT_ZOOM_STEPS.length) return;

  const oldDayWidth = state.ganttDayWidth || ganttConfig().dayWidth;
  const labelWidth = 220;
  const centerHalfHours = Math.max(
    0,
    (viewport.scrollLeft + viewport.clientWidth / 2 - labelWidth) /
      (oldDayWidth / 48),
  );

  state.ganttZoomLevel = nextLevel;
  drawGantt();

  const newDayWidth = state.ganttDayWidth || oldDayWidth;
  timeline.scrollLeft = Math.max(
    0,
    labelWidth +
      centerHalfHours * (newDayWidth / 48) -
      viewport.clientWidth / 2,
  );
  viewport.scrollLeft = timeline.scrollLeft;
}

function extendGanttTimeline(viewport, direction) {
  const timeline = state.ganttTimeline;
  if (!timeline || timeline.extending) return;
  timeline.extending = true;
  const previousScrollLeft = viewport.scrollLeft;
  const config = ganttConfig();
  timeline.days += config.extensionDays;
  if (direction === "left")
    timeline.startDate = addDays(timeline.startDate, -config.extensionDays);
  drawGantt();
  const target = $("#ganttPanel");
  target.scrollLeft =
    direction === "left"
      ? previousScrollLeft +
        config.extensionDays * (state.ganttDayWidth || config.dayWidth)
      : previousScrollLeft;
  timeline.scrollLeft = target.scrollLeft;
  if (direction === "left" && ganttPan?.viewport === viewport)
    ganttPan.startScrollLeft +=
      config.extensionDays * (state.ganttDayWidth || config.dayWidth);
  timeline.extending = false;
}
function pager(meta, prefix) {
  const p = meta.pagination;
  return p
    ? `<div class="pager">${tool(`${prefix}-prev`, t("common.prev"), "chevron-left", p.page <= 1 ? "disabled" : "")}<span>第 ${p.page} / ${Math.max(1, p.totalPages)} 页 · ${p.total} 条</span>${tool(`${prefix}-next`, t("common.next"), "chevron-right", p.page >= p.totalPages ? "disabled" : "")}</div>`
    : "";
}
async function projectsView(gen) {
  const result = await api.projects(state.team.id, {
    page: state.projectPage,
    pageSize: 20,
    keyword: state.filters.projectKeyword,
    status: state.filters.projectStatus,
  });
  if (gen !== state.generation) return;
  $("#view").innerHTML =
    `<div class="page-heading"><h1>项目</h1>${button("project-create", t("project.create"), "plus", writable() ? "" : "disabled")}</div><form id="projectSearch" class="toolbar"><input name="keyword" aria-label=t("project.searchProjects") placeholder=t("project.searchProjects") value="${esc(state.filters.projectKeyword)}"><select name="status" aria-label=t("project.status")>${enumOptions({ active: t("project.active"), archived: t("project.archived") }, state.filters.projectStatus, t("task.allStatuses"))}</select><button class="btn-secondary" type="submit">${icon("search")}搜索</button></form>${table([t("nav.projects"), t("task.table.status"), t("task.table.taskCount"), t("admin.updatedAt"), t("common.action")], result.data.map((p) => `<tr><td><button class="text-link" data-action="project-open" data-id="${esc(p.id)}">${esc(p.name)}</button><small class="description">${esc(p.description)}</small></td><td>${p.status === "active" ? t("project.active") : t("project.archived")}</td><td>${p.taskCount}</td><td>${esc(p.updatedAt)}</td><td>${admin() ? tool("project-edit", t("project.edit"), "pencil", `data-id="${esc(p.id)}" ${writable() ? "" : "disabled"}`) : ""}</td></tr>`).join(""))}${pager(result.meta, "project")}`;
}
async function tasksView(gen) {
  const f = state.filters;
  const result = state.project
    ? await api.tasks(state.team.id, state.project.id, {
        page: state.taskPage,
        pageSize: 20,
        keyword: f.keyword,
        status: f.status,
        priority: f.priority,
        assigneeId: f.mine ? state.user.id : "",
        sortBy: f.sortBy || "endDate",
        sortOrder: f.sortOrder || "asc",
      })
    : { data: [], meta: {} };
  if (gen !== state.generation) return;
  state.tasks = result.data;
  $("#view").innerHTML =
    `<div class="page-heading"><h1>任务</h1><div class="head-actions">${projectSelector()}${button("task-create", t("task.create"), "plus", taskWritable() ? "" : "disabled")}</div></div><form id="taskSearch" class="toolbar"><input name="keyword" aria-label=t("task.search") placeholder=t("task.search") value="${esc(f.keyword)}"><select name="status" aria-label=t("task.status")>${enumOptions(statuses, f.status, t("task.allStatuses"))}</select><select name="priority" aria-label=t("task.sortPriority")>${enumOptions(priorities, f.priority, t("task.allPriorities"))}</select><select name="sortBy" aria-label=t("task.sortBy")>${enumOptions({ endDate: t("task.sortEndDate"), createdAt: t("task.sortCreatedAt"), priority: t("task.sortPriority") }, f.sortBy || "endDate")}</select><select name="sortOrder" aria-label=t("task.sortOrder")>${enumOptions({ asc: t("task.sortAsc"), desc: t("task.sortDesc") }, f.sortOrder || "asc")}</select><button type="button" class="mine-filter ${f.mine ? "active" : ""}" data-action="task-mine" aria-pressed="${f.mine ? "true" : "false"}">${icon(f.mine ? "check" : "user-round")}只看我的</button><button class="btn-secondary" type="submit">${icon("search")}搜索</button></form>${f.mine ? `<p class="filter-hint" role="status">当前显示我的任务 · 共 ${result.meta.pagination?.total ?? result.data.length} 项</p>` : ""}${table([t("task.table.task"), t("task.table.assignee"), t("task.table.due"), t("task.table.status"), t("task.sortPriority")], taskRows(result.data))}${pager(result.meta, "task")}`;
}
async function settingsView() {
  $("#view").innerHTML =
    `<div class="page-heading"><h1>${t("settings.title")}</h1></div><form id="profileForm" class="profile-form">${field(t("auth.username"), "username", state.user.username, "text", 'required minlength="2" maxlength="32"')}${field(t("admin.email"), "email", state.user.email, "email", 'required maxlength="255"')}<button class="btn-primary" type="submit">${icon("save")}${t("settings.saveChanges")}</button></form><div class="setting-row"><strong>${t("settings.appearance")}</strong>${button("theme", t("settings.switchTheme"), "sun-moon")}</div><div class="setting-row" style="margin-top:24px"><h2 style="margin-bottom:12px">${t("settings.changePassword")}</h2><form id="passwordForm" class="profile-form">${field(t("settings.currentPassword"), "currentPassword", "", "password", 'required minlength="1"')}${field(t("settings.newPassword"), "newPassword", "", "password", 'required minlength="8"')}${field(t("settings.confirmNewPassword"), "newPasswordConfirmation", "", "password", 'required minlength="8"')}<button class="btn-primary" type="submit">${icon("key-round")}${t("settings.updatePassword")}</button></form></div>`;
}
async function adminView(gen) {
  if (!platformAdmin()) return navigate("workspace");
  const [overview, users, projects] = await Promise.all([
    api.adminOverview(),
    api.adminUsers({
      page: state.adminPage,
      pageSize: 20,
      keyword: state.filters.adminKeyword,
      systemRole: state.filters.adminRole,
    }),
    api.adminProjects({
      page: state.adminPage,
      pageSize: 20,
      keyword: state.filters.adminKeyword,
      status: state.filters.adminProjectStatus,
    }),
  ]);
  if (gen !== state.generation) return;
  const stats = {
    userCount: t("admin.allUsers"),
    activeTeamCount: t("admin.activeTeamCount"),
    inProgressProjectCount: t("admin.inProgressProjectCount"),
    taskCount: t("admin.noDeletedTasks"),
  };
  $("#view").innerHTML =
    `<div class="page-heading"><h1>平台后台</h1><p class="page-subtitle">超级管理员仅可只读查看平台用户与全部团队项目。</p></div><section class="overview">${Object.entries(
      stats,
    )
      .map(
        ([key, name]) =>
          `<div class="stat"><div class="stat-top">${name}</div><div class="stat-number">${overview.data[key]}</div></div>`,
      )
      .join(
        "",
      )}</section><form id="adminSearch" class="toolbar"><input name="adminKeyword" aria-label=t("admin.searchPlaceholder") placeholder=t("admin.searchPlaceholder") value="${esc(state.filters.adminKeyword)}"><select name="adminRole" aria-label=t("admin.platformRole")>${enumOptions({ member: t("admin.roleMember"), super_admin: t("admin.roleSuperAdmin") }, state.filters.adminRole, t("admin.allUserRoles"))}</select><select name="adminProjectStatus" aria-label=t("project.status")>${enumOptions({ active: t("project.active"), archived: t("project.archived") }, state.filters.adminProjectStatus, t("admin.allProjectStatuses"))}</select><button class="btn-secondary" type="submit">${icon("search")}搜索</button></form><section class="panel"><div class="panel-head"><h2>全部用户</h2></div>${table([t("admin.user"), t("admin.email"), t("admin.platformRole"), t("admin.createdAt")], users.data.map((user) => `<tr><td>${esc(user.username)}</td><td>${esc(user.email)}</td><td>${user.systemRole === "super_admin" ? t("admin.roleSuperAdmin") : t("admin.roleMember")}</td><td>${esc(user.createdAt)}</td></tr>`).join(""))}${pager(users.meta, "admin")}</section><section class="panel" style="margin-top:18px"><div class="panel-head"><h2>全部项目</h2></div>${table([t("nav.projects"), t("admin.team"), t("task.table.status"), t("admin.noDeletedTasks"), t("admin.updatedAt")], projects.data.map((project) => `<tr><td>${esc(project.name)}${project.deletedAt ? '<small class="description">已删除</small>' : ""}</td><td>${esc(project.team.name)}</td><td>${project.status === "active" ? t("project.active") : t("project.archived")}</td><td>${project.taskCount}</td><td>${esc(project.updatedAt)}</td></tr>`).join(""))}${pager(projects.meta, "admin")}</section>`;
}

async function adminViewLegacy(gen) {
  return navigate("team");
  const [overview, users] = await Promise.all([
    api.adminOverview(),
    api.adminUsers({
      page: state.adminPage,
      pageSize: 20,
      keyword: state.filters.userKeyword,
      systemRole: state.filters.userRole,
    }),
  ]);
  if (gen !== state.generation) return;
  const names = {
    userCount: t("admin.userCount"),
    activeTeamCount: t("admin.activeTeamCount"),
    inProgressProjectCount: t("admin.inProgressProjectCount"),
    taskCount: t("admin.taskCount"),
  };
  $("#view").innerHTML =
    `<div class="page-heading"><h1>平台控制中心</h1>${button("team-create", t("team.createTeam"))}</div><div class="overview">${Object.entries(
      names,
    )
      .map(
        ([key, name]) =>
          `<div class="stat"><div class="stat-top">${name}</div><div class="stat-number">${overview.data[key]}</div></div>`,
      )
      .join(
        "",
      )}</div><form class="toolbar" id="userSearch"><input name="keyword" aria-label=t("admin.searchUsers") placeholder=t("admin.searchUsers") value="${esc(state.filters.userKeyword)}"><select name="systemRole" aria-label=t("admin.systemRole")>${enumOptions({ member: t("admin.roleMember"), super_admin: t("admin.roleSuperAdmin") }, state.filters.userRole, t("admin.allRoles"))}</select><button class="btn-secondary" type="submit">${icon("search")}搜索</button></form>${table([t("admin.user"), t("admin.email"), t("admin.systemRole"), t("common.action")], users.data.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.email)}</td><td>${u.systemRole === "super_admin" ? t("admin.roleSuperAdmin") : t("admin.roleMember")}</td><td>${tool("role-edit", t("admin.roleEdit"), "shield-check", `data-id="${esc(u.id)}" data-role="${u.systemRole}" ${String(u.id) === state.user.id ? "disabled" : ""}`)}</td></tr>`).join(""))}${pager(users.meta, "admin")}`;
}
async function teamView(gen) {
  const members = (await api.members(state.team.id)).data;
  if (gen !== state.generation) return;
  $("#view").innerHTML =
    `<div class="page-heading"><h1>${esc(state.team.name)}</h1><div class="head-actions">${button("team-edit", t("team.teamSettings"), "settings-2", writable() ? "" : "disabled")}${admin() ? button("invite", t("team.inviteMembers"), "user-plus", writable() ? "" : "disabled") : button("leave-team", t("team.leaveTeam"), "log-out", writable() ? "" : "disabled")}</div></div><p class="page-subtitle">${state.team.status === "active" ? t("team.active") : t("project.archived")} · ${esc(state.team.description || "")}</p>${table([t("admin.user"), t("team.role"), t("team.uncompletedTasks"), t("common.action")], members.map((m) => `<tr><td>${esc(m.user.username)}</td><td><span class="role ${m.role === "admin" ? "admin" : ""}">${m.role === "admin" ? t("role.admin") : t("role.member")}</span></td><td>${m.openTaskCount}</td><td>${admin() && m.user.id !== state.user.id ? tool("member-remove", t("team.removeMember"), "user-minus", `data-id="${esc(m.user.id)}"`) : ""}</td></tr>`).join(""))}`;
}

function openDialog(
  title,
  body,
  save,
  extra = "",
  submitLabel = t("common.save"),
  submitIcon = "check",
  busyLabel = "",
) {
  returnFocus = document.activeElement;
  const d = $("#dialog");
  modalSave = save;
  d.innerHTML = `<form id="dialogForm"${busyLabel ? ` data-busy-label="${esc(busyLabel)}"` : ""}><div class="modal-head"><h2 id="dialogTitle">${esc(title)}</h2>${tool("dialog-close", t("common.close"), "x")}</div><div class="modal-body">${body}<p id="dialogError" role="alert"></p></div><div class="modal-foot">${extra}${button("dialog-close", t("common.cancel"), "x")}${save ? '<button type="submit" class="btn-primary">' + icon(submitIcon) + esc(submitLabel) + "</button>" : ""}</div></form>`;
  d.setAttribute("aria-labelledby", "dialogTitle");
  d.showModal();
  hydrate();
}
function closeDialog(force = false) {
  if (modalBusy && !force) return;
  $("#dialog")?.close();
  modalSave = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}
async function refreshData() {
  state.projects = state.team ? await allProjects(state.team.id) : [];
  state.project =
    state.projects.find((p) => p.id === state.project?.id) ??
    state.projects[0] ??
    null;
  saveSelectedProject();
  state.members = state.team ? (await api.members(state.team.id)).data : [];
  await navigate(state.page);
}
async function projectEditor(id) {
  const p = id ? (await api.project(state.team.id, id)).data : null;
  openDialog(
    p ? t("project.edit") : t("project.create"),
    field(
      t("project.projectName"),
      "name",
      p?.name,
      "text",
      'required minlength="2" maxlength="64"',
    ) +
      `<label class="field"><span>描述</span><textarea name="description" maxlength="2000">${esc(p?.description)}</textarea></label>` +
      (p
        ? selectField(
            t("task.table.status"),
            "status",
            enumOptions({ active: t("project.active"), archived: t("project.archived") }, p.status),
          )
        : ""),
    async (data) => {
      const input = { ...data, description: data.description || null };
      if (p)
        await api.updateProject(state.team.id, p.id, {
          ...input,
          expectedUpdatedAt: p.updatedAt,
        });
      else {
        const result = await api.createProject(state.team.id, input);
        state.project = result.data;
      }
      closeDialog(true);
      await refreshData();
      toast(t("project.projectSaved"));
    },
    p
      ? tool(
          "project-delete",
          t("project.delete"),
          "trash-2",
          `data-id="${p.id}" data-name="${esc(p.name)}" data-updated-at="${esc(p.updatedAt)}"`,
        )
      : "",
  );
}
async function taskEditorLegacy(id) {
  if (!state.project) return;
  let task = id
    ? (await api.task(state.team.id, state.project.id, id)).data
    : null;
  const candidates = state.groups.filter(
    (g) => g.status === "active" || g.id === task?.group.id,
  );
  const groups = admin()
    ? candidates
    : (
        await Promise.all(
          candidates.map(async (g) => {
            try {
              await api.groupMembers(state.team.id, g.id);
              return g;
            } catch (error) {
              if (error.status === 404) return null;
              throw error;
            }
          }),
        )
      ).filter(Boolean);
  openDialog(
    task ? t("task.edit") : t("task.create"),
    field(t("task.title"), "title", task?.title, "text", 'required maxlength="200"') +
      `<label class="field"><span>详细内容</span><textarea class="task-detail" name="detail" maxlength="10000">${esc(task?.detail)}</textarea></label><div class="field-grid">${selectField(t("task.group"), "groupId", options(groups, task?.group.id, t("task.selectGroup")))}${selectField(t("task.table.assignee"), "assigneeId", '<option value="">先选择小组</option>')}</div><div class="field-grid">${field(t("task.startDate"), "startDate", task?.startDate || (task ? "" : dateTimeAfter(0, 9, 0)), "datetime-local", 'step="1800"')}${field(t("task.sortEndDate"), "endDate", task?.endDate || (task ? "" : dateTimeAfter(2, 18, 0)), "datetime-local", 'step="1800" required')}</div><div class="field-grid">${selectField(t("task.table.status"), "status", enumOptions(statuses, task?.status || "todo"))}${selectField(t("task.sortPriority"), "priority", enumOptions(priorities, task?.priority || "medium"))}</div>`,
    taskWritable()
      ? async (data) => {
          const startDate = normalizeTaskDateTime(data.startDate);
          const endDate = normalizeTaskDateTime(data.endDate);
          if (data.startDate && !startDate)
            throw new Error("开始时间必须按 30 分钟对齐");
          if (!endDate) throw new Error("截止时间必须按 30 分钟对齐");
          if (startDate && startDate > endDate)
            throw new Error(t("task.startEndError"));
          const input = {
            ...data,
            startDate: startDate || null,
            endDate,
            detail: data.detail || null,
          };
          try {
            if (task)
              await api.updateTask(state.team.id, state.project.id, task.id, {
                ...input,
                expectedUpdatedAt: task.updatedAt,
              });
            else await api.createTask(state.team.id, state.project.id, input);
          } catch (error) {
            if (error.code === "VERSION_CONFLICT") {
              task = (await api.task(state.team.id, state.project.id, task.id))
                .data;
              throw new Error(
                `任务已被更新，当前状态为“${statuses[task.status]}”，截止 ${formatTaskDateTime(task.endDate)}。你的输入已保留；再次保存将应用这些修改。`,
              );
            }
            throw error;
          }
          closeDialog(true);
          await refreshData();
          toast(t("task.taskSaved"));
        }
      : null,
    task && admin() && taskWritable()
      ? tool("task-delete", t("task.delete"), "trash-2", `data-id="${task.id}"`)
      : "",
  );
  if (!taskWritable())
    $("#dialogForm")
      .querySelectorAll("input,textarea,select")
      .forEach((x) => (x.disabled = true));
  $("#dialogForm").dataset.autoAssignee = task ? "false" : "true";
  if (task) await loadAssignees(task.group.id, task.assignee.id);
}
let assigneeRequest = 0;
// V2 task editor: every active team member can edit every business field.
async function taskEditor(id) {
  if (!state.project) return;
  let task = id
    ? (await api.task(state.team.id, state.project.id, id)).data
    : null;
  const users = state.members
    .filter((m) => m.status === "active")
    .map((m) => ({ ...m.user, name: m.user.username }));
  openDialog(
    task ? t("task.edit") : t("task.create"),
    field(t("task.title"), "title", task?.title, "text", 'required maxlength="200"') +
      `<label class="field"><span>详细内容</span><textarea name="detail" maxlength="10000">${esc(task?.detail)}</textarea></label>` +
      selectField(
        t("task.table.assignee"),
        "assigneeId",
        options(users, task?.assignee.id, t("task.selectAssignee")),
      ) +
      `<div class="field-grid">${field(t("task.startDate"), "startDate", task?.startDate || (task ? "" : dateTimeAfter(0, 9, 0)), "datetime-local", 'step="1800"')}${field(t("task.sortEndDate"), "endDate", task?.endDate || dateTimeAfter(2, 18, 0), "datetime-local", 'step="1800" required')}</div>` +
      `<div class="field-grid">${selectField(t("task.table.status"), "status", enumOptions(statuses, task?.status || "todo"))}${selectField(t("task.sortPriority"), "priority", enumOptions(priorities, task?.priority || "medium"))}</div>`,
    taskWritable()
      ? async (data) => {
          const startDate = normalizeTaskDateTime(data.startDate);
          const endDate = normalizeTaskDateTime(data.endDate);
          if (data.startDate && !startDate)
            throw new Error("开始时间必须按 30 分钟对齐");
          if (!endDate || (startDate && startDate > endDate))
            throw new Error(t("task.timeRangeError"));
          const input = {
            ...data,
            startDate: startDate || null,
            endDate,
            detail: data.detail || null,
          };
          if (task)
            await api.updateTask(state.team.id, state.project.id, task.id, {
              ...input,
              expectedUpdatedAt: task.updatedAt,
            });
          else await api.createTask(state.team.id, state.project.id, input);
          closeDialog(true);
          await refreshData();
          toast(t("task.taskSaved"));
        }
      : null,
    task
      ? tool("task-delete", t("task.delete"), "trash-2", `data-id="${task.id}"`)
      : "",
  );
  if (!taskWritable())
    $("#dialogForm")
      .querySelectorAll("input,textarea,select")
      .forEach((x) => (x.disabled = true));
}

async function onboardingView() {
  const invitations = await api.myInvitations().catch(() => ({ data: [] }));
  const invitationRows = (invitations.data ?? [])
    .map((invitation) => {
      const action =
        invitation.status === "pending"
          ? `${button("invitation-accept", t("invitation.accept"), "check", `data-id="${esc(invitation.id)}"`)}${button("invitation-decline", t("invitation.decline"), "x", `data-id="${esc(invitation.id)}"`)}`
          : `<div class="invitation-status"><span class="status ${esc(invitation.status)}">${esc(invitationStatuses[invitation.status] ?? invitation.status)}</span><small>操作时间：${esc(formatInvitationDateTime(invitation.respondedAt))}</small></div>`;
      return `<div class="member-row"><div class="identity"><strong>${esc(invitation.team.name)}</strong><small>${esc(invitation.inviter.username)} 邀请你加入</small></div><div class="invitation-actions">${action}</div></div>`;
    })
    .join("");
  $("#view").innerHTML =
    `<div class="page-heading"><h1>开始使用 Welo</h1></div><p class="page-subtitle">创建一个团队，或处理其他团队发来的邀请。</p><section class="panel"><div class="panel-head"><h2>创建团队</h2></div><div class="panel-body">${button("team-create", t("team.createTeam"), "plus")}</div></section><section class="panel"><div class="panel-head"><h2>我的邀请</h2></div>${invitationRows || empty(t("invitation.noInvitations"))}</section>`;
}

async function invitationsView() {
  return onboardingView();
}
async function organizationEditorLegacy(kind, id) {
  const current = kind === "team" && id ? state.team : null;
  openDialog(
    `${current ? t("common.edit") : t("common.create")}团队`,
    field(
      t("team.teamName"),
      "name",
      current?.name,
      "text",
      'required minlength="2" maxlength="64"',
    ) +
      field(
        t("team.description"),
        "description",
        current?.description,
        "text",
        'maxlength="500"',
      ),
    async (data) => {
      const input = { name: data.name, description: data.description || null };
      if (current)
        await api.updateTeam(current.id, {
          ...input,
          expectedUpdatedAt: current.updatedAt,
        });
      else await api.createTeam(input);
      state.teams = (await api.teams()).data.map((t) => ({
        ...t,
        id: String(t.id),
      }));
      state.team = current
        ? state.teams.find((t) => t.id === current.id)
        : state.teams.at(-1);
      closeDialog(true);
      shell();
      await loadTeam();
      toast(t("team.teamSaved"));
    },
  );
}
async function inviteMember() {
  openDialog(
    t("team.inviteMembers"),
    field(t("team.account"), "account", "", "text", "required") +
      field(t("team.message"), "message", "", "text", 'maxlength="500"'),
    async (data) => {
      await api.invite(state.team.id, {
        account: data.account,
        message: data.message || null,
      });
      closeDialog(true);
      toast(t("invitation.invitationSent"));
    },
  );
}
async function trashView(gen) {
  const result = await api.trash(state.team.id, {
    page: state.trashPage,
    pageSize: 20,
    type: state.trashType,
  });
  if (gen !== state.generation) return;
  const typeSwitch = `<div class="view-switch trash-switch" role="tablist" aria-label=t("trash.trashTypeSwitch")><button type="button" role="tab" aria-selected="${state.trashType === "task"}" data-action="trash-type" data-type="task" class="${state.trashType === "task" ? "active" : ""}">任务</button><button type="button" role="tab" aria-selected="${state.trashType === "project"}" data-action="trash-type" data-type="project" class="${state.trashType === "project" ? "active" : ""}">项目</button></div>`;
  const restoreAction = (item, resource) =>
    tool(
      "trash-restore",
      t("trash.restore"),
      "rotate-ccw",
      `data-type="${esc(state.trashType)}" data-id="${esc(resource.id)}" data-updated-at="${esc(resource.updatedAt)}" ${
        item.expired || !writable() ? "disabled" : ""
      }`,
    );
  const restoreUntil = (item) =>
    item.expired
      ? '<span class="status todo">恢复期限已过</span>'
      : `可恢复至 ${esc(formatInvitationDateTime(item.restorableUntil))}`;
  const rows = result.data.map((item) => {
    if (state.trashType === "task") {
      const task = item.task;
      return `<tr><td>${esc(task.title)}<small class="description">${esc(task.detail || t("task.noDetail"))}</small></td><td>${esc(task.assignee.username)}${task.assignee.isActiveMember === false ? "（已离队）" : ""}</td><td>${esc(formatTaskDateTime(task.endDate))}</td><td>${esc(formatInvitationDateTime(item.deletedAt))}</td><td>${restoreUntil(item)}</td><td>${restoreAction(item, task)}</td></tr>`;
    }
    const project = item.project;
    return `<tr><td>${esc(project.name)}<small class="description">${esc(project.description || t("project.noDescription"))}</small></td><td>${project.status === "active" ? t("project.active") : t("project.archived")}</td><td>${esc(formatInvitationDateTime(item.deletedAt))}</td><td>${restoreUntil(item)}</td><td>${restoreAction(item, project)}</td></tr>`;
  });
  const heads =
    state.trashType === "task"
      ? [t("task.table.task"), t("task.table.assignee"), t("task.table.due"), t("task.deletedAt"), t("task.restoreUntil"), t("common.action")]
      : [t("nav.projects"), t("task.originalStatus"), t("task.deletedAt"), t("task.restoreUntil"), t("common.action")];
  $("#view").innerHTML =
    `<div class="page-heading"><h1>回收站</h1>${typeSwitch}</div><p class="page-subtitle">已删除的项目和任务可在 30 天内恢复。</p>${table(heads, rows.join(""))}${pager(result.meta, "trash")}`;
}
async function activityView() {
  const result = await api.activity(state.team.id, { page: 1, pageSize: 50 });
  const entityLabel = (item) =>
    item.entityType === "task" && item.entityName
      ? item.entityName
      : `${item.entityType} #${item.entityId}`;
  $("#view").innerHTML =
    `<div class="page-heading"><h1>操作记录</h1></div>${table([t("activity.time"), t("common.action"), t("activity.object")], result.data.map((x) => `<tr><td>${esc(x.createdAt)}</td><td>${esc(x.action)}</td><td>${esc(entityLabel(x))}</td></tr>`).join(""))}`;
}

async function loadAssignees(groupId, value = "", autoSelect = false) {
  const gen = ++assigneeRequest;
  const node = $('#dialog [name="assigneeId"]');
  if (!node) return;
  node.disabled = true;
  node.innerHTML = '<option value="">正在加载...</option>';
  try {
    const users = groupId
      ? (await api.groupMembers(state.team.id, groupId)).data
      : [];
    if (gen !== assigneeRequest || !node.isConnected) return;
    const leastLoaded = [...users]
      .sort(
        (a, b) =>
          (a.openTaskCount ?? 0) - (b.openTaskCount ?? 0) ||
          a.username.localeCompare(b.username, "zh-Hans-CN"),
      )
      .at(0);
    node.innerHTML = options(
      users,
      autoSelect && leastLoaded ? leastLoaded.id : value,
      t("task.selectAssignee"),
    );
  } catch (error) {
    if (node.isConnected)
      node.innerHTML = '<option value="">成员不可用</option>';
    throw error;
  } finally {
    if (gen === assigneeRequest && node.isConnected)
      node.disabled = !taskWritable();
  }
}
function confirmDialog(title, action, name) {
  openDialog(
    title,
    name
      ? field(
          `输入“${esc(name)}”确认删除`,
          "confirmName",
          "",
          "text",
          "required",
        )
      : "<p>此操作会立即生效。</p>",
    async (data) => {
      if (name && data.confirmName !== name) throw new Error(t("task.nameMismatch"));
      await action();
      closeDialog(true);
      await refreshData();
      toast(t("common.operationComplete"));
    },
  );
}
async function organizationEditor(kind, id) {
  const current =
    kind === "team"
      ? id
        ? state.team
        : null
      : state.groups.find((g) => g.id === id);
  const statusOptions =
    kind === "team"
      ? { active: t("team.active"), archived: t("project.archived") }
      : { active: t("team.active"), disabled: t("team.disabled") };
  openDialog(
    `${current ? t("common.edit") : t("common.create")}${kind === "team" ? t("admin.team") : t("task.table.group")}`,
    field(
      t("team.teamName"),
      "name",
      current?.name,
      "text",
      `required minlength="${kind === "team" ? 2 : 1}" maxlength="64"`,
    ) +
      field(
        t("team.description"),
        "description",
        current?.description,
        "text",
        'maxlength="500"',
      ) +
      (current
        ? selectField(
            t("task.table.status"),
            "status",
            enumOptions(statusOptions, current.status),
          )
        : ""),
    async (data) => {
      if (kind === "team") {
        if (current) await api.updateTeam(current.id, data);
        else await api.createTeam(data);
        state.teams = (await api.teams()).data.map((t) => ({
          ...t,
          id: String(t.id),
        }));
        state.team =
          state.teams.find((t) => t.id === state.team?.id) ?? state.teams[0];
      } else if (current) await api.updateGroup(state.team.id, id, data);
      else await api.createGroup(state.team.id, data);
      closeDialog(true);
      shell();
      await loadTeam();
      toast(t("toast.saved"));
    },
  );
}
async function groupMembers(id) {
  const users = (await api.groupMembers(state.team.id, id)).data;
  openDialog(
    t("team.groupMembers"),
    table(
      [t("role.member"), t("common.action")],
      users
        .map(
          (u) =>
            `<tr><td>${esc(u.username)}</td><td>${admin() && writable() ? tool("group-member-remove", t("team.removeGroupMember"), "user-minus", `data-id="${u.id}" data-group="${id}"`) : ""}</td></tr>`,
        )
        .join(""),
    ),
    null,
    admin() && writable()
      ? button(
          "group-member-add",
          t("team.addMember"),
          "user-plus",
          `data-group="${id}"`,
        )
      : "",
  );
}
async function memberAdder(groupId) {
  if (groupId) {
    const members = (await api.members(state.team.id)).data;
    openDialog(
      t("team.addGroupMember"),
      selectField(
        t("role.member"),
        "userId",
        options(
          members.map((x) => x.user),
          "",
          t("team.selectMember"),
        ),
      ),
      async (data) => {
        await api.addGroupMember(state.team.id, groupId, data.userId);
        closeDialog(true);
        await refreshData();
        toast(t("toast.memberAdded"));
      },
    );
  } else {
    const existingUsers = new Set(
      (await api.members(state.team.id)).data.map((x) => String(x.user.id)),
    );
    openDialog(
      t("team.addTeamMember"),
      `<div class="member-picker" id="memberPicker">
        <div class="field"><label for="memberSearch">人员</label>
          <div class="member-input">
            <span class="member-affix" aria-hidden="true">${icon("search")}</span>
            <input id="memberSearch" name="keyword" type="text" autocomplete="off" placeholder=t("team.searchPlaceholder") role="combobox" aria-expanded="false" aria-controls="memberResults" aria-autocomplete="list">
            <button type="button" class="member-clear" data-action="member-clear" aria-label=t("team.clearSelection") title=t("team.clearSelection") hidden>${icon("x")}</button>
            <div class="member-results" id="memberResults" role="listbox" aria-label=t("team.searchResults")></div>
          </div>
        </div>
        <input type="hidden" name="userId">
        <p class="member-state" id="memberState" role="status">正在加载人员...</p>
      </div>`,
      async (data) => {
        if (!data.userId) throw new Error(t("team.selectFirst"));
        await api.addMember(state.team.id, data.userId);
        closeDialog(true);
        await refreshData();
        toast(t("toast.memberAdded"));
      },
    );
    setupMemberPicker(existingUsers);
  }
}

function setupMemberPicker(existingUsers = new Set()) {
  const picker = $("#memberPicker");
  const input = $("#memberSearch");
  const hidden = picker.querySelector('[name="userId"]');
  const results = $("#memberResults");
  const status = $("#memberState");
  const clear = picker.querySelector('[data-action="member-clear"]');
  const save = $('#dialogForm [type="submit"]');
  let requestToken = 0;
  let searchTimer;
  const events = new AbortController();
  save.disabled = true;

  const closeResults = () => {
    results.innerHTML = "";
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
  };
  const setSelected = (user) => {
    hidden.value = user.id;
    input.value = `${user.username} · ${user.email}`;
    save.disabled = false;
    clear.hidden = false;
    status.textContent = `已选择：${user.username}`;
    closeResults();
  };
  const clearSelection = ({ focusInput = true } = {}) => {
    hidden.value = "";
    input.value = "";
    clear.hidden = true;
    save.disabled = true;
    status.textContent = t("team.searchPlaceholder");
    if (focusInput) input.focus();
  };
  const renderResults = (users, token) => {
    if (token !== requestToken || !picker.isConnected) return;
    if (!users.length) {
      closeResults();
      status.textContent = t("team.noResults");
      return;
    }
    status.textContent = `共 ${users.length} 位匹配人员`;
    results.innerHTML = users
      .map((user) => {
        const selected = String(user.id) === hidden.value;
        const existing = existingUsers.has(String(user.id));
        return `<button type="button" role="option" class="member-option" id="member-option-${esc(user.id)}" aria-selected="${selected}" data-action="member-option" data-id="${esc(user.id)}" data-name="${esc(user.username)}" data-email="${esc(user.email)}" ${existing ? "disabled" : ""}>
          <span><strong>${esc(user.username)}</strong><small>${esc(user.email)}</small></span>
          <em>${existing ? t("team.alreadyInTeam") : user.systemRole === "super_admin" ? t("admin.roleSuperAdmin") : t("admin.roleMember")}</em>
        </button>`;
      })
      .join("");
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const searchUsers = async (keyword) => {
    const token = ++requestToken;
    status.textContent = t("team.searching");
    try {
      const result = await api.adminUsers({ keyword, pageSize: 20 });
      renderResults(result.data, token);
    } catch (error) {
      if (token !== requestToken || !picker.isConnected) return;
      closeResults();
      status.textContent = `人员搜索失败：${errorMessage(error)}`;
    }
  };

  picker.addEventListener(
    "input",
    () => {
      hidden.value = "";
      clear.hidden = true;
      save.disabled = true;
      clearTimeout(searchTimer);
      const keyword = input.value.trim();
      searchTimer = setTimeout(() => searchUsers(keyword), 250);
    },
    { signal: events.signal },
  );
  input.addEventListener("focus", () => {
    if (results.children.length) input.setAttribute("aria-expanded", "true");
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" || !results.children.length) return;
    event.preventDefault();
    results.querySelector("button:not([disabled])")?.focus();
  });
  picker.addEventListener(
    "click",
    (event) => {
      const option = event.target.closest('[data-action="member-option"]');
      if (!option || option.disabled) return;
      setSelected({
        id: option.dataset.id,
        username: option.dataset.name,
        email: option.dataset.email,
      });
    },
    { signal: events.signal },
  );
  picker.addEventListener(
    "click",
    (event) => {
      if (!event.target.closest('[data-action="member-clear"]')) return;
      event.stopPropagation();
      clearSelection();
    },
    { signal: events.signal },
  );
  picker.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") closeResults();
    },
    { signal: events.signal },
  );
  root.addEventListener(
    "click",
    (event) => {
      if (!event.target.closest("#memberPicker")) closeResults();
    },
    { capture: true, signal: events.signal },
  );
  $("#dialog").addEventListener(
    "close",
    () => {
      clearTimeout(searchTimer);
      events.abort();
    },
    { once: true },
  );
  searchUsers("");
}

root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === "dialogForm") {
    if (modalBusy || !modalSave) return;
    modalBusy = true;
    const save = modalSave;
    const submitButton = form.querySelector('[type="submit"]');
    const submitLabel = submitButton?.textContent;
    if (submitButton && form.dataset.busyLabel)
      submitButton.textContent = form.dataset.busyLabel;
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    Promise.resolve()
      .then(() => save(data))
      .catch((error) => {
        if (error.status === 401) fail(error);
        else if ($("#dialogError"))
          $("#dialogError").textContent = errorMessage(error);
      })
      .finally(() => {
        modalBusy = false;
        form.querySelectorAll("button").forEach((b) => (b.disabled = false));
        if (submitButton?.isConnected) submitButton.textContent = submitLabel;
      });
    return;
  }
  busy(form.querySelector('[type="submit"]'), async () => {
    if (form.id === "authForm") {
      if (
        form.dataset.mode === "register" &&
        data.password !== data.passwordConfirmation
      )
        throw new Error(t("auth.passwordMismatch"));
      await api[form.dataset.mode](data);
      form.reset();
      await initialize();
    }
    if (form.id === "profileForm") {
      state.user = { ...(await api.profile(data)).data, id: state.user.id };
      shell();
      await navigate("settings");
      toast(t("settings.settingsSaved"));
    }
    if (form.id === "passwordForm") {
      await api.changePassword(data);
      form.reset();
      toast(t("settings.passwordChanged"));
    }
    if (form.id === "projectSearch") {
      state.filters.projectKeyword = data.keyword;
      state.filters.projectStatus = data.status;
      state.projectPage = 1;
      await navigate("projects");
    }
    if (form.id === "taskSearch") {
      Object.assign(state.filters, data, { mine: !!data.mine });
      state.taskPage = 1;
      await navigate("tasks");
    }
    if (form.id === "adminSearch") {
      state.filters.adminKeyword = data.adminKeyword;
      state.filters.adminRole = data.adminRole;
      state.filters.adminProjectStatus = data.adminProjectStatus;
      state.adminPage = 1;
      await navigate("admin");
    }
  });
});
root.addEventListener("change", (event) =>
  busy(null, async () => {
    const node = event.target;
    if (node.id === "teamSelect") {
      state.team = state.teams.find((t) => t.id === node.value);
      state.project = null;
      state.filters = {};
      state.projectPage = state.taskPage = 1;
      try {
        localStorage.setItem(`welo-team:${state.user.id}`, node.value);
      } catch {}
      shell();
      await loadTeam();
    }
    if (node.id === "projectSelect") {
      state.project = state.projects.find((p) => p.id === node.value);
      saveSelectedProject();
      state.taskPage = 1;
      await navigate(state.page);
    }
    if (node.id === "mobileNav") await navigate(node.value);
    if (node.name === "startDate" && node.closest("#dialog") && node.value) {
      const endDate = $('#dialog [name="endDate"]');
      if (endDate) endDate.value = addDays(node.value, 3);
    }
  }),
);
root.addEventListener("click", (event) => {
  const node = event.target.closest("button");
  if (!node || node.disabled) return;
  if (node.dataset.page) {
    navigate(node.dataset.page);
    return;
  }
  const action = node.dataset.action,
    id = node.dataset.id;
  if (action === "gantt-zoom-in" || action === "gantt-zoom-out") {
    setGanttZoom(action === "gantt-zoom-in" ? 1 : -1);
    return;
  }
  busy(node, async () => {
    if (action === "session-retry") restoreSession();
    if (action === "theme") theme();
    if (action === "feedback-open") feedbackDialog();
    if (action === "login-mode" || action === "register-mode")
      renderAuth(action === "login-mode" ? "login" : "register");
    if (action === "logout") {
      await api.logout();
      state.user = null;
      state.generation++;
      state.teams = [];
      state.projects = [];
      state.tasks = [];
      renderAuth();
    }
    if (action === "refresh") await navigate(state.page);
    if (action === "team-retry") await loadTeam();
    if (action === "dialog-close") closeDialog();
    if (action === "project-create" || action === "project-edit")
      await projectEditor(id);
    if (action === "project-open") {
      state.project = (await api.project(state.team.id, id)).data;
      saveSelectedProject();
      await navigate("workspace");
    }
    if (action === "task-create" || action === "task-edit")
      await taskEditor(id);
    if (action === "task-mine") {
      state.filters.mine = !state.filters.mine;
      state.taskPage = 1;
      await navigate("tasks");
    }
    if (action === "task-cycle-status") {
      const task = state.tasks.find((t) => String(t.id) === String(id));
      try {
        const { data: updated } = await api.updateTask(
          state.team.id,
          state.project.id,
          id,
          {
            status: task ? nextTaskStatus[task.status] : "done",
            expectedUpdatedAt: node.dataset.updatedAt,
          },
        );
        const index = state.tasks.findIndex(
          (t) => String(t.id) === String(updated.id),
        );
        if (index >= 0) state.tasks[index] = updated;
        const cell = node.closest("td");
        if (cell) {
          cell.innerHTML = taskStatusCell(updated);
          hydrate();
          cell.querySelector("button")?.focus();
        }
        toast(`任务已改为${statuses[updated.status]}`);
      } catch (error) {
        if (error.code === "VERSION_CONFLICT")
          throw new Error(t("task.versionConflict"));
        throw error;
      }
    }
    if (action === "project-delete") {
      closeDialog();
      confirmDialog(
        t("project.delete"),
        () =>
          api.deleteProject(state.team.id, id, {
            expectedUpdatedAt: node.dataset.updatedAt,
          }),
        node.dataset.name,
      );
    }
    if (action === "task-delete") {
      closeDialog();
      confirmDialog(t("task.delete"), () =>
        api.deleteTask(state.team.id, state.project.id, id, {
          expectedUpdatedAt: state.tasks.find((task) => task.id === id)
            ?.updatedAt,
        }),
      );
    }
    if (
      action === "trash-type" &&
      ["task", "project"].includes(node.dataset.type)
    ) {
      state.trashType = node.dataset.type;
      state.trashPage = 1;
      await navigate("trash");
    }
    if (action === "trash-restore") {
      const input = {
        expectedUpdatedAt: node.dataset.updatedAt,
      };
      if (node.dataset.type === "task")
        await api.restoreTrashTask(state.team.id, id, input);
      else await api.restoreTrashProject(state.team.id, id, input);
      await refreshData();
      toast(t("toast.restored"));
    }
    if (action === "toggle-view") {
      $("#ganttPanel").hidden = !$("#ganttPanel").hidden;
      $("#scheduleTable").hidden = !$("#scheduleTable").hidden;
    }
    if (action === "gantt-today") {
      const viewport = $("#ganttPanel");
      const timeline = state.ganttTimeline;
      if (viewport && timeline) {
        const config = ganttConfig();
        viewport.scrollLeft = Math.max(
          0,
          (taskHalfHours(nowTaskDateTime()) -
            taskHalfHours(timeline.startDate)) *
            ((state.ganttDayWidth || config.dayWidth) / 48) -
            viewport.clientWidth / 2,
        );
      }
    }
    if (action === "gantt-fullscreen") await toggleGanttFullscreen();
    if (
      action === "gantt-view" &&
      ["tasks", "assignees"].includes(node.dataset.view)
    ) {
      state.ganttView = node.dataset.view;
      const viewport = $("#ganttPanel");
      if (state.ganttTimeline)
        state.ganttTimeline.scrollLeft =
          viewport?.scrollLeft ?? state.ganttTimeline.scrollLeft;
      document
        .querySelectorAll('[data-action="gantt-view"]')
        .forEach((button) =>
          button.classList.toggle(
            "active",
            button.dataset.view === state.ganttView,
          ),
        );
      drawGantt();
    }
    if (action === "granularity-change" && node.dataset.granularity) {
      state.filters.granularity = node.dataset.granularity;
      document
        .querySelectorAll('[data-action="granularity-change"]')
        .forEach((button) =>
          button.classList.toggle(
            "active",
            button.dataset.granularity === state.filters.granularity,
          ),
        );
      if (state.project) {
        const { data: gantt } = await api.gantt(
          state.team.id,
          state.project.id,
          {
            granularity: state.filters.granularity,
          },
        );
        state.gantt = gantt;
        state.tasks = gantt?.tasks ?? [];
      }
      resetGanttTimeline();
      drawGantt();
    }
    if (/^(project|task|admin|trash)-(prev|next)$/.test(action)) {
      const [key, direction] = action.split("-");
      state[`${key}Page`] += direction === "next" ? 1 : -1;
      await navigate(state.page);
    }
    if (action === "team-create" || action === "team-edit")
      await organizationEditor(
        "team",
        action === "team-edit" ? state.team.id : null,
      );
    if (action === "invite") await inviteMember();
    if (action === "invitation-accept") {
      await api.acceptInvitation(id);
      await initialize();
    }
    if (action === "invitation-decline") {
      await api.declineInvitation(id);
      await initialize();
    }
    if (action === "leave-team") {
      await api.leaveTeam(state.team.id);
      state.team = null;
      await initialize();
    }
    if (action === "group-create" || action === "group-edit")
      await organizationEditor("group", id);
    if (action === "group-members") await groupMembers(id);
    if (action === "member-add") await memberAdder();
    if (action === "group-member-add") {
      closeDialog();
      await memberAdder(node.dataset.group);
    }
    if (action === "member-remove")
      confirmDialog(t("team.removeTeamMember"), () => api.removeMember(state.team.id, id));
    if (action === "group-member-remove") {
      closeDialog();
      confirmDialog(t("team.removeGroupMember"), () =>
        api.removeGroupMember(state.team.id, node.dataset.group, id),
      );
    }
    if (action === "role-edit")
      openDialog(
        t("admin.roleUpdate"),
        selectField(
          t("admin.systemRole"),
          "systemRole",
          enumOptions(
            { member: t("admin.roleMember"), super_admin: t("admin.roleSuperAdmin") },
            node.dataset.role,
          ),
        ),
        async (data) => {
          await api.updateRole(id, data.systemRole);
          closeDialog(true);
          await navigate("admin");
          toast(t("toast.roleUpdated"));
        },
      );
    if (action === "mobile-team")
      openDialog(
        t("team.switchTeam"),
        selectField(t("admin.team"), "team", options(state.teams, state.team?.id)),
        async (data) => {
          state.team = state.teams.find((t) => t.id === data.team);
          state.project = null;
          state.filters = {};
          closeDialog(true);
          shell();
          await loadTeam();
        },
      );
  });
});
document.addEventListener("fullscreenchange", updateGanttFullscreenControls);
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    $("#ganttPanel")?.classList.contains("gantt-fallback-fullscreen")
  ) {
    $("#ganttPanel").classList.remove("gantt-fallback-fullscreen");
    updateGanttFullscreenControls();
  }
});
root.addEventListener("dblclick", (event) => {
  const bar = event.target.closest("[data-task-id]");
  if (!bar?.dataset.taskId) return;
  event.preventDefault();
  taskEditor(bar.dataset.taskId);
});
root.addEventListener(
  "cancel",
  (event) => {
    event.preventDefault();
    closeDialog();
  },
  true,
);
window.addEventListener("hashchange", () => {
  if (state.authStatus === "authenticated") navigate(location.hash.slice(1));
});

let drag = null;
let ganttPan = null;
root.addEventListener("pointerdown", (event) => {
  if (
    event.button !== 0 ||
    event.target.closest("button, select, input, textarea, .bar")
  )
    return;
  const viewport = event.target.closest("#ganttPanel");
  if (!viewport || !state.ganttTimeline) return;
  ganttPan = {
    viewport,
    pointerId: event.pointerId,
    startX: event.clientX,
    startScrollLeft: viewport.scrollLeft,
  };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("dragging");
  event.preventDefault();
});
root.addEventListener("pointermove", (event) => {
  if (!ganttPan || event.pointerId !== ganttPan.pointerId) return;
  const pointerDelta = event.clientX - ganttPan.startX;
  const nextScrollLeft = ganttPan.startScrollLeft - pointerDelta;
  if (nextScrollLeft < 0) {
    extendGanttTimeline(ganttPan.viewport, "left");
    ganttPan.startScrollLeft = ganttPan.viewport.scrollLeft + pointerDelta;
  } else ganttPan.viewport.scrollLeft = nextScrollLeft;
  event.preventDefault();
});
const endGanttPan = (event) => {
  if (!ganttPan || event.pointerId !== ganttPan.pointerId) return;
  ganttPan.viewport.classList.remove("dragging");
  if (ganttPan.viewport.hasPointerCapture?.(ganttPan.pointerId))
    ganttPan.viewport.releasePointerCapture(ganttPan.pointerId);
  ganttPan = null;
};
root.addEventListener("pointerup", endGanttPan);
root.addEventListener("pointercancel", endGanttPan);
root.addEventListener(
  "scroll",
  (event) => {
    const viewport = event.target.closest?.("#ganttPanel");
    const timeline = state.ganttTimeline;
    if (!viewport || !timeline || timeline.extending) return;
    timeline.scrollLeft = viewport.scrollLeft;
    const edgeWidth =
      ganttConfig().edgeDays * (state.ganttDayWidth || ganttConfig().dayWidth);
    if (viewport.scrollLeft <= edgeWidth) extendGanttTimeline(viewport, "left");
    else if (
      viewport.scrollLeft + viewport.clientWidth >=
      viewport.scrollWidth - edgeWidth
    )
      extendGanttTimeline(viewport, "right");
  },
  true,
);
root.addEventListener("pointerdown", (event) => {
  const bar = event.target.closest("[data-task-id]");
  if (
    !bar ||
    !isGanttFullscreen() ||
    !taskWritable() ||
    bar.dataset.saving ||
    event.button !== 0
  )
    return;
  const task = state.tasks.find((t) => t.id === bar.dataset.taskId);
  if (!task || task.isVirtualStart) return;
  const mode = event.target.classList.contains("left")
    ? "left"
    : event.target.classList.contains("right")
      ? "right"
      : "move";
  drag = {
    bar,
    task,
    mode,
    x: event.clientX,
    pointer: event.pointerId,
    delta: 0,
    team: state.team.id,
    project: state.project.id,
    generation: state.generation,
  };
  bar.setPointerCapture(event.pointerId);
  event.preventDefault();
});
root.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const timeline = state.ganttTimeline;
  const config = ganttConfig();
  const pixelsPerHalfHour = (state.ganttDayWidth || config.dayWidth) / 48;
  const totalHalfHours = timeline.days * 48;
  const timelineStart = taskHalfHours(timeline.startDate);
  const timelineEnd = timelineStart + totalHalfHours;
  const snap = config.snapHalfHours;
  const rawDelta =
    ((event.clientX - drag.x) / drag.bar.parentElement.clientWidth) *
    totalHalfHours;
  let delta = Math.round(rawDelta / snap) * snap;
  const [taskStart, taskEnd] = ganttTaskBounds(drag.task);
  const duration = taskHalfHours(taskEnd) - taskHalfHours(taskStart);
  const maxDurationShift = Math.max(
    0,
    Math.floor((duration - 1) / snap) * snap,
  );
  if (drag.mode === "left")
    delta = Math.min(
      Math.max(
        delta,
        Math.ceil((timelineStart - taskHalfHours(taskStart)) / snap) * snap,
      ),
      maxDurationShift,
    );
  else if (drag.mode === "right")
    delta = Math.max(
      Math.min(
        delta,
        Math.ceil((timelineEnd - taskHalfHours(taskEnd)) / snap) * snap,
      ),
      -maxDurationShift,
    );
  else
    delta = Math.min(
      Math.max(
        delta,
        Math.ceil((timelineStart - taskHalfHours(taskStart)) / snap) * snap,
      ),
      Math.floor((timelineEnd - taskHalfHours(taskEnd)) / snap) * snap,
    );
  drag.delta = delta;
  const start = addHalfHours(
      drag.task.renderStartDate,
      drag.mode === "right" ? 0 : delta,
    ),
    end = addHalfHours(drag.task.endDate, drag.mode === "left" ? 0 : delta);
  drag.bar.style.left = `${(taskHalfHours(start) - timelineStart) * pixelsPerHalfHour}px`;
  drag.bar.style.width = `${(taskHalfHours(end) - taskHalfHours(start)) * pixelsPerHalfHour}px`;
});
root.addEventListener("pointercancel", () => {
  drag = null;
  drawGantt();
});
root.addEventListener("pointerup", () => {
  if (!drag) return;
  const current = drag;
  drag = null;
  if (!current.delta) return;
  current.bar.dataset.saving = "true";
  busy(null, async () => {
    try {
      const result = await api.schedule(
        current.team,
        current.project,
        current.task.id,
        {
          startDate:
            current.task.startDate === null
              ? null
              : addHalfHours(
                  current.task.startDate,
                  current.mode === "right" ? 0 : current.delta,
                ),
          endDate: addHalfHours(
            current.task.endDate,
            current.mode === "left" ? 0 : current.delta,
          ),
          expectedUpdatedAt: current.task.updatedAt,
        },
      );
      if (current.generation === state.generation) {
        state.tasks = state.tasks.map((t) =>
          t.id === result.data.id ? result.data : t,
        );
        if (state.gantt) state.gantt.tasks = state.tasks;
        current.bar.removeAttribute("data-saving");
        current.bar.title = `${result.data.title}: ${
          result.data.startDate
            ? formatTaskDateTime(result.data.startDate)
            : t("task.noStartDate")
        } ~ ${result.data.endDate}`;
        const scheduleTable = $("#scheduleTable");
        if (scheduleTable)
          scheduleTable.innerHTML = table(
            [t("task.table.task"), t("task.table.group"), t("task.table.assignee"), t("task.table.start"), t("task.table.due"), t("task.table.status")],
            taskRows(state.tasks, true),
          );
        toast(t("toast.scheduleSaved"));
      }
    } catch (error) {
      if (current.generation === state.generation) {
        drawGantt();
        if (error.code === "VERSION_CONFLICT") await navigate("workspace");
      }
      throw error;
    }
  });
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.gantt && state.tasks.length) drawGantt();
  }, 100);
});

function restoreSession() {
  state.authStatus = "checking";
  state.user = null;
  renderSessionLoading();
  initialize().catch((error) => {
    state.user = null;
    if (error.status === 401) {
      renderAuth();
      return;
    }
    renderSessionError(errorMessage(error));
  });
}

restoreSession();
