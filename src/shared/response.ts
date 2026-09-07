import type { Context } from "hono";
import type { ErrorDetail } from "./errors";

export function requestId(c: Context): string {
  return c.get("requestId") ?? crypto.randomUUID();
}

export function ok<T>(c: Context, data: T, status: 200 | 201 = 200, pagination?: unknown) {
  return c.json({ data, meta: { requestId: requestId(c), pagination: pagination ?? null } }, status);
}

export function fail(c: Context, code: string, message: string, status: number, details: ErrorDetail[] = []) {
  return c.json({ error: { code, message, ...(details.length ? { details } : {}) }, meta: { requestId: requestId(c) } }, status as never);
}
