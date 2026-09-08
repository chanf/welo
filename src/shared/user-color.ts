export const USER_COLOR_PALETTE = [
  "#2563EB",
  "#DC2626",
  "#059669",
  "#D97706",
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "#65A30D",
  "#EA580C",
  "#0F766E",
  "#9333EA",
  "#BE123C",
] as const;

export async function allocateUserColor(db: D1Database) {
  const usage = await db
    .prepare(
      "SELECT color, COUNT(*) AS color_count FROM users WHERE color IS NOT NULL GROUP BY color",
    )
    .all<{ color: string; color_count: number }>();
  const counts = new Map(usage.results.map((row) => [row.color, row.color_count]));
  const minimum = Math.min(
    ...USER_COLOR_PALETTE.map((color) => counts.get(color) ?? 0),
  );
  const candidates = USER_COLOR_PALETTE.filter(
    (color) => (counts.get(color) ?? 0) === minimum,
  );
  return candidates[Math.floor(Math.random() * candidates.length)];
}
