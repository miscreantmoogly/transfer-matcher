// Errors that map cleanly onto HTTP status codes.

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const forbidden = (message: string) => new HttpError(403, message);
export const badRequest = (message: string) => new HttpError(400, message);
/** Someone else changed this first (stale version, already applied, ...). */
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);
