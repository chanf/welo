#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const remote = process.argv.includes("--remote");
const target = remote ? "--remote" : "--local";
const database = "welo";

const run = (command) => {
  const output = execFileSync("npx", ["wrangler", "d1", "execute", database, target, "--command", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  process.stdout.write(output);
};

const condition = "(start_date IS NOT NULL AND length(start_date) > 16) OR length(end_date) > 16";
const preview = `SELECT COUNT(*) AS affected_tasks,
  SUM(CASE WHEN start_date IS NOT NULL AND length(start_date) > 16 THEN 1 ELSE 0 END) AS affected_start_dates,
  SUM(CASE WHEN length(end_date) > 16 THEN 1 ELSE 0 END) AS affected_end_dates
FROM tasks WHERE ${condition};`;

console.log(`Checking ${remote ? "remote" : "local"} D1 task dates...`);
run(preview);

if (!apply) {
  console.log("Dry run only. Add --apply to normalize the affected dates.");
  process.exit(0);
}

const update = `UPDATE tasks
SET start_date = CASE WHEN start_date IS NOT NULL AND length(start_date) > 16 THEN substr(start_date, 1, 16) ELSE start_date END,
    end_date = CASE WHEN length(end_date) > 16 THEN substr(end_date, 1, 16) ELSE end_date END,
    updated_at = CURRENT_TIMESTAMP,
    updated_by = created_by
WHERE ${condition};`;
run(update);
console.log("Task dates normalized to YYYY-MM-DDTHH:mm.");
