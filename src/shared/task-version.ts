export function isoTimestamp(value: string): string {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toISOString();
}

// Advance even when two writes occur within the same millisecond.
export function nextTaskVersion(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(isoTimestamp(previous)) + 1)).toISOString();
}
