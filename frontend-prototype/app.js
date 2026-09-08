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
} from "lucide";

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
const labels = {
  workspace: "工作台",
  projects: "项目",
  tasks: "任务",
  team: "成员与小组",
  settings: "个人设置",
  admin: "超管后台",
};
const statuses = { todo: "待办", in_progress: "进行中", done: "已完成" };
const priorities = { low: "低", medium: "中", high: "高", urgent: "紧急" };
const state = {
  authStatus: "checking",
  user: null,
  teams: [],
  team: null,
  projects: [],
  project: null,
  groups: [],
  page: "workspace",
  generation: 0,
  tasks: [],
  gantt: null,
  ganttTimeline: null,
  ganttView: "tasks",
  projectPage: 1,
  taskPage: 1,
  adminPage: 1,
  filters: {},
};
let toastTimer,
  modalSave,
  modalBusy = false,
  returnFocus;
const admin = () => state.user?.systemRole === "super_admin";
const writable = () => state.team?.status === "active";
const taskWritable = () => writable() && state.project?.status === "active";
const dateAfter = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-CA");
};
const today = () => dateAfter(0);
const dayNumber = (value) => Date.parse(`${value}T00:00:00Z`) / 86400000;
const addDays = (value, days) =>
  new Date((dayNumber(value) + days) * 86400000).toISOString().slice(0, 10);
const GANTT_DAY_WIDTH = 42;
const GANTT_INITIAL_DAYS = 180;
const GANTT_INITIAL_LEFT_DAYS = 60;
const GANTT_EXTENSION_DAYS = 120;
const GANTT_EDGE_DAYS = 21;
const ganttDates = () =>
  [
    today(),
    state.gantt?.range?.startDate,
    state.gantt?.range?.endDate,
    ...state.tasks.flatMap((task) => [task.renderStartDate, task.endDate]),
  ].filter(Boolean);
const ganttViewSwitch = () =>
  `<div class="view-switch gantt-view-switch" role="group" aria-label="甘特图视图"><button type="button" data-action="gantt-view" data-view="tasks" class="${state.ganttView === "tasks" ? "active" : ""}">任务</button><button type="button" data-action="gantt-view" data-view="assignees" class="${state.ganttView === "assignees" ? "active" : ""}">负责人</button></div>`;
const ganttFullscreenButton = () =>
  tool("gantt-fullscreen", "全屏显示甘特图", "maximize-2");
const options = (items, value = "", blank = null) =>
  `${blank === null ? "" : `<option value="">${esc(blank)}</option>`}${items.map((x) => `<option value="${esc(x.id)}" ${String(x.id) === String(value) ? "selected" : ""}>${esc(x.name ?? x.username)}</option>`).join("")}`;
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
const selectField = (label, name, content) =>
  `<label class="field"><span>${label}</span><select name="${name}" required>${content}</select></label>`;
const empty = (text) => `<div class="empty">${esc(text)}</div>`;
const table = (head, rows) =>
  `<div class="table-scroll"><table class="admin-table"><thead><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}">${empty("暂无记录")}</td></tr>`}</tbody></table></div>`;
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

function renderSessionLoading(message = "正在恢复会话...") {
  root.innerHTML = `<section class="session-screen"><div class="brand"><div class="brand-mark">W</div><span>welo</span></div><div class="session-loading"><span class="session-spinner" aria-hidden="true"></span><p role="status">${esc(message)}</p></div></section>`;
}

function renderSessionError(message) {
  state.authStatus = "error";
  root.innerHTML = `<section class="session-screen"><div class="brand"><div class="brand-mark">W</div><span>welo</span></div><p class="session-error" role="alert">${esc(message)}</p>${button("session-retry", "重试", "refresh-cw")}</section>`;
  hydrate();
}

function renderAuth(mode = "login", message = "") {
  state.authStatus = "unauthenticated";
  root.innerHTML = `<section class="auth-screen show"><div class="auth-layout"><aside class="auth-aside"><div class="brand"><div class="brand-mark">W</div><span>welo</span></div><div class="auth-quote"><h1>Welo</h1><p>让团队的每一步，都清晰发生。</p></div></aside><div class="auth-form"><div class="auth-tabs"><button data-action="login-mode" class="${mode === "login" ? "active" : ""}">登录</button><button data-action="register-mode" class="${mode === "register" ? "active" : ""}">注册</button></div><h2>${mode === "login" ? "欢迎回来" : "创建账号"}</h2><p role="status">${esc(message)}</p><form id="authForm" data-mode="${mode}" class="auth-fields">${mode === "login" ? field("用户名或邮箱", "account", "", "text", 'required autocomplete="username" maxlength="255"') : field("用户名", "username", "", "text", 'required minlength="2" maxlength="32" autocomplete="username"') + field("邮箱", "email", "", "email", 'required autocomplete="email" maxlength="255"')}${field("密码", "password", "", "password", `required ${mode === "register" ? 'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"'}`)}${mode === "register" ? field("确认密码", "passwordConfirmation", "", "password", 'required minlength="8" autocomplete="new-password"') : ""}<button class="btn-primary" type="submit">${icon("log-in")}${mode === "login" ? "登录" : "注册"}</button></form>${tool("theme", "切换主题", "sun-moon")}</div></div></section>${utilities()}`;
  hydrate();
}

function shell() {
  drag = null;
  const nav = Object.entries(labels)
    .filter(([key]) => key !== "admin" || admin())
    .map(
      ([key, label]) =>
        `<button class="nav-item ${state.page === key ? "active" : ""}" data-page="${key}">${icon({ workspace: "layout-dashboard", projects: "folder-kanban", tasks: "check-check", team: "users-round", settings: "settings-2", admin: "shield-check" }[key])}${label}</button>`,
    )
    .join("");
  root.innerHTML = `<div class="app"><aside class="sidebar"><div class="brand"><div class="brand-mark">W</div><span>welo</span></div><label class="field"><span>当前团队</span><select id="teamSelect" aria-label="当前团队">${options(state.teams, state.team?.id, state.teams.length ? null : "尚未加入团队")}</select></label><nav class="nav">${nav}</nav><div class="sidebar-bottom">${button("logout", "退出登录", "log-out")}<div class="user-mini"><div class="avatar green">${esc(state.user.username.slice(0, 1))}</div><div class="identity"><div class="name">${esc(state.user.username)}</div><small>${admin() ? "超级管理员" : "普通成员"}</small></div></div></div></aside><main class="main"><header class="topbar"><div class="crumbs"><strong>Welo</strong><span>${esc(state.team?.name ?? "未分配团队")}</span>${icon("chevron-right")}<strong id="pageTitle">${labels[state.page]}</strong></div><div class="top-actions">${tool("theme", "切换主题", "sun-moon")}${tool("refresh", "刷新当前页面", "refresh-cw")}<select id="mobileNav" aria-label="页面导航">${options(
    Object.entries(labels)
      .filter(([key]) => key !== "admin" || admin())
      .map(([id, name]) => ({ id, name })),
    state.page,
  )}</select>${tool("mobile-team", "切换团队", "users-round")}</div></header><section class="page-view" id="view" aria-live="polite"></section></main></div>${utilities()}`;
  hydrate();
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
    saved = localStorage.getItem("welo-team");
  } catch {}
  state.team =
    state.teams.find((x) => x.id === saved) ?? state.teams[0] ?? null;
  state.page = labels[location.hash.slice(1)]
    ? location.hash.slice(1)
    : "workspace";
  if (state.page === "admin" && !admin()) state.page = "workspace";
  state.project = null;
  state.filters = {};
  state.authStatus = "authenticated";
  shell();
  await loadTeam();
}
async function loadTeam() {
  const gen = ++state.generation;
  $("#view").innerHTML = empty("正在加载团队...");
  try {
    state.projects = [];
    state.groups = [];
    state.tasks = [];
    state.gantt = null;
    if (state.team) {
      const [projects, groups] = await Promise.all([
        allProjects(state.team.id),
        api.groups(state.team.id),
      ]);
      if (gen !== state.generation) return;
      state.projects = projects;
      state.groups = groups.data;
      state.project =
        projects.find((p) => p.id === state.project?.id) ?? projects[0] ?? null;
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
    `${empty(errorMessage(error))}${button(action, "重试", "refresh-cw")}`;
  hydrate();
}
async function navigate(page) {
  drag = null;
  if (!state.user) return;
  state.page =
    labels[page] && (page !== "admin" || admin()) ? page : "workspace";
  history.replaceState(null, "", `#${state.page}`);
  $("#pageTitle").textContent = labels[state.page];
  $("#mobileNav").value = state.page;
  document
    .querySelectorAll("[data-page]")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.page === state.page),
    );
  const gen = ++state.generation;
  $("#view").innerHTML = empty("正在加载...");
  if (!state.team && !["settings", "admin"].includes(state.page)) {
    $("#view").innerHTML =
      empty("尚未加入团队，请联系管理员分配团队。") +
      (admin() ? button("team-create", "创建团队") : "");
    hydrate();
    return;
  }
  try {
    await {
      workspace: workspace,
      projects: projectsView,
      tasks: tasksView,
      team: teamView,
      settings: settingsView,
      admin: adminView,
    }[state.page](gen);
  } catch (error) {
    if (gen === state.generation) showLoadError(error);
  }
  if (gen === state.generation) hydrate();
}
function projectSelector() {
  return `<select id="projectSelect" class="select" aria-label="当前项目">${options(state.projects, state.project?.id, state.projects.length ? null : "暂无项目")}</select>`;
}
function taskRows(tasks, schedule = false) {
  return tasks
    .map(
      (t) =>
        `<tr><td><button class="text-link" data-action="task-edit" data-id="${esc(t.id)}">${esc(t.title)}</button></td><td>${esc(t.group.name)}</td><td>${esc(t.assignee.username)}</td>${schedule ? `<td>${esc(t.startDate || "未设置")}</td>` : ""}<td>${esc(t.endDate)}</td><td><span class="status ${esc(t.status)}">${esc(statuses[t.status])}</span></td>${schedule ? "" : `<td>${esc(priorities[t.priority])}</td>`}</tr>`,
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
    inProgressProjectCount: "进行中的项目",
    myOpenTaskCount: "我的待办",
    visibleTaskCount: "可见任务",
    overdueTaskCount: "逾期任务",
  };
  $("#view").innerHTML =
    `<section class="welcome"><div><div class="eyebrow">${esc(today())}</div><h1>你好，${esc(state.user.username)}</h1><p>${d.upcomingDeadlineCount} 个任务即将到期</p></div>${button("task-create", "新建任务", "plus", taskWritable() ? "" : "disabled")}</section><section class="overview">${Object.entries(
      stats,
    )
      .map(
        ([key, label]) =>
          `<div class="stat"><div class="stat-top">${label}</div><div class="stat-number">${esc(d[key])}</div></div>`,
      )
      .join(
        "",
      )}</section><div class="workspace-grid"><section class="panel"><div class="panel-head"><div><h2>${esc(state.project?.name || "项目排期")}</h2><p>${state.tasks.length} 个可见任务</p></div><div class="head-actions">${projectSelector()}<select id="granularity" class="select" aria-label="时间粒度">${enumOptions({ day: "日", week: "周", month: "月" }, state.filters.granularity || "day")}</select>${tool("toggle-view", "切换甘特图与列表", "list")}</div></div><div id="ganttPanel" class="gantt"></div><div id="scheduleTable" hidden>${table(["任务", "小组", "负责人", "开始", "截止", "状态"], taskRows(state.tasks, true))}</div></section><aside class="side-stack"><section class="panel"><div class="panel-head"><h2>即将到期</h2></div><div class="deadline-list">${d.upcomingDeadlines.map((t) => `<div class="deadline"><div class="date-box"><b>${esc(t.endDate.slice(8))}</b><small>${esc(t.endDate.slice(5, 7))}月</small></div><div class="deadline-name">${esc(t.title)}<small>${esc(t.assignee.username)}</small></div></div>`).join("") || empty("暂无即将到期任务")}</div></section><section class="panel"><div class="panel-head"><h2>团队小组</h2></div><div class="members">${state.groups.map((g) => `<div class="member-row"><div class="avatar green">${esc(g.name.slice(0, 1))}</div><div class="identity">${esc(g.name)}<small>${g.memberCount} 位成员 · ${g.status === "active" ? "正常" : "已停用"}</small></div></div>`).join("") || empty("暂无小组")}</div></section></aside></div>`;
  $("#granularity")?.insertAdjacentHTML(
    "afterend",
    `${ganttViewSwitch()}${tool("gantt-today", "回到今天", "calendar-days")}${ganttFullscreenButton()}`,
  );
  drawGantt();
}
function resetGanttTimeline() {
  const dates = ganttDates();
  const firstDate = dates.reduce((a, b) => (b < a ? b : a));
  const lastDate = dates.reduce((a, b) => (b > a ? b : a));
  const startDate = addDays(firstDate, -GANTT_INITIAL_LEFT_DAYS);
  state.ganttTimeline = {
    projectId: String(state.project?.id ?? "none"),
    startDate,
    days: Math.max(
      GANTT_INITIAL_DAYS,
      dayNumber(addDays(lastDate, 45)) - dayNumber(startDate) + 1,
    ),
    scrollLeft: 0,
    extending: false,
    initialized: false,
  };
}

function ensureGanttTimeline() {
  if (
    !state.ganttTimeline ||
    state.ganttTimeline.projectId !== String(state.project?.id ?? "none")
  ) {
    resetGanttTimeline();
    return;
  }

  const timeline = state.ganttTimeline;
  const dates = ganttDates();
  const firstDate = addDays(
    dates.reduce((a, b) => (b < a ? b : a)),
    -14,
  );
  const lastDate = addDays(
    dates.reduce((a, b) => (b > a ? b : a)),
    45,
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

function ganttBar(task, startDay, timelineWidth, top = 19, conflicted = false) {
  const taskStart = dayNumber(task.renderStartDate);
  const taskEnd = dayNumber(task.endDate);
  let left = (taskStart - startDay) * GANTT_DAY_WIDTH;
  let width = (taskEnd - taskStart + 1) * GANTT_DAY_WIDTH;
  if (left < 0) {
    width += left;
    left = 0;
  }
  width = Math.min(width, timelineWidth - left);
  if (width <= 0) return "";
  return `<div class="bar ${ganttBarClass(task)}${conflicted ? " conflict" : ""}" data-task-id="${esc(task.id)}" style="left:${left}px;width:${width}px;top:${top}px" title="${esc(task.title)}: ${esc(task.startDate || "未设置开始日期")} ~ ${esc(task.endDate)}">${task.isVirtualStart ? "" : '<span class="handle left"></span>'}<span class="bar-label">${esc(task.title)}</span><span class="handle right"></span></div>`;
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
          dayNumber(a.renderStartDate) - dayNumber(b.renderStartDate) ||
          dayNumber(a.endDate) - dayNumber(b.endDate),
      );
      const conflicts = new Set();
      for (let i = 0; i < tasks.length; i += 1)
        for (let j = i + 1; j < tasks.length; j += 1)
          if (
            dayNumber(tasks[i].renderStartDate) <=
              dayNumber(tasks[j].endDate) &&
            dayNumber(tasks[j].renderStartDate) <= dayNumber(tasks[i].endDate)
          ) {
            conflicts.add(tasks[i].id);
            conflicts.add(tasks[j].id);
          }
      const laneEnds = [];
      const entries = tasks.map((task) => {
        const start = dayNumber(task.renderStartDate);
        let lane = laneEnds.findIndex((end) => end < start);
        if (lane < 0) {
          lane = laneEnds.length;
          laneEnds.push(dayNumber(task.endDate));
        } else laneEnds[lane] = dayNumber(task.endDate);
        return { task, lane };
      });
      return { ...person, entries, laneCount: laneEnds.length, conflicts };
    });
}

function taskGanttRows(startDay, timelineWidth) {
  return state.tasks
    .map(
      (task) =>
        `<div class="timeline-row" style="grid-template-columns:220px ${timelineWidth}px"><div class="task-info"><button class="task-title text-link" data-action="task-edit" data-id="${esc(task.id)}">${esc(task.title)}</button><div class="task-meta">${esc(task.group.name)} · ${esc(task.assignee.username)}</div></div><div class="track">${ganttBar(task, startDay, timelineWidth)}</div></div>`,
    )
    .join("");
}

function assigneeRows(startDay, timelineWidth) {
  return assigneeGanttRows()
    .map((person) => {
      const rowHeight = Math.max(65, person.laneCount * 38 + 18);
      const conflictCount = person.conflicts.size;
      return `<div class="timeline-row assignee-row" style="grid-template-columns:220px ${timelineWidth}px;min-height:${rowHeight}px"><div class="person-info"><div class="avatar green">${esc(person.assignee.username.slice(0, 1))}</div><div class="identity"><strong>${esc(person.assignee.username)}</strong><small>${person.tasks.length} 项任务${conflictCount ? ` · <span class="conflict-count">${conflictCount} 项冲突</span>` : ""}</small></div></div><div class="track assignee-track" style="height:${rowHeight}px">${person.entries.map(({ task, lane }) => ganttBar(task, startDay, timelineWidth, 9 + lane * 38, person.conflicts.has(task.id))).join("")}</div></div>`;
    })
    .join("");
}

function updateGanttFullscreenControls() {
  const panel = $("#ganttPanel");
  const active =
    document.fullscreenElement === panel ||
    panel?.classList.contains("gantt-fallback-fullscreen");
  document
    .querySelectorAll('[data-action="gantt-fullscreen"]')
    .forEach((button) => {
      const label = active ? "退出全屏" : "全屏显示甘特图";
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

function drawGantt() {
  const target = $("#ganttPanel");
  if (!target) return;
  if (!state.gantt || !state.tasks.length) {
    state.ganttTimeline = null;
    target.innerHTML = empty("暂无任务");
    return;
  }

  ensureGanttTimeline();
  const timeline = state.ganttTimeline;
  const start = timeline.startDate;
  const startDay = dayNumber(start);
  const total = timeline.days;
  const timelineWidth = total * GANTT_DAY_WIDTH;
  const step =
    state.filters.granularity === "month"
      ? 30
      : state.filters.granularity === "week"
        ? 7
        : 1;
  const currentDay = today();
  const ticks = Array.from({ length: Math.ceil(total / step) }, (_, index) => {
    const date = addDays(start, index * step);
    const span = Math.min(step, total - index * step);
    const containsToday =
      currentDay >= date && currentDay < addDays(date, span);
    return `<div class="day${containsToday ? " today" : ""}" style="width:${span * GANTT_DAY_WIDTH}px"><strong>${date.slice(5)}</strong></div>`;
  }).join("");

  const rows =
    state.ganttView === "assignees"
      ? assigneeRows(startDay, timelineWidth)
      : taskGanttRows(startDay, timelineWidth);
  const heading =
    state.ganttView === "assignees" ? "负责人 / 任务" : "任务 / 负责人";
  target.innerHTML = `<div class="gantt-screen-tools">${tool("gantt-fullscreen", "退出全屏", "minimize-2")}</div><div class="gantt-inner" style="width:${timelineWidth + 220}px"><div class="timeline-head" style="grid-template-columns:220px ${timelineWidth}px"><div class="timeline-spacer">${heading}</div><div class="days" style="width:${timelineWidth}px">${ticks}</div></div>${rows}</div>`;
  updateGanttFullscreenControls();
  if (!timeline.initialized) {
    timeline.scrollLeft = Math.max(
      0,
      (dayNumber(today()) - startDay) * GANTT_DAY_WIDTH -
        target.clientWidth / 2,
    );
    timeline.initialized = true;
  }
  target.scrollLeft = timeline.scrollLeft;
}

function extendGanttTimeline(viewport, direction) {
  const timeline = state.ganttTimeline;
  if (!timeline || timeline.extending) return;
  timeline.extending = true;
  const previousScrollLeft = viewport.scrollLeft;
  timeline.days += GANTT_EXTENSION_DAYS;
  if (direction === "left")
    timeline.startDate = addDays(timeline.startDate, -GANTT_EXTENSION_DAYS);
  drawGantt();
  const target = $("#ganttPanel");
  target.scrollLeft =
    direction === "left"
      ? previousScrollLeft + GANTT_EXTENSION_DAYS * GANTT_DAY_WIDTH
      : previousScrollLeft;
  timeline.scrollLeft = target.scrollLeft;
  if (direction === "left" && ganttPan?.viewport === viewport)
    ganttPan.startScrollLeft += GANTT_EXTENSION_DAYS * GANTT_DAY_WIDTH;
  timeline.extending = false;
}
function pager(meta, prefix) {
  const p = meta.pagination;
  return p
    ? `<div class="pager">${tool(`${prefix}-prev`, "上一页", "chevron-left", p.page <= 1 ? "disabled" : "")}<span>第 ${p.page} / ${Math.max(1, p.totalPages)} 页 · ${p.total} 条</span>${tool(`${prefix}-next`, "下一页", "chevron-right", p.page >= p.totalPages ? "disabled" : "")}</div>`
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
    `<div class="page-heading"><h1>项目</h1>${button("project-create", "新建项目", "plus", writable() ? "" : "disabled")}</div><form id="projectSearch" class="toolbar"><input name="keyword" aria-label="搜索项目" placeholder="搜索项目" value="${esc(state.filters.projectKeyword)}"><select name="status" aria-label="项目状态">${enumOptions({ active: "进行中", archived: "已归档" }, state.filters.projectStatus, "全部状态")}</select><button class="btn-secondary" type="submit">${icon("search")}搜索</button></form>${table(["项目", "状态", "任务数", "更新时间", "操作"], result.data.map((p) => `<tr><td><button class="text-link" data-action="project-open" data-id="${esc(p.id)}">${esc(p.name)}</button><small class="description">${esc(p.description)}</small></td><td>${p.status === "active" ? "进行中" : "已归档"}</td><td>${p.taskCount}</td><td>${esc(p.updatedAt)}</td><td>${admin() ? tool("project-edit", "编辑项目", "pencil", `data-id="${esc(p.id)}" ${writable() ? "" : "disabled"}`) : ""}</td></tr>`).join(""))}${pager(result.meta, "project")}`;
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
        groupId: f.groupId,
        assigneeId: f.mine ? state.user.id : "",
        sortBy: f.sortBy || "endDate",
        sortOrder: f.sortOrder || "asc",
      })
    : { data: [], meta: {} };
  if (gen !== state.generation) return;
  state.tasks = result.data;
  $("#view").innerHTML =
    `<div class="page-heading"><h1>任务</h1><div class="head-actions">${projectSelector()}${button("task-create", "新建任务", "plus", taskWritable() ? "" : "disabled")}</div></div><form id="taskSearch" class="toolbar"><input name="keyword" aria-label="搜索任务" placeholder="搜索任务" value="${esc(f.keyword)}"><select name="status" aria-label="任务状态">${enumOptions(statuses, f.status, "全部状态")}</select><select name="priority" aria-label="优先级">${enumOptions(priorities, f.priority, "全部优先级")}</select><select name="groupId" aria-label="小组">${options(state.groups, f.groupId, "全部小组")}</select><select name="sortBy" aria-label="排序字段">${enumOptions({ endDate: "截止日期", createdAt: "创建时间", priority: "优先级" }, f.sortBy || "endDate")}</select><select name="sortOrder" aria-label="排序方向">${enumOptions({ asc: "升序", desc: "降序" }, f.sortOrder || "asc")}</select><label><input type="checkbox" name="mine" ${f.mine ? "checked" : ""}>只看我的</label><button class="btn-secondary" type="submit">${icon("search")}搜索</button></form>${table(["任务", "小组", "负责人", "截止", "状态", "优先级"], taskRows(result.data))}${pager(result.meta, "task")}`;
}
async function settingsView() {
  $("#view").innerHTML =
    `<div class="page-heading"><h1>个人设置</h1></div><form id="profileForm" class="profile-form">${field("用户名", "username", state.user.username, "text", 'required minlength="2" maxlength="32"')}${field("邮箱", "email", state.user.email, "email", 'required maxlength="255"')}<button class="btn-primary" type="submit">${icon("save")}保存修改</button></form><div class="setting-row"><strong>外观</strong>${button("theme", "切换主题", "sun-moon")}</div>`;
}
async function adminView(gen) {
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
    userCount: "全部人员",
    activeTeamCount: "活跃团队",
    inProgressProjectCount: "进行中项目",
    taskCount: "平台任务",
  };
  $("#view").innerHTML =
    `<div class="page-heading"><h1>平台控制中心</h1>${button("team-create", "创建团队")}</div><div class="overview">${Object.entries(
      names,
    )
      .map(
        ([key, name]) =>
          `<div class="stat"><div class="stat-top">${name}</div><div class="stat-number">${overview.data[key]}</div></div>`,
      )
      .join(
        "",
      )}</div><form class="toolbar" id="userSearch"><input name="keyword" aria-label="搜索人员" placeholder="搜索人员" value="${esc(state.filters.userKeyword)}"><select name="systemRole" aria-label="系统角色">${enumOptions({ member: "普通成员", super_admin: "超级管理员" }, state.filters.userRole, "全部角色")}</select><button class="btn-secondary" type="submit">${icon("search")}搜索</button></form>${table(["人员", "邮箱", "系统角色", "操作"], users.data.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.email)}</td><td>${u.systemRole === "super_admin" ? "超级管理员" : "普通成员"}</td><td>${tool("role-edit", "修改角色", "shield-check", `data-id="${esc(u.id)}" data-role="${u.systemRole}" ${String(u.id) === state.user.id ? "disabled" : ""}`)}</td></tr>`).join(""))}${pager(users.meta, "admin")}`;
}
async function teamView(gen) {
  const members = admin() ? (await api.members(state.team.id)).data : [];
  if (gen !== state.generation) return;
  $("#view").innerHTML =
    `<div class="page-heading"><h1>${esc(state.team.name)}</h1><div class="head-actions">${admin() ? button("team-edit", "团队设置", "settings-2") + button("group-create", "新建小组", "plus", writable() ? "" : "disabled") + button("member-add", "添加成员", "user-plus", writable() ? "" : "disabled") : ""}</div></div><p class="page-subtitle">${state.team.status === "active" ? "正常" : "已归档"} · ${esc(state.team.description)}</p>${table(["小组", "状态", "成员", "操作"], state.groups.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.status === "active" ? "正常" : "已停用"}</td><td>${g.memberCount}</td><td>${tool("group-members", "查看成员", "users-round", `data-id="${g.id}"`)}${admin() ? tool("group-edit", "编辑小组", "pencil", `data-id="${g.id}" ${writable() ? "" : "disabled"}`) : ""}</td></tr>`).join(""))}${admin() ? `<h2 class="subheading">团队成员</h2>${table(["人员", "邮箱", "操作"], members.map((m) => `<tr><td>${esc(m.user.username)}</td><td>${esc(m.user.email)}</td><td>${tool("member-remove", "移除成员", "user-minus", `data-id="${esc(m.user.id)}" ${writable() ? "" : "disabled"}`)}</td></tr>`).join(""))}` : ""}`;
}

function openDialog(title, body, save, extra = "") {
  returnFocus = document.activeElement;
  const d = $("#dialog");
  modalSave = save;
  d.innerHTML = `<form id="dialogForm"><div class="modal-head"><h2 id="dialogTitle">${esc(title)}</h2>${tool("dialog-close", "关闭", "x")}</div><div class="modal-body">${body}<p id="dialogError" role="alert"></p></div><div class="modal-foot">${extra}${button("dialog-close", "取消", "x")}${save ? '<button type="submit" class="btn-primary">' + icon("check") + "保存</button>" : ""}</div></form>`;
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
  state.groups = state.team ? (await api.groups(state.team.id)).data : [];
  await navigate(state.page);
}
async function projectEditor(id) {
  const p = id ? (await api.project(state.team.id, id)).data : null;
  openDialog(
    p ? "编辑项目" : "新建项目",
    field(
      "项目名称",
      "name",
      p?.name,
      "text",
      'required minlength="2" maxlength="64"',
    ) +
      `<label class="field"><span>描述</span><textarea name="description" maxlength="2000">${esc(p?.description)}</textarea></label>` +
      (p
        ? selectField(
            "状态",
            "status",
            enumOptions({ active: "进行中", archived: "已归档" }, p.status),
          )
        : ""),
    async (data) => {
      const input = { ...data, description: data.description || null };
      if (p) await api.updateProject(state.team.id, p.id, input);
      else {
        const result = await api.createProject(state.team.id, input);
        state.project = result.data;
      }
      closeDialog(true);
      await refreshData();
      toast("项目已保存");
    },
    p
      ? tool(
          "project-delete",
          "删除项目",
          "trash-2",
          `data-id="${p.id}" data-name="${esc(p.name)}"`,
        )
      : "",
  );
}
async function taskEditor(id) {
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
    task ? "编辑任务" : "新建任务",
    field("标题", "title", task?.title, "text", 'required maxlength="200"') +
      `<label class="field"><span>详细内容</span><textarea class="task-detail" name="detail" maxlength="10000">${esc(task?.detail)}</textarea></label><div class="field-grid">${selectField("所属小组", "groupId", options(groups, task?.group.id, "选择小组"))}${selectField("负责人", "assigneeId", '<option value="">先选择小组</option>')}</div><div class="field-grid">${field("开始日期", "startDate", task?.startDate || (task ? "" : today()), "date")}${field("截止日期", "endDate", task?.endDate || (task ? "" : dateAfter(2)), "date", "required")}</div><div class="field-grid">${selectField("状态", "status", enumOptions(statuses, task?.status || "todo"))}${selectField("优先级", "priority", enumOptions(priorities, task?.priority || "medium"))}</div>`,
    taskWritable()
      ? async (data) => {
          if (data.startDate && data.startDate > data.endDate)
            throw new Error("开始日期不能晚于截止日期");
          const input = {
            ...data,
            startDate: data.startDate || null,
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
                `任务已被更新，当前状态为“${statuses[task.status]}”，截止 ${task.endDate}。你的输入已保留；再次保存将应用这些修改。`,
              );
            }
            throw error;
          }
          closeDialog(true);
          await refreshData();
          toast("任务已保存");
        }
      : null,
    task && admin() && taskWritable()
      ? tool("task-delete", "删除任务", "trash-2", `data-id="${task.id}"`)
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
      "选择负责人",
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
      if (name && data.confirmName !== name) throw new Error("名称不匹配");
      await action();
      closeDialog(true);
      await refreshData();
      toast("操作已完成");
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
      ? { active: "正常", archived: "已归档" }
      : { active: "正常", disabled: "已停用" };
  openDialog(
    `${current ? "编辑" : "创建"}${kind === "team" ? "团队" : "小组"}`,
    field(
      "名称",
      "name",
      current?.name,
      "text",
      `required minlength="${kind === "team" ? 2 : 1}" maxlength="64"`,
    ) +
      field(
        "描述",
        "description",
        current?.description,
        "text",
        'maxlength="500"',
      ) +
      (current
        ? selectField(
            "状态",
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
      toast("已保存");
    },
  );
}
async function groupMembers(id) {
  const users = (await api.groupMembers(state.team.id, id)).data;
  openDialog(
    "小组成员",
    table(
      ["成员", "操作"],
      users
        .map(
          (u) =>
            `<tr><td>${esc(u.username)}</td><td>${admin() && writable() ? tool("group-member-remove", "移除小组成员", "user-minus", `data-id="${u.id}" data-group="${id}"`) : ""}</td></tr>`,
        )
        .join(""),
    ),
    null,
    admin() && writable()
      ? button(
          "group-member-add",
          "添加成员",
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
      "添加小组成员",
      selectField(
        "成员",
        "userId",
        options(
          members.map((x) => x.user),
          "",
          "选择成员",
        ),
      ),
      async (data) => {
        await api.addGroupMember(state.team.id, groupId, data.userId);
        closeDialog(true);
        await refreshData();
        toast("成员已添加");
      },
    );
  } else {
    const existingUsers = new Set(
      (await api.members(state.team.id)).data.map((x) => String(x.user.id)),
    );
    openDialog(
      "添加团队成员",
      `<div class="member-picker" id="memberPicker">
        <div class="field"><label for="memberSearch">人员</label>
          <div class="member-input">
            <span class="member-affix" aria-hidden="true">${icon("search")}</span>
            <input id="memberSearch" name="keyword" type="text" autocomplete="off" placeholder="输入用户名或邮箱搜索" role="combobox" aria-expanded="false" aria-controls="memberResults" aria-autocomplete="list">
            <button type="button" class="member-clear" data-action="member-clear" aria-label="清除已选人员" title="清除已选人员" hidden>${icon("x")}</button>
            <div class="member-results" id="memberResults" role="listbox" aria-label="人员搜索结果"></div>
          </div>
        </div>
        <input type="hidden" name="userId">
        <p class="member-state" id="memberState" role="status">正在加载人员...</p>
      </div>`,
      async (data) => {
        if (!data.userId) throw new Error("请先搜索并选择人员");
        await api.addMember(state.team.id, data.userId);
        closeDialog(true);
        await refreshData();
        toast("成员已添加");
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
    status.textContent = "输入用户名或邮箱搜索";
    if (focusInput) input.focus();
  };
  const renderResults = (users, token) => {
    if (token !== requestToken || !picker.isConnected) return;
    if (!users.length) {
      closeResults();
      status.textContent = "没有匹配的人员";
      return;
    }
    status.textContent = `共 ${users.length} 位匹配人员`;
    results.innerHTML = users
      .map((user) => {
        const selected = String(user.id) === hidden.value;
        const existing = existingUsers.has(String(user.id));
        return `<button type="button" role="option" class="member-option" id="member-option-${esc(user.id)}" aria-selected="${selected}" data-action="member-option" data-id="${esc(user.id)}" data-name="${esc(user.username)}" data-email="${esc(user.email)}" ${existing ? "disabled" : ""}>
          <span><strong>${esc(user.username)}</strong><small>${esc(user.email)}</small></span>
          <em>${existing ? "已在团队" : user.systemRole === "super_admin" ? "超级管理员" : "普通成员"}</em>
        </button>`;
      })
      .join("");
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const searchUsers = async (keyword) => {
    const token = ++requestToken;
    status.textContent = "正在搜索...";
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
      });
    return;
  }
  busy(form.querySelector('[type="submit"]'), async () => {
    if (form.id === "authForm") {
      if (
        form.dataset.mode === "register" &&
        data.password !== data.passwordConfirmation
      )
        throw new Error("两次密码不一致");
      await api[form.dataset.mode](data);
      form.reset();
      await initialize();
    }
    if (form.id === "profileForm") {
      state.user = { ...(await api.profile(data)).data, id: state.user.id };
      shell();
      await navigate("settings");
      toast("个人资料已保存");
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
    if (form.id === "userSearch") {
      state.filters.userKeyword = data.keyword;
      state.filters.userRole = data.systemRole;
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
        localStorage.setItem("welo-team", node.value);
      } catch {}
      shell();
      await loadTeam();
    }
    if (node.id === "projectSelect") {
      state.project = state.projects.find((p) => p.id === node.value);
      state.taskPage = 1;
      await navigate(state.page);
    }
    if (node.id === "mobileNav") await navigate(node.value);
    if (node.id === "granularity") {
      state.filters.granularity = node.value;
      await navigate("workspace");
    }
    if (node.name === "startDate" && node.closest("#dialog") && node.value) {
      const endDate = $('#dialog [name="endDate"]');
      if (endDate) endDate.value = addDays(node.value, 3);
    }
    if (node.name === "groupId" && node.closest("#dialog"))
      await loadAssignees(
        node.value,
        "",
        node.closest("#dialogForm")?.dataset.autoAssignee === "true",
      );
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
  busy(node, async () => {
    if (action === "session-retry") restoreSession();
    if (action === "theme") theme();
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
      await navigate("workspace");
    }
    if (action === "task-create" || action === "task-edit")
      await taskEditor(id);
    if (action === "project-delete") {
      closeDialog();
      confirmDialog(
        "删除项目",
        () => api.deleteProject(state.team.id, id, node.dataset.name),
        node.dataset.name,
      );
    }
    if (action === "task-delete") {
      closeDialog();
      confirmDialog("删除任务", () =>
        api.deleteTask(state.team.id, state.project.id, id),
      );
    }
    if (action === "toggle-view") {
      $("#ganttPanel").hidden = !$("#ganttPanel").hidden;
      $("#scheduleTable").hidden = !$("#scheduleTable").hidden;
    }
    if (action === "gantt-today") {
      const viewport = $("#ganttPanel");
      const timeline = state.ganttTimeline;
      if (viewport && timeline)
        viewport.scrollLeft = Math.max(
          0,
          (dayNumber(today()) - dayNumber(timeline.startDate)) *
            GANTT_DAY_WIDTH -
            viewport.clientWidth / 2,
        );
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
    if (/^(project|task|admin)-(prev|next)$/.test(action)) {
      const [key, direction] = action.split("-");
      state[`${key}Page`] += direction === "next" ? 1 : -1;
      await navigate(state.page);
    }
    if (action === "team-create" || action === "team-edit")
      await organizationEditor(
        "team",
        action === "team-edit" ? state.team.id : null,
      );
    if (action === "group-create" || action === "group-edit")
      await organizationEditor("group", id);
    if (action === "group-members") await groupMembers(id);
    if (action === "member-add") await memberAdder();
    if (action === "group-member-add") {
      closeDialog();
      await memberAdder(node.dataset.group);
    }
    if (action === "member-remove")
      confirmDialog("移除团队成员", () => api.removeMember(state.team.id, id));
    if (action === "group-member-remove") {
      closeDialog();
      confirmDialog("移除小组成员", () =>
        api.removeGroupMember(state.team.id, node.dataset.group, id),
      );
    }
    if (action === "role-edit")
      openDialog(
        "修改系统角色",
        selectField(
          "系统角色",
          "systemRole",
          enumOptions(
            { member: "普通成员", super_admin: "超级管理员" },
            node.dataset.role,
          ),
        ),
        async (data) => {
          await api.updateRole(id, data.systemRole);
          closeDialog(true);
          await navigate("admin");
          toast("角色已更新");
        },
      );
    if (action === "mobile-team")
      openDialog(
        "切换团队",
        selectField("团队", "team", options(state.teams, state.team?.id)),
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
    const edgeWidth = GANTT_EDGE_DAYS * GANTT_DAY_WIDTH;
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
  if (!bar || !taskWritable() || bar.dataset.saving || event.button !== 0)
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
  const total = timeline.days;
  const timelineStart = dayNumber(timeline.startDate);
  const timelineEnd = timelineStart + total - 1;
  let delta = Math.round(
    ((event.clientX - drag.x) / drag.bar.parentElement.clientWidth) * total,
  );
  const duration =
    dayNumber(drag.task.endDate) - dayNumber(drag.task.renderStartDate);
  const taskStart = dayNumber(drag.task.renderStartDate);
  const taskEnd = dayNumber(drag.task.endDate);
  if (drag.mode === "left")
    delta = Math.min(Math.max(delta, timelineStart - taskStart), duration);
  else if (drag.mode === "right")
    delta = Math.max(Math.min(delta, timelineEnd - taskEnd), -duration);
  else
    delta = Math.min(
      Math.max(delta, timelineStart - taskStart),
      timelineEnd - taskEnd,
    );
  drag.delta = delta;
  const start = addDays(
      drag.task.renderStartDate,
      drag.mode === "right" ? 0 : delta,
    ),
    end = addDays(drag.task.endDate, drag.mode === "left" ? 0 : delta);
  drag.bar.style.left = `${(dayNumber(start) - timelineStart) * GANTT_DAY_WIDTH}px`;
  drag.bar.style.width = `${(dayNumber(end) - dayNumber(start) + 1) * GANTT_DAY_WIDTH}px`;
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
              : addDays(
                  current.task.startDate,
                  current.mode === "right" ? 0 : current.delta,
                ),
          endDate: addDays(
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
          result.data.startDate || "未设置开始日期"
        } ~ ${result.data.endDate}`;
        const scheduleTable = $("#scheduleTable");
        if (scheduleTable)
          scheduleTable.innerHTML = table(
            ["任务", "小组", "负责人", "开始", "截止", "状态"],
            taskRows(state.tasks, true),
          );
        toast("排期已保存");
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
