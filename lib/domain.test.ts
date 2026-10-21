// The database, the server and the UI must agree on the same vocabulary.
// This reads the CHECK constraints straight from db/schema.sql.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MATCH_KINDS, MATCH_SOURCES, MATCH_TIERS, PROPOSAL_STATUSES, SALE_DECISIONS } from "./domain";

const schema = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");

/** The values allowed by `<column> ... CHECK (<column> IN (...))` inside one table. */
function allowed(table: string, column: string): string[] {
  const body = schema.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`))?.[1];
  if (!body) throw new Error(`No table ${table}`);
  const list = body.match(new RegExp(`\\b${column}\\b[^\\n]*CHECK \\(${column} IN \\(([^)]*)\\)`))?.[1];
  if (!list) throw new Error(`No CHECK on ${table}.${column}`);
  return list.split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
}

describe("shared vocabulary matches the database", () => {
  it.each([
    ["match_proposals", "status", PROPOSAL_STATUSES],
    ["match_proposals", "tier", MATCH_TIERS],
    ["match_proposals", "kind", MATCH_KINDS],
    ["match_proposals", "source", MATCH_SOURCES],
    ["intercompany_sales", "status", SALE_DECISIONS],
  ] as const)("%s.%s", (table, column, values) => {
    expect(allowed(table, column).sort()).toEqual([...values].sort());
  });
});
