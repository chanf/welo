import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const varsPath = resolve(root, ".dev.vars");
const proxyUrl = process.env.TELEGRAM_PROXY_URL || "http://127.0.0.1:7890";
const message =
  process.argv.slice(2).join(" ").trim() ||
  `Welo local Telegram connectivity test (${new Date().toISOString()})`;

function loadVars(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return vars;
}

function safeTelegramSummary(payload) {
  if (payload?.ok === true) {
    return `ok=true message_id=${payload.result?.message_id ?? "unknown"}`;
  }
  return `ok=false error_code=${payload?.error_code ?? "unknown"} description=${payload?.description ?? "unknown"}`;
}

async function sendDirect(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function sendWithCurl(url, body, proxy) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "curl",
      [
        "--silent",
        "--show-error",
        "--connect-timeout",
        "10",
        "--max-time",
        "20",
        "--proxy",
        proxy,
        "--header",
        "Content-Type: application/json",
        "--data",
        JSON.stringify(body),
        url,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `curl exited with code ${code}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        reject(new Error("Telegram returned a non-JSON response"));
      }
    });
  });
}

const vars = loadVars(await readFile(varsPath, "utf8"));
const token = (vars.TELEGRAM_BOT_TOKEN || "").trim();
const chatId = (vars.TELEGRAM_FEEDBACK_CHAT_ID || "").trim();

if (!token || !chatId) {
  console.error(
    "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_FEEDBACK_CHAT_ID in .dev.vars",
  );
  process.exitCode = 1;
} else {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true,
  };

  try {
    const { response, payload } = await sendDirect(url, body);
    console.log(`direct: HTTP ${response.status} ${safeTelegramSummary(payload)}`);
    if (!response.ok || payload?.ok !== true) process.exitCode = 1;
  } catch (error) {
    console.log(`direct: failed (${error.message})`);
    try {
      const payload = await sendWithCurl(url, body, proxyUrl);
      console.log(`proxy ${proxyUrl}: ${safeTelegramSummary(payload)}`);
      if (payload?.ok !== true) process.exitCode = 1;
    } catch (proxyError) {
      console.error(`proxy ${proxyUrl}: failed (${proxyError.message})`);
      process.exitCode = 1;
    }
  }
}
