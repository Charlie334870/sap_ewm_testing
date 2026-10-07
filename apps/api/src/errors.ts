/** An error that is safe to show to the caller. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in to continue.") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "Your role does not allow this action.") =>
  new AppError(403, "forbidden", message);
/** Also used when a record exists but the caller may not know that it does. */
export const notFound = (what = "Record") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (message: string) => new AppError(409, "conflict", message);
