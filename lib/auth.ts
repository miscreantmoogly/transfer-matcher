// Stubbed authentication.
//
// The demo picks the acting user from an "x-user-id" header (set by the UI's
// "Acting as" switcher). In production this would be Firebase Auth: the
// browser sends a Firebase ID token, the server verifies it with the Firebase
// Admin SDK, and the verified uid maps to a user row. Everything below this
// function (permission checks, audit logging) stays exactly the same.

import type { DB } from "./db";
import { HttpError } from "./errors";

export type CurrentUser = { id: string; name: string; role: string; entityIds: string[] };

export function loadUser(db: DB, userId: string): CurrentUser {
  const user = db.prepare("SELECT id, name, role FROM users WHERE id = ?").get(userId) as
    | { id: string; name: string; role: string }
    | undefined;
  if (!user) throw new HttpError(401, `Unknown user "${userId}"`);
  const entityIds = (
    db.prepare("SELECT entity_id FROM user_entity_access WHERE user_id = ? ORDER BY entity_id").all(userId) as {
      entity_id: string;
    }[]
  ).map((r) => r.entity_id);
  return { ...user, entityIds };
}

export function userFromRequest(db: DB, request: Request): CurrentUser {
  return loadUser(db, request.headers.get("x-user-id") ?? "wes");
}

/** A user may act on a match only if they can see every entity it touches. */
export function canSeeAll(user: CurrentUser, entityIds: Iterable<string>): boolean {
  for (const id of entityIds) if (!user.entityIds.includes(id)) return false;
  return true;
}
