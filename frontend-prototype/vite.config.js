import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.API_PROXY_TARGET || "http://localhost:8787";
  return {
    server: {
      host: "localhost",
      port: 5173,
      proxy: {
        "^/api/": { target, changeOrigin: true },
        "/health": { target, changeOrigin: true },
      },
    },
  };
});
