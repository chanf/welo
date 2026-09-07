export type ErrorDetail = { field?: string; reason: string };

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 423 | 429 | 500,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "NOT_FOUND", "资源不存在或当前用户不可见");
export const forbidden = () => new ApiError(403, "FORBIDDEN", "无权限执行此操作");
