import { chromium } from "./frontend-prototype/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

await page.goto("http://localhost:5173");
await page.getByRole("button", { name: "注册" }).click();
await page.locator('input[name="username"]').fill("codexui0908");
await page.locator('input[name="email"]').fill("codex-ui-0908@example.com");
await page.locator('input[name="password"]').fill("CodexUI2026");
await page.locator('input[name="passwordConfirmation"]').fill("CodexUI2026");
await page.getByRole("button", { name: "注册", exact: true }).click();
await page.waitForSelector("#teamSelect");
await page.selectOption("#teamSelect", "1");
await page.waitForSelector("#projectSelect option:not([value=''])");
await page.selectOption("#projectSelect", { index: 1 });
await page.waitForSelector("#ganttPanel .timeline-head");

const results = [];
for (const granularity of ["hour", "halfDay", "day"]) {
  await page
    .locator(
      `[data-action="granularity-change"][data-granularity="${granularity}"]`,
    )
    .click();
  await page.waitForFunction(
    (value) =>
      document.querySelector("#ganttPanel")?.dataset.granularity === value,
    granularity,
  );
  const panel = page.locator("#ganttPanel");
  await panel.screenshot({ path: `/tmp/welo-gantt-${granularity}.png` });
  results.push(
    await page.evaluate((value) => {
      const header = document.querySelector(".timeline-cells");
      const track = document.querySelector(".track");
      const cells = [
        ...document.querySelectorAll(".gantt-cell, .day-group-label"),
      ];
      return {
        granularity: value,
        headerWidth: header.getBoundingClientRect().width,
        trackWidth: track.getBoundingClientRect().width,
        aligned:
          Math.abs(
            header.getBoundingClientRect().left -
              track.getBoundingClientRect().left,
          ) < 1,
        overflowingCells: cells.filter(
          (cell) => cell.scrollWidth > cell.clientWidth,
        ).length,
        cellCount: document.querySelectorAll(".gantt-cell").length,
        backgroundSize: getComputedStyle(track).backgroundSize,
        dayWidth: parseFloat(
          getComputedStyle(
            document.querySelector("#ganttPanel"),
          ).getPropertyValue("--gantt-day-width"),
        ),
      };
    }, granularity),
  );
}

await page.locator('[data-action="gantt-view"][data-view="assignees"]').click();
await page.waitForSelector(".assignee-track");
await page
  .locator("#ganttPanel")
  .screenshot({ path: "/tmp/welo-gantt-assignees.png" });

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  storageState: await context.storageState(),
});
const mobilePage = await mobileContext.newPage();
await mobilePage.goto("http://localhost:5173/#workspace");
await mobilePage.waitForSelector("#ganttPanel .timeline-head");
await mobilePage
  .locator("#ganttPanel")
  .screenshot({ path: "/tmp/welo-gantt-mobile.png" });

console.log(JSON.stringify(results, null, 2));
await browser.close();
