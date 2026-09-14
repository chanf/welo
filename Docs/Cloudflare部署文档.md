# Welo Cloudflare 部署文档

本文描述当前仓库 V2 团队协作版本的 Cloudflare 部署、升级和验收流程。此前基于 V1 小组模型、mock 前端和单一初始迁移的部署说明已不再适用。

## 1. 当前部署形态

Welo 由三个主要部分组成：

```text
浏览器
  |
  | HTTPS, Cookie credentials
  v
Cloudflare Pages
  |  前端：https://welo.909939.xyz
  |
  | VITE_API_BASE_URL
  v
Cloudflare Worker
  |  API：https://welo-api.909939.xyz
  |
  +-- Cloudflare D1
  |     database_name: welo
  |     binding: DB
  |
  +-- Cron Trigger
        每 30 分钟清理过期 sessions 和过期待处理邀请
```

当前仓库已经包含生产配置：

- Worker 名称：`welo-api`
- D1 数据库：`welo`
- D1 binding：`DB`
- 前端正式域名：`https://welo.909939.xyz`
- API 正式域名：`https://welo-api.909939.xyz`
- API 健康检查：`https://welo-api.909939.xyz/health`
- Git 远程仓库：`https://github.com/chanf/welo.git`

生产配置集中在 [wrangler.jsonc](../wrangler.jsonc) 和 [frontend-prototype/.env.production](../frontend-prototype/.env.production)。部署前不要把旧文档中的 `window.WELO_API_BASE` 或 mock 开关配置加回前端。

## 2. 部署前检查

在仓库根目录执行：

```bash
npm ci
npm run build
npm run frontend:test
```

含义如下：

| 命令 | 覆盖内容 |
| --- | --- |
| `npm run build` | Worker TypeScript 类型检查 |
| `npm run frontend:test` | 前端 Prettier 检查和 Vite 生产构建 |

前端单独构建时使用：

```bash
cd frontend-prototype
npm ci
npm run build
```

构建产物为 `frontend-prototype/dist`。当前前端没有 mock 回退；API 失败会在页面上提示真实请求错误，不会展示演示数据。

确认以下文件存在且纳入 Git：

```text
wrangler.jsonc
src/index.ts
src/shared/
migrations/0001_initial.sql
migrations/0002_add_user_colors.sql
migrations/0003_task_half_hour_times.sql
migrations/0004_team_collaboration_v2.sql
migrations/0005_public_feedback.sql
database/init.sql
frontend-prototype/.env.production
frontend-prototype/api.js
frontend-prototype/app.js
frontend-prototype/index.html
```

不要提交 `.dev.vars`、`.env.local`、Cloudflare API Token、`dist/` 或 `.wrangler/` 状态目录。

## 3. D1 数据库

### 3.1 迁移文件

当前递增迁移为：

```text
0001_initial.sql
0002_add_user_colors.sql
0003_task_half_hour_times.sql
0004_team_collaboration_v2.sql
```

`0004` 是团队协作 V2 的关键迁移，会：

- 重建团队、项目和任务表；
- 增加团队成员状态、邀请、审计、幂等键和回收站字段；
- 将团队作为唯一业务隔离边界；
- 保留旧任务表快照 `tasks_v1_group_archive`;
- 保留旧 `team_groups`、`group_members` 作为历史数据，但新版 API 不再使用它们。

不要修改已经在任何环境执行过的迁移文件名和内容。

### 3.2 检查远程迁移状态

本地需要已登录 Wrangler，或设置具有 D1 读写权限的 `CLOUDFLARE_API_TOKEN`。执行：

```bash
npx wrangler d1 migrations list welo --remote
```

输出会区分已应用和未应用迁移。生产发布前必须确认 `0004_team_collaboration_v2.sql` 已经应用；如果无法确认，先停止发布并排查，不要重复猜测执行。

### 3.3 现有生产库升级

已有 V1 或 V2 开发库升级时，使用递增迁移：

```bash
npm run db:migrate:remote
```

该命令等价于：

```bash
wrangler d1 migrations apply welo --remote
```

升级前必须完成：

1. 确认 `wrangler.jsonc` 的 D1 `database_id` 指向目标库；
2. 执行远程迁移列表检查，确认待执行迁移；
3. 导出或备份现有数据库；
4. 在隔离环境演练，特别是首次应用 `0004`;
5. 核对旧团队创建者、旧项目归属、任务负责人和跨团队异常数据；
6. 应用迁移并验证表结构和关键数据行数；
7. 再部署依赖新表结构的 Worker。

推荐备份命令：

```bash
mkdir -p backup
npx wrangler d1 export welo --remote --output ./backup/welo-before-v2.sql
```

备份文件包含业务数据，必须存放在安全位置，不得提交到仓库。

`0004` 迁移内的注释要求在远程应用前审核旧团队创建者映射。旧系统若存在平台超管代建团队，不能机械地把最早成员或最小 ID 成员设为管理员；必须先形成逐团队管理员映射，再执行受控迁移。

### 3.4 全新空库初始化

全新空库仍推荐使用递增迁移，保证 Cloudflare 迁移记录完整：

```bash
npm run db:migrate:remote
```

[database/init.sql](../database/init.sql) 是合并后的 V2 完整建库脚本，用于本地验证、重建可丢弃环境或人工审查最终结构。它开头会执行 `DROP TABLE IF EXISTS`，会删除既有 Welo 业务表：

```sql
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS ...
```

因此：

- 可以用于确定没有业务数据的空库或本地测试库；
- 禁止在已有生产数据上执行；
- 不建议替代 Wrangler 递增迁移作为生产升级方式。

不要把 `database/init.sql` 直接执行到远程生产库或后续还要使用 Wrangler 迁移的环境。该脚本只创建最终业务结构，不创建 Cloudflare D1 的迁移历史；执行后再运行递增迁移时，Wrangler 可能仍尝试从 `0001` 开始应用并因表已存在而失败。远程正式环境一律使用 `migrations/` 初始化和升级。

### 3.5 表结构验收

在 D1 控制台执行：

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;
```

V2 后至少应看到：

```text
audit_logs
group_members
idempotency_keys
projects
sessions
tasks
tasks_v1_group_archive
team_groups
team_invitations
team_members
teams
users
```

其中 `group_members`、`team_groups`、`tasks_v1_group_archive` 是历史或迁移快照，不是新版业务依赖表。

迁移历史不要手写在 D1 控制台里判断，统一使用：

```bash
npx wrangler d1 migrations list welo --remote
```

该命令会显示已应用和待应用迁移，是发布前的权威检查方式。

## 4. Worker 部署

### 4.1 当前配置

生产配置位于 [wrangler.jsonc](../wrangler.jsonc)：

```jsonc
{
  "name": "welo-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-07",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "welo",
      "database_id": "9b5449af-659f-4e44-93f9-44370a4cddf3",
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "ENVIRONMENT": "production",
    "SESSION_TTL_DAYS": "14",
    "CORS_ORIGINS": "https://welo.909939.xyz"
  }
}
```

binding 必须保持为 `DB`，后端通过 `env.DB` 访问 D1。`nodejs_compat` 和 compatibility date 不要随意删除；升级 Wrangler 或依赖时应先在隔离环境验证。

当前配置还启用了 Workers Observability，采样率为 `1`。

### 4.2 环境变量

当前生产变量由 `wrangler.jsonc` 顶层配置提供：

| 变量 | 当前生产值 | 说明 |
| --- | --- | --- |
| `ENVIRONMENT` | `production` | `/health` 返回的环境标识 |
| `SESSION_TTL_DAYS` | `14` | 登录会话有效期 |
| `CORS_ORIGINS` | `https://welo.909939.xyz` | 允许携带 Cookie 的前端来源 |

规则：

- `CORS_ORIGINS` 填前端来源，不填 API 域名；
- 不要使用 `*`，因为请求使用 Cookie 凭证；
- 多来源使用英文逗号分隔；
- 来源末尾不要带路径或 `/`；
- 修改后必须重新部署 Worker。

当前代码不需要 `SESSION_SECRET` 或 `PASSWORD_PEPPER`。不要添加代码不读取的变量。若未来引入 Secret，应使用 Cloudflare Secret 类型，而不是普通文本变量或提交到仓库。

#### 用户留言 Telegram secrets

登录页用户留言功能需要两个 Worker secret：

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_FEEDBACK_CHAT_ID
```

`TELEGRAM_BOT_TOKEN` 来自 BotFather；`TELEGRAM_FEEDBACK_CHAT_ID` 是接收留言的个人聊天、群组或频道 chat id。两者不得写入 `wrangler.jsonc`、前端环境变量或 Git。缺少任意一个时，其他 API 不受影响，但 `POST /api/v1/public/feedback` 会返回 503。

### 4.3 自动构建配置

使用 Cloudflare Workers Builds 连接 Git 仓库时，配置：

| 配置项 | 值 |
| --- | --- |
| Repository | `chanf/welo` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npm run deploy:production` |

`npm run deploy:production` 会执行 `wrangler deploy`，使用顶层生产配置。仓库还定义了 `development` 环境用于本地；Wrangler 在同时存在环境配置时可能提示未显式指定环境，这是提示而非部署失败。不要在生产发布命令中追加 `--env development`。

### 4.4 手动部署

确认已登录 Wrangler 并核对顶层生产配置后执行：

```bash
npm ci
npm run build
npm run deploy:production
```

只查看打包和绑定而不发布时，可执行：

```bash
npx wrangler deploy --dry-run --outdir /tmp/welo-worker-preview
```

dry-run 输出应显示：

- `env.DB` 绑定到 D1 `welo`;
- `ENVIRONMENT=production`;
- `CORS_ORIGINS=https://welo.909939.xyz`。

### 4.5 Cron Trigger

[wrangler.jsonc](../wrangler.jsonc) 配置：

```jsonc
"triggers": {
  "crons": ["*/30 * * * *"]
}
```

Worker 的 `scheduled` 处理函数每 30 分钟执行一次，做两件事：

1. 删除已过期的登录会话；
2. 将已过期且仍处于 `pending` 状态的团队邀请更新为 `expired`。

对应代码在 `src/index.ts` 的 `scheduled` 导出中。部署后检查：

1. Worker Settings 中的 Triggers；
2. Cron 是否为每 30 分钟；
3. Logs / Observability 中是否出现 `scheduled_cleanup`;
4. 是否没有持续失败日志。

软删除项目和任务的 30 天恢复期限由业务查询和恢复接口判断，当前 Cron 不物理清理这些数据。

## 5. 前端 Pages 部署

### 5.1 构建配置

前端位于 `frontend-prototype`，Cloudflare Pages 配置：

| 配置项 | 值 |
| --- | --- |
| Root directory | `frontend-prototype` |
| Framework preset | `Vite`，无该选项时选 None |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Production branch | 与 Worker 一致，当前为 `main` |

### 5.2 API 地址配置

当前 API 地址来自 Vite 环境变量：

```text
VITE_API_BASE_URL=https://welo-api.909939.xyz
```

该值保存在 [frontend-prototype/.env.production](../frontend-prototype/.env.production)，Vite 生产构建会自动读取。

注意：

- `api.js` 会自动在每个 API 路径前追加 `/api/v1`;
- 因此 `VITE_API_BASE_URL` 填 API 根地址；
- 不要写成 `https://welo-api.909939.xyz/api/v1`;
- 不要再使用旧版 `window.WELO_API_BASE`;
- 当前没有 mock 回退，也没有 `welo-api-mock` localStorage 开关。

本地开发通常保持 `.env.local` 中 `VITE_API_BASE_URL` 为空，由 Vite 代理 `/api/*` 和 `/health` 到本地 Worker：

```text
VITE_API_BASE_URL=
API_PROXY_TARGET=http://localhost:8787
```

### 5.3 自定义域名

当前前端正式域名为：

```text
https://welo.909939.xyz
```

Cloudflare Pages 的 Custom domains 应绑定该域名，并确保 DNS 与 HTTPS 证书状态正常。

如果更换 API 域名：

1. 在 Worker Settings > Domains & Routes 绑定新 API 域名；
2. 修改 `frontend-prototype/.env.production` 的 `VITE_API_BASE_URL`;
3. 修改 Worker `CORS_ORIGINS` 为用户实际访问的前端来源；
4. 重新构建并发布 Pages；
5. 重新部署 Worker；
6. 验证浏览器登录、注册和 Cookie 请求。

## 6. 本地开发环境

在仓库根目录启动本地 Worker：

```bash
npm run dev
```

该命令使用 `wrangler.jsonc` 的 `development` 环境，变量为：

| 变量 | 本地值 |
| --- | --- |
| `ENVIRONMENT` | `development` |
| `SESSION_TTL_DAYS` | `14` |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:8787` |

本地 D1 迁移：

```bash
npm run db:migrate:local
```

另开终端启动前端：

```bash
npm run frontend:dev
```

前端访问：

```text
http://localhost:5173
```

本地 Worker 健康检查：

```text
http://localhost:8787/health
```

## 7. 部署后验收

### 7.1 Worker 健康检查

```bash
curl -i https://welo-api.909939.xyz/health
```

预期返回 HTTP 200，且：

```json
{
  "data": {
    "status": "ok",
    "environment": "production"
  }
}
```

### 7.2 认证边界

未登录访问：

```bash
curl -i https://welo-api.909939.xyz/api/v1/teams
```

预期 HTTP `401 UNAUTHENTICATED`。

### 7.3 前端生产验收

打开：

```text
https://welo.909939.xyz/
```

至少验证：

1. 登录、注册、退出和会话恢复；
2. 创建团队；
3. 管理员邀请另一个已注册用户；
4. 被邀请用户接受邀请；
5. 两个成员创建项目和任务；
6. 成员把任务分配给另一个有效成员；
7. 普通成员修改他人任务；
8. 非成员无法通过项目或任务 ID 访问其他团队；
9. 管理员移除成员后，该成员后续访问被拒绝；
10. `super_admin` 能看到平台概览、全部用户和全部项目目录，但不能借该角色访问未加入团队的任务详情。

当前前端仍有若干功能未完全暴露，详见 [团队协作与权限设计文档](./团队协作与权限设计文档.md) 的实现状态矩阵。部署验收应以实际可入口为准，不能把文档目标能力当作已上线能力。

### 7.4 CORS 和 Cookie

浏览器 Network 面板检查：

- 前端请求来源是 `https://welo.909939.xyz`;
- API 请求是 `https://welo-api.909939.xyz/api/v1/...`;
- Fetch 使用 `credentials: include`;
- 预检响应包含 `Access-Control-Allow-Credentials: true`;
- `Access-Control-Allow-Origin` 是精确前端来源；
- 登录响应能设置 `Secure`、`HttpOnly`、`SameSite=Lax` Cookie。

### 7.5 初始化超级管理员

注册接口创建的账号默认是 `member`。首次部署后如需平台只读管理员，先注册账号，再在 D1 控制台执行：

```sql
UPDATE users
SET system_role = 'super_admin',
    updated_at = CURRENT_TIMESTAMP
WHERE email = '你的管理员邮箱';
```

执行前确认邮箱完全匹配。更新后退出并重新登录，让会话重新读取 `system_role`。

当前产品 API 不开放系统角色修改。`super_admin` 只提供平台只读视图，不是团队业务超级权限。

## 8. 版本发布顺序

### 8.1 常规代码发布

不涉及数据库结构变更时：

1. 合并代码到 `main`;
2. 本地执行 `npm test`;
3. Workers Builds 自动构建并部署 Worker;
4. Pages 自动构建并发布前端；
5. 检查 `/health`、登录、团队、项目和任务主流程。

### 8.2 涉及 D1 迁移的发布

涉及表结构或数据迁移时：

1. 新增递增 migration，不修改旧 migration;
2. 本地和隔离 D1 演练；
3. 导出生产备份；
4. 暂停或安排业务低峰发布窗口；
5. 执行 `npx wrangler d1 migrations list welo --remote`;
6. 确认目标数据库和待执行 migration;
7. 执行 `npm run db:migrate:remote`;
8. 验证表结构、关键行数和约束；
9. 部署 Worker；
10. 发布前端；
11. 执行生产验收并记录结果。

如果 Worker 依赖新表，不要先部署 Worker 再迁移数据库。

### 8.3 回退

当前迁移没有提供自动 down 脚本。回退必须依赖发布前备份或 Cloudflare 数据恢复能力，并结合代码版本处理：

1. 先停止写入或进入维护状态；
2. 保留迁移后新增数据；
3. 按备份策略恢复或重放数据；
4. 回滚 Worker 和 Pages 到匹配的代码版本；
5. 重新执行核心读写验收。

不能只回滚代码而忽略数据库结构。

## 9. 常见问题

### 9.1 Worker 报 D1 database not found

检查：

1. Cloudflare 中数据库真实名称是否为 `welo`;
2. `wrangler.jsonc` 的 `database_id` 是否指向该库；
3. binding 是否为 `DB`;
4. 当前登录 Wrangler 账号是否有访问权限。

查看远程迁移时使用数据库名称 `welo`，不是 binding 名 `DB`。

### 9.2 API 请求 404 或没有到达 Worker

确认请求 URL：

```text
https://welo-api.909939.xyz/api/v1/...
```

`/health` 不带 `/api/v1`。前端 `VITE_API_BASE_URL` 只填 API 根域名，不填 `/api/v1`。

### 9.3 浏览器 CORS 错误

检查：

- `CORS_ORIGINS` 是否为 `https://welo.909939.xyz`;
- 是否误填 API 域名；
- 是否误用 `*`;
- 来源是否多了末尾 `/`;
- 修改变量后是否重新部署 Worker。

### 9.4 登录成功但后续请求未登录

检查：

- 浏览器是否通过 HTTPS 访问；
- 响应 Cookie 是否为 `Secure; HttpOnly; SameSite=Lax`;
- Fetch 是否带 `credentials: include`;
- 前端来源是否在 CORS 白名单中；
- D1 `sessions` 表数据是否正常；
- 系统时间导致会话是否被判定过期。

### 9.5 Pages 构建成功但页面空白

确认：

```text
Root directory: frontend-prototype
Build command: npm ci && npm run build
Build output directory: dist
```

不要把输出目录写成 `build`、`public` 或仓库根目录。

### 9.6 D1 控制台没有新版表

只创建 D1 不会自动执行迁移。执行：

```bash
npx wrangler d1 migrations list welo --remote
npm run db:migrate:remote
```

再次确认输出中包含 `0004_team_collaboration_v2.sql`。

### 9.7 想重置本地数据

本地可使用迁移重放或删除本地 `.wrangler` 状态。若使用 `database/init.sql`，只应对确认可丢弃的本地库执行，不要对远程生产库执行。

## 10. 上线检查清单

- [ ] Worker 名称为 `welo-api`。
- [ ] D1 数据库名称为 `welo`。
- [ ] Worker D1 binding 名为 `DB`。
- [ ] `wrangler.jsonc` 中的 `database_id` 指向目标生产库。
- [ ] 远程迁移状态已检查，`0001` 到 `0004` 状态明确。
- [ ] 团队协作 V2 依赖的迁移已应用并完成结构验收。
- [ ] `ENVIRONMENT=production`。
- [ ] `SESSION_TTL_DAYS=14`。
- [ ] `CORS_ORIGINS=https://welo.909939.xyz`。
- [ ] Worker Cron Trigger 为每 30 分钟执行。
- [ ] Pages 根目录为 `frontend-prototype`。
- [ ] Pages 构建目录为 `dist`。
- [ ] `frontend-prototype/.env.production` 中 `VITE_API_BASE_URL=https://welo-api.909939.xyz`。
- [ ] 前端构建产物没有 mock 回退。
- [ ] `https://welo-api.909939.xyz/health` 返回 `status: ok` 和 `environment: production`。
- [ ] 前端 `https://welo.909939.xyz/` 可注册、登录和创建团队。
- [ ] 团队邀请、任务分配和团队隔离主流程已实测。
- [ ] `super_admin` 只读视图按预期工作。
- [ ] Workers Observability 无持续错误。
- [ ] 数据库备份和发布记录已保存。
