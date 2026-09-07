# Welo Frontend

Welo 的正式前端基于原高保真原型演进，保留视觉系统，页面状态和数据全部来自后端 API。

## 本地开发

1. 在仓库根目录启动后端：

   ```bash
   npx wrangler dev --local --port 8787
   ```

2. 在 `frontend-prototype` 启动前端：

   ```bash
   npm install
   npm run dev
   ```

默认访问 `http://localhost:5173`。Vite 会把 `/api/v1` 和 `/health` 代理到 `API_PROXY_TARGET`，默认为 `http://localhost:8787`。如需直连其他后端，复制 `.env.example` 为 `.env.local` 后调整。

## 验证

```bash
npm test
```

该命令检查代码格式并执行生产构建。接口联调需要先启动本地 Worker 与 D1 迁移。
