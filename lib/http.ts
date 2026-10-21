// Shared wrapper for API route handlers: JSON in, JSON out, errors mapped to
// HTTP status codes in exactly one place.

import { getDb, type DB } from "./db";
import { userFromRequest, type CurrentUser } from "./auth";
import { HttpError } from "./errors";

type Ctx<P> = { db: DB; user: CurrentUser; body: any; params: P; request: Request };

export function route<P = Record<string, string>>(handler: (ctx: Ctx<P>) => unknown) {
  return async (request: Request, context: { params: Promise<P> }) => {
    try {
      const db = getDb();
      const user = userFromRequest(db, request);
      const body = request.method === "GET" ? null : await request.json().catch(() => ({}));
      const params = ((await context?.params) ?? {}) as P;
      return Response.json(await handler({ db, user, body, params, request }));
    } catch (e) {
      if (e instanceof HttpError) {
        return Response.json({ error: e.message, details: e.details }, { status: e.status });
      }
      // A unique-index violation means we lost a race: report it as a conflict.
      if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
        return Response.json({ error: "Conflicting change, please refresh and retry" }, { status: 409 });
      }
      console.error(e);
      return Response.json({ error: e instanceof Error ? e.message : "Internal error" }, { status: 500 });
    }
  };
}

export const intParam = (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, `Bad id "${value}"`);
  return n;
};
