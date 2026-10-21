// GET /api/diagnostics: grade the matcher against the synthetic answer key.
// Internal tool: in production this would be employee-only.

import { route } from "@/lib/http";
import { runDiagnostics } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

export const GET = route(() => runDiagnostics());
