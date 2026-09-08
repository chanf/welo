# Welo 部署到 Cloudflare 控制台

本文适用于当前仓库的 Welo 项目。项目由两部分组成：

- 后端：Cloudflare Workers，Worker 名称建议使用 `welo-api`。
- 数据库：Cloudflare D1，数据库名称建议使用 `welo`。
- 前端：`frontend-prototype` 目录下的 Vite 静态站点，部署到 Cloudflare Pages。

推荐部署结构：

```text
浏览器
  |
  +-- Cloudflare Pages：前端页面
  |
  +-- Cloudflare Worker：API
          |
          +-- D1：welo
          +-- Cron Trigger：每 30 分钟清理过期登录会话
```

Cloudflare 资源创建和配置需要在 Cloudflare 控制台完成；代码构建由 Pages 或 Workers Builds 执行。

## 一、部署前准备

### 1. 准备 Cloudflare 账户

登录 Cloudflare 控制台，确认当前账户已开通 Workers & Pages。D1 是 Cloudflare 的托管 SQLite 数据库，可供 Workers 和 Pages 项目使用。

### 2. 准备代码仓库

将本项目提交到 GitHub 或 GitLab，并确认仓库根目录包含以下文件：

```text
wrangler.jsonc
package.json
src/index.ts
migrations/0001_initial.sql
frontend-prototype/package.json
frontend-prototype/index.html
frontend-prototype/api.js
```

当前仓库尚未固定远程 Git 地址。正式部署前，需要先把代码推送到一个 Cloudflare 控制台可以访问的 Git 仓库。

### 3. 本地检查

在仓库根目录执行：

```bash
npm ci
npm run build

cd frontend-prototype
npm ci
npm run build
```

检查结果应为：

- 后端 TypeScript 检查通过；
- 前端生成 `frontend-prototype/dist`；
- 没有把 `.dev.vars`、`.env`、API Token 或其他密钥提交到 Git。

## 二、创建 D1 数据库

### 1. 在控制台创建数据库

1. 打开 Cloudflare 控制台。
2. 进入 **Workers & Pages**。
3. 进入 **D1**，点击 **Create database**。
4. 数据库名称填写：

   ```text
   welo
   ```

5. 选择与主要用户接近的数据库区域；如果控制台提供自动选择，可使用默认选项。
6. 创建完成后，打开数据库详情页。
7. 复制数据库的 **Database ID**，后面配置 Worker 时使用。

### 2. 修改 Worker 的 D1 配置

打开仓库根目录的 `wrangler.jsonc`，把：

```jsonc
"database_id": "local-development"
```

替换为控制台中复制的真实 Database ID，例如：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "welo",
    "database_id": "这里填写真实的D1_DATABASE_ID",
    "migrations_dir": "migrations"
  }
]
```

`binding` 必须保持为 `DB`，因为代码通过 `env.DB` 访问数据库。不要改成 `D1`、`DATABASE` 或其他名称，除非同步修改 `src/env.d.ts` 和全部 Worker 代码。

### 3. 初始化生产数据库

D1 创建完成后，必须执行 `migrations/0001_initial.sql`。推荐使用本地 Wrangler 执行一次远程迁移：

```bash
npm ci
npx wrangler d1 migrations apply welo --remote
```

执行过程中确认目标数据库是生产环境的 `welo`。完成后，在 D1 控制台的 **Console** 中执行：

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;
```

至少应看到：

```text
group_members
projects
sessions
team_groups
team_members
teams
tasks
users
```

不要把本地数据库迁移到生产数据库，也不要在生产数据库重复执行已经成功的同一个 migration。

## 三、部署后端 Worker

推荐使用 Cloudflare 控制台连接 Git 仓库，由 Workers Builds 自动构建和部署。

### 1. 创建 Worker 项目

1. 进入 **Workers & Pages**。
2. 点击 **Create application**。
3. 选择 **Workers**。
4. 选择连接 Git 仓库的方式，例如 **Import a repository** 或 **Connect to Git**。
5. 选择 Welo 仓库。
6. Worker 名称填写：

   ```text
   welo-api
   ```

7. 如果控制台要求选择根目录，填写仓库根目录：

   ```text
   /
   ```

### 2. 填写 Workers Builds 配置

在构建配置中填写：

| 配置项 | 值 |
| --- | --- |
| Root directory | `/` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npm run deploy:production` |
| Production branch | 使用实际生产分支，例如 `main` |

项目的 `package.json` 已包含 Wrangler 和 TypeScript 依赖，`npm run build` 会执行 TypeScript 类型检查。`npm run deploy:production` 会使用 `wrangler.jsonc` 的默认生产配置部署 Worker，并携带生产变量与 D1 绑定。

### 3. 绑定 D1

如果控制台能识别 `wrangler.jsonc`，应自动显示 `DB` 绑定。部署前检查：

1. Worker 项目进入 **Settings**。
2. 找到 **Bindings** 或 **D1 database bindings**。
3. 确认变量名为：

   ```text
   DB
   ```

4. 确认目标数据库为：

   ```text
   welo
   ```

如果控制台提示配置文件中的绑定与控制台绑定冲突，以代码中 `binding: "DB"` 和生产 D1 数据库为准，修正后重新部署。

### 4. 设置 Worker 环境变量

进入 **Settings > Variables and Secrets**，在 Production 环境增加以下普通变量：

| 变量名 | 生产值 | 说明 |
| --- | --- | --- |
| `ENVIRONMENT` | `production` | `/health` 返回的运行环境 |
| `SESSION_TTL_DAYS` | `14` | 登录会话有效天数 |
| `CORS_ORIGINS` | 前端正式域名 | 允许携带 Cookie 的前端来源 |

例如 Pages 正式地址为 `https://welo.pages.dev`，则：

```text
CORS_ORIGINS=https://welo.pages.dev
```

如果绑定了自定义域名，应将实际用户访问的域名加入白名单，例如：

```text
CORS_ORIGINS=https://welo.example.com,https://app.welo.example.com
```

多个来源使用英文逗号分隔，不要在值中添加多余空格。不要填写 `*`，因为本项目使用 Cookie 凭证。

当前代码不要求 `SESSION_SECRET` 或 `PASSWORD_PEPPER`，不要为了“看起来安全”而添加代码不会读取的变量。敏感值应使用 **Secret** 类型，不要使用普通文本变量。

### 5. 部署 Worker

保存构建配置并点击部署，或向生产分支推送一次提交触发 Workers Builds。

部署完成后，在 Worker 的 **Overview** 中复制访问地址，通常类似：

```text
https://welo-api.<账户子域>.workers.dev
```

记为 `<WORKER_URL>`，后续验收使用。

## 四、配置 Cron Trigger

仓库的 `wrangler.jsonc` 已配置：

```jsonc
"triggers": {
  "crons": ["*/30 * * * *"]
}
```

该定时任务每 30 分钟调用 Worker 的 `scheduled` 处理函数，删除 `sessions` 表中已经过期的登录会话。

部署后检查：

1. 打开 Worker。
2. 进入 **Settings > Triggers**。
3. 确认存在每 30 分钟执行一次的 Cron Trigger。
4. 进入 **Logs** 或 **Observability**，确认没有持续出现 `session_cleanup` 错误。

注意：当前代码实现了过期 `sessions` 清理；设计文档中提到的“超过 30 天的软删除项目和任务清理”目前尚未在 `src/index.ts` 中实现，不应在验收文档中当作已完成能力。

## 五、部署前端到 Cloudflare Pages

前端是独立的 Vite 项目，必须将 Pages 的根目录设置为 `frontend-prototype`，不能把仓库根目录作为前端项目直接构建。

### 1. 创建 Pages 项目

1. 进入 **Workers & Pages**。
2. 点击 **Create application**。
3. 选择 **Pages**。
4. 选择 **Connect to Git**。
5. 选择与 Worker 相同的 Git 仓库。

### 2. 填写 Pages 构建配置

填写以下值：

| 配置项 | 值 |
| --- | --- |
| Root directory | `frontend-prototype` |
| Framework preset | `Vite`，如果没有可选则选择 None |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Production branch | 与生产代码分支一致 |

### 3. 配置前端 API 地址

`frontend-prototype/api.js` 使用以下逻辑确定 API 地址：

```js
const API_BASE = (window.WELO_API_BASE || '/api/v1').replace(/\/$/, '');
```

因此，正式部署有两种方式。

#### 方式 A：前端与 Worker 使用同一域名

只有在 Cloudflare 另外配置了同域名路由，将 `/api/*` 转发到 `welo-api` Worker 时，才能使用默认值：

```text
/api/v1
```

这种方式需要额外配置 Worker Route 或其他同域名转发规则。仅仅把前端和后端都部署到 Cloudflare，并不会自动产生同域名 API 路由。

#### 方式 B：前端直接访问 Worker 域名

这是当前项目最直接的部署方式。发布前，在 `frontend-prototype/index.html` 中，在加载 `api.js` 之前增加：

```html
<script>
  window.WELO_API_BASE = 'https://welo-api.<账户子域>.workers.dev/api/v1';
</script>
<script type="module" src="./api.js"></script>
```

将 `<账户子域>` 替换为实际 Worker 地址，并确保只保留一个 `api.js` 加载标签。

如果使用自定义 API 域名，例如 `https://api.welo.example.com`，则填写：

```html
<script>
  window.WELO_API_BASE = 'https://api.welo.example.com/api/v1';
</script>
```

修改后重新提交代码，再让 Pages 重新构建。

### 4. 关闭前端 Mock 回退

当前 `frontend-prototype/api.js` 默认开启 mock 回退：当 API 请求失败时，会显示演示数据。这适合设计预览，但会掩盖正式环境的后端、CORS 或数据库错误。

在正式验收前，打开浏览器开发者工具 Console，执行：

```js
localStorage.setItem('welo-api-mock', 'false');
location.reload();
```

刷新后，登录、团队、项目和任务请求必须真实访问 Worker。验收完成后不要再把浏览器切回 mock 模式。

如果需要在代码层面永久关闭 mock，应将 `api.js` 中：

```js
const isMockEnabled = () => localStorage.getItem(MOCK_MODE_KEY) !== 'false';
```

改为：

```js
const isMockEnabled = () => false;
```

## 六、部署后验收

### 1. 检查 Worker 健康状态

在浏览器打开：

```text
<WORKER_URL>/health
```

应返回类似 JSON：

```json
{
  "data": {
    "status": "ok",
    "environment": "production"
  }
}
```

如果返回的 `environment` 仍是 `development`，检查 Worker Production 环境变量并重新部署。

### 2. 检查未登录接口

```bash
curl -i "<WORKER_URL>/api/v1/teams"
```

预期返回 HTTP `401`，说明认证中间件已生效。

### 3. 检查注册和登录

在前端注册一个测试账号，确认：

1. 注册成功后返回登录 Cookie；
2. 页面刷新后会话仍然有效；
3. 登录错误不会返回密码哈希或会话 Token；
4. 连续 5 次错误密码后账号暂时锁定；
5. 退出登录后再次访问受保护接口返回 `401`。

### 4. 创建第一个超级管理员

当前注册接口新建用户时默认角色是 `member`，没有单独的初始化管理员接口。因此第一次部署后，建议：

1. 先通过前端注册第一个账号；
2. 在 D1 控制台执行：

   ```sql
   UPDATE users
   SET system_role = 'super_admin',
       updated_at = CURRENT_TIMESTAMP
   WHERE email = '你的管理员邮箱';
   ```

3. 退出前端并重新登录，使新的角色从数据库重新读取；
4. 使用 `/api/v1/admin/overview` 或前端平台控制中心验证管理员权限。

执行 SQL 前确认邮箱完全正确。生产环境不要直接把密码写入 SQL。

### 5. 检查 CORS

如果前端打开后登录请求失败，在浏览器 Network 面板检查：

- 请求 URL 是否为正确的 Worker 地址；
- `Origin` 是否在 `CORS_ORIGINS` 中；
- 响应是否包含正确的 `Access-Control-Allow-Origin`；
- 响应是否包含 `Access-Control-Allow-Credentials: true`；
- Fetch 请求是否带有 `credentials: include`。

修改 Worker 变量后必须点击部署或触发一次新的生产部署。

## 七、正式域名配置

### 前端域名

在 Pages 项目的 **Custom domains** 中添加正式域名，例如：

```text
app.welo.example.com
```

DNS 和 HTTPS 按控制台提示完成。

### API 域名

在 Worker 的 **Settings > Domains & Routes** 中添加 API 自定义域名，例如：

```text
api.welo.example.com
```

完成后，将前端的 `WELO_API_BASE` 改为：

```text
https://api.welo.example.com/api/v1
```

同时把 Worker 的 `CORS_ORIGINS` 改为前端真实域名：

```text
https://app.welo.example.com
```

前端域名和 API 域名不要混淆：`CORS_ORIGINS` 填前端来源，`WELO_API_BASE` 填 API 地址。

## 八、后续版本发布

### Worker

1. 修改代码或 `wrangler.jsonc`；
2. 提交并推送到生产分支；
3. 在 Workers Builds 查看构建日志；
4. 在 Worker 的 **Deployments** 查看新版本；
5. 检查 `/health` 和关键登录流程。

### D1

新增表或字段时：

1. 新建递增 migration，例如 `migrations/0002_add_xxx.sql`；
2. 本地验证 migration；
3. 提交 migration；
4. 在确认目标数据库后执行：

   ```bash
   npx wrangler d1 migrations apply welo --remote
   ```

5. 再部署依赖新字段的 Worker 代码。

不要修改已经在生产执行过的 migration 文件名和内容。

### Pages

前端提交到生产分支后，Pages 会按配置重新执行：

```bash
npm ci && npm run build
```

并发布 `frontend-prototype/dist`。

## 九、常见问题

### 1. 部署时报 D1 database not found

原因通常是 `wrangler.jsonc` 仍使用：

```text
local-development
```

处理方法：

1. 从 D1 详情页复制真实 Database ID；
2. 替换 `database_id`；
3. 确认数据库名称仍为 `welo`；
4. 重新触发 Worker 部署。

### 2. 页面一直显示演示数据

检查浏览器 Console：

```js
localStorage.getItem('welo-api-mock')
```

如果结果不是字符串 `false`，执行：

```js
localStorage.setItem('welo-api-mock', 'false');
location.reload();
```

然后检查 Network 面板中的 API 请求。

### 3. 页面请求 `/api/v1/...` 但 Worker 没有收到请求

前端和 Worker 是两个独立域名时，默认相对路径不会自动指向 Worker。配置 `window.WELO_API_BASE`，或配置同域名的 Worker Route。

### 4. 浏览器报 CORS 错误

检查 `CORS_ORIGINS` 是否填写了前端完整来源，包括：

- `https://`；
- 正确的域名；
- 正确的端口（本地调试时）；
- 不要在末尾添加路径或 `/`。

### 5. 注册成功但后续请求未登录

检查：

- 前端请求是否使用 `credentials: include`；
- Worker 是否通过 HTTPS 访问；
- 浏览器是否拦截了 Secure Cookie；
- 前端来源是否与 Worker 的 CORS 白名单一致。

### 6. Pages 构建成功但页面空白

确认 Pages 配置为：

```text
Root directory: frontend-prototype
Build output directory: dist
```

不要填写仓库根目录下不存在的 `build` 或 `public`。

### 7. D1 控制台中没有表

只创建 D1 数据库不会自动执行项目 migration。重新执行：

```bash
npx wrangler d1 migrations apply welo --remote
```

并在命令输出中确认目标数据库和 migration 执行结果。

## 十、上线检查清单

- [ ] Worker 名称为 `welo-api`。
- [ ] D1 数据库名称为 `welo`。
- [ ] `database_id` 已替换为真实生产 Database ID。
- [ ] Worker 的 D1 binding 名为 `DB`。
- [ ] `migrations/0001_initial.sql` 已应用到远程 D1。
- [ ] `ENVIRONMENT=production`。
- [ ] `SESSION_TTL_DAYS=14`。
- [ ] `CORS_ORIGINS` 只包含正式前端来源。
- [ ] Worker Cron Trigger 已显示为每 30 分钟执行。
- [ ] Pages 根目录为 `frontend-prototype`。
- [ ] Pages 构建目录为 `dist`。
- [ ] 前端 `WELO_API_BASE` 指向真实 Worker API。
- [ ] 浏览器已关闭 `welo-api-mock` mock 回退。
- [ ] `/health` 返回 `status: ok` 和 `environment: production`。
- [ ] 第一个管理员账号已提升为 `super_admin`。
- [ ] 注册、登录、退出、创建团队、创建项目、创建任务和甘特图排期均已实测。
