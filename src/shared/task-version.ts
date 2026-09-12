export function isoTimestamp(value: string): string {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toISOString();
}

// Advance even when two writes occur within the same millisecond.
export function nextTaskVersion(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(isoTimestamp(previous)) + 1)).toISOString();
}

export const nowIso = () => new Date().toISOString();
export const shanghaiToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
