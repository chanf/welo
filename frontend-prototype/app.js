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
const today = () => new Date().toLocaleDateString("en-CA");
const dayNumber = (value) => Date.parse(`${value}T00:00:00Z`) / 86400000;
const addDays = (value, days) =>
  new Date((dayNumber(value) + days) * 86400000).toISOString().slice(0, 10);
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

function renderAuth(mode = "login", message = "") {
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
  state.teams = (await api.teams()).data.map((x) => ({
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
  drawGantt();
}
function drawGantt() {
  const target = $("#ganttPanel");
  if (!target) return;
  if (!state.gantt || !state.tasks.length) {
    target.innerHTML = empty("暂无任务");
    return;
  }
  const start = state.gantt.range.startDate,
    end = state.gantt.range.endDate;
  const total = Math.max(1, dayNumber(end) - dayNumber(start) + 1);
  const step =
    state.filters.granularity === "month"
      ? 30
      : state.filters.granularity === "week"
        ? 7
        : 1;
  const width = Math.max(580, Math.ceil(total / step) * 42);
  const ticks = Array.from(
    { length: Math.ceil(total / step) },
    (_, i) =>
      `<div class="day"><strong>${addDays(start, i * step).slice(5)}</strong></div>`,
  ).join("");
  target.innerHTML = `<div class="gantt-inner" style="width:${width + 220}px"><div class="timeline-head"><div class="timeline-spacer">任务 / 负责人</div><div class="days" style="grid-template-columns:repeat(${Math.ceil(total / step)},1fr)">${ticks}</div></div>${state.tasks
    .map((t) => {
      const left =
        ((dayNumber(t.renderStartDate) - dayNumber(start)) / total) * 100;
      const span =
        ((dayNumber(t.endDate) - dayNumber(t.renderStartDate) + 1) / total) *
        100;
      return `<div class="timeline-row"><div class="task-info"><button class="task-title text-link" data-action="task-edit" data-id="${esc(t.id)}">${esc(t.title)}</button><div class="task-meta">${esc(t.group.name)} · ${esc(t.assignee.username)}</div></div><div class="track"><div class="bar ${t.isVirtualStart ? "dashed" : t.status === "done" ? "teal" : t.status === "todo" ? "coral" : "blue"}" data-task-id="${esc(t.id)}" style="left:${left}%;width:${span}%" title="${esc(t.title)}: ${esc(t.startDate || "未设置开始日期")} ~ ${esc(t.endDate)}">${t.isVirtualStart ? "" : '<span class="handle left"></span>'}<span class="bar-label">${esc(t.title)}</span><span class="handle right"></span></div></div></div>`;
    })
    .join("")}</div>`;
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
      `<label class="field"><span>详细内容</span><textarea name="detail" maxlength="10000">${esc(task?.detail)}</textarea></label><div class="field-grid">${selectField("所属小组", "groupId", options(groups, task?.group.id, "选择小组"))}${selectField("负责人", "assigneeId", '<option value="">先选择小组</option>')}</div><div class="field-grid">${field("开始日期", "startDate", task?.startDate || "", "date")}${field("截止日期", "endDate", task?.endDate || today(), "date", "required")}</div><div class="field-grid">${selectField("状态", "status", enumOptions(statuses, task?.status || "todo"))}${selectField("优先级", "priority", enumOptions(priorities, task?.priority || "medium"))}</div>`,
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
  if (task) await loadAssignees(task.group.id, task.assignee.id);
}
let assigneeRequest = 0;
async function loadAssignees(groupId, value = "") {
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
    node.innerHTML = options(users, value, "选择负责人");
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
  } else
    openDialog(
      "添加团队成员",
      field("查找用户名或邮箱", "keyword", "", "text", "required") +
        '<div id="userResults"></div>' +
        button("find-user", "搜索人员", "search"),
      async (data) => {
        if (!data.userId) throw new Error("请先搜索并选择人员");
        await api.addMember(state.team.id, data.userId);
        closeDialog(true);
        await refreshData();
        toast("成员已添加");
      },
    );
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
    if (node.name === "groupId" && node.closest("#dialog"))
      await loadAssignees(node.value);
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
    if (action === "find-user") {
      const result = await api.adminUsers({
        keyword: $('#dialog [name="keyword"]').value,
        pageSize: 100,
      });
      $("#userResults").innerHTML = selectField(
        "人员",
        "userId",
        options(result.data, "", "选择人员"),
      );
    }
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
root.addEventListener(
  "cancel",
  (event) => {
    event.preventDefault();
    closeDialog();
  },
  true,
);
window.addEventListener("hashchange", () => {
  if (state.user) navigate(location.hash.slice(1));
});

let drag = null;
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
  const total =
    dayNumber(state.gantt.range.endDate) -
    dayNumber(state.gantt.range.startDate) +
    1;
  let delta = Math.round(
    ((event.clientX - drag.x) / drag.bar.parentElement.clientWidth) * total,
  );
  const duration =
    dayNumber(drag.task.endDate) - dayNumber(drag.task.renderStartDate);
  if (drag.mode === "left") delta = Math.min(delta, duration);
  if (drag.mode === "right") delta = Math.max(delta, -duration);
  drag.delta = delta;
  const start = addDays(
      drag.task.renderStartDate,
      drag.mode === "right" ? 0 : delta,
    ),
    end = addDays(drag.task.endDate, drag.mode === "left" ? 0 : delta);
  drag.bar.style.left = `${((dayNumber(start) - dayNumber(state.gantt.range.startDate)) / total) * 100}%`;
  drag.bar.style.width = `${((dayNumber(end) - dayNumber(start) + 1) / total) * 100}%`;
});
root.addEventListener("pointercancel", () => {
  drag = null;
  drawGantt();
});
root.addEventListener("pointerup", () => {
  if (!drag) return;
  const current = drag;
  drag = null;
  if (!current.delta) {
    drawGantt();
    return;
  }
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
        await navigate("workspace");
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

renderAuth("login", "正在恢复会话...");
initialize().catch((error) => {
  renderAuth("login", error.status === 401 ? "" : errorMessage(error));
});
