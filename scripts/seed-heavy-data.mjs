#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";

const args = new Set(process.argv.slice(2));
const remote = args.has("--remote");
const target = remote ? "--remote" : "--local";
const userCount = 30;
const projectTaskCounts = [50, 80, 120, 160, 200];
const teamName = "前端压力测试团队";
const usernamePrefix = "loadtest_user_";
const password = "LoadTest123!";

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const pad = (value, width = 2) => String(value).padStart(width, "0");

async function passwordHash(value) {
  const encoder = new TextEncoder();
  const key = await webcrypto.subtle.importKey("raw", encoder.encode(value), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode("welo-loadtest-salt"), iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$100000$welo-loadtest-salt$${Buffer.from(bits).toString("hex")}`;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const rng = random(20260914);
const hash = await passwordHash(password);
const lines = [
  "PRAGMA foreign_keys = ON;",
  `DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE team_id IN (SELECT id FROM teams WHERE name = ${sqlString(teamName)}));`,
  `DELETE FROM projects WHERE team_id IN (SELECT id FROM teams WHERE name = ${sqlString(teamName)});`,
  `DELETE FROM teams WHERE name = ${sqlString(teamName)};`,
  `DELETE FROM users WHERE username LIKE ${sqlString(`${usernamePrefix}%`)};`,
];

for (let i = 1; i <= userCount; i += 1) {
  const username = `${usernamePrefix}${pad(i)}`;
  const email = `${username}@example.test`;
  const colors = ["#2563EB", "#059669", "#D97706", "#DC2626", "#7C3AED"];
  lines.push(
    `INSERT INTO users (username, email, password_hash, color, system_role) VALUES (${sqlString(username)}, ${sqlString(email)}, ${sqlString(hash)}, ${sqlString(colors[(i - 1) % colors.length])}, ${sqlString(i === 1 ? "super_admin" : "member")});`,
  );
}

lines.push(`INSERT INTO teams (name, description, status, created_by) VALUES (${sqlString(teamName)}, ${sqlString("用于前端高负载展示测试")}, 'active', (SELECT id FROM users WHERE username = ${sqlString(`${usernamePrefix}01`)}));`);
lines.push(`INSERT INTO team_members (team_id, user_id, status, joined_at) SELECT t.id, u.id, 'active', CURRENT_TIMESTAMP FROM teams t CROSS JOIN users u WHERE t.name = ${sqlString(teamName)} AND u.username LIKE ${sqlString(`${usernamePrefix}%`)} AND u.username <> ${sqlString(`${usernamePrefix}01`)};`);

for (let projectIndex = 1; projectIndex <= projectTaskCounts.length; projectIndex += 1) {
  const projectName = `高负载项目 ${pad(projectIndex)}`;
  lines.push(`INSERT INTO projects (team_id, name, description, status, created_by) VALUES ((SELECT id FROM teams WHERE name = ${sqlString(teamName)}), ${sqlString(projectName)}, ${sqlString(`包含 ${projectTaskCounts[projectIndex - 1]} 个任务的展示测试项目`)}, 'active', (SELECT id FROM users WHERE username = ${sqlString(`${usernamePrefix}01`)}));`);
  for (let taskIndex = 1; taskIndex <= projectTaskCounts[projectIndex - 1]; taskIndex += 1) {
    const assignee = 1 + Math.floor(rng() * userCount);
    const statusRoll = rng();
    const status = statusRoll < 0.15 ? "done" : statusRoll < 0.45 ? "in_progress" : "todo";
    const priority = ["low", "medium", "high", "urgent"][Math.floor(rng() * 4)];
    const start = `2026-09-${pad(1 + (taskIndex % 20))}T09:00:00.000Z`;
    const end = `2026-10-${pad(1 + (taskIndex % 20))}T18:00:00.000Z`;
    const completed = status === "done" ? `, ${sqlString(end)}` : ", NULL";
    lines.push(`INSERT INTO tasks (project_id, title, detail, assignee_id, start_date, end_date, status, priority, completed_at, created_by) VALUES ((SELECT id FROM projects WHERE team_id = (SELECT id FROM teams WHERE name = ${sqlString(teamName)}) AND name = ${sqlString(projectName)}), ${sqlString(`任务 ${pad(taskIndex, 3)} - ${projectName}`)}, ${sqlString("用于验证大量任务列表、筛选和甘特图布局")}, (SELECT id FROM users WHERE username = ${sqlString(`${usernamePrefix}${pad(assignee)}`)}), ${sqlString(start)}, ${sqlString(end)}, ${sqlString(status)}, ${sqlString(priority)}${completed}, (SELECT id FROM users WHERE username = ${sqlString(`${usernamePrefix}01`)}));`);
  }
}

lines.push("SELECT 'users' AS entity, COUNT(*) AS count FROM users WHERE username LIKE 'loadtest_user_%' UNION ALL SELECT 'projects', COUNT(*) FROM projects WHERE team_id = (SELECT id FROM teams WHERE name = '前端压力测试团队') UNION ALL SELECT 'tasks', COUNT(*) FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE team_id = (SELECT id FROM teams WHERE name = '前端压力测试团队'));" );

const directory = mkdtempSync(join(tmpdir(), "welo-loadtest-"));
const file = join(directory, "seed.sql");
writeFileSync(file, `${lines.join("\n")}\n`);
try {
  console.log(`Seeding ${remote ? "remote" : "local"} D1...`);
  execFileSync("npx", ["wrangler", "d1", "execute", "welo", target, "--file", file], { stdio: "inherit" });
  console.log(`Test users use password: ${password}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
