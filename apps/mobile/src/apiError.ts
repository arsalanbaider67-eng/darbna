export type ApiErrorCode = "offline" | "timeout" | "rate_limited" | "server" | string;

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, public status = 0, public retryAfterS?: number) {
    super(code);
  }
  get isNetwork() {
    return this.code === "offline" || this.code === "timeout";
  }
}

