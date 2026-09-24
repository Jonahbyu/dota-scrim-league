// Read-only: show the restrictions on the project's browser API keys (API Keys API).
// Uses the Firebase CLI login. Prints key names and restrictions, never key strings.
const { requireAuth } = require("firebase-tools/lib/requireAuth");
const { Client } = require("firebase-tools/lib/apiv2");
(async () => {
  const acct = require("firebase-tools/lib/auth").getGlobalDefaultAccount();
  await requireAuth({ project: "pistachio-kitchen", user: acct.user, tokens: acct.tokens });
  const c = new Client({ urlPrefix: "https://apikeys.googleapis.com", apiVersion: "v2" });
  const res = await c.get("/projects/pistachio-kitchen/locations/global/keys");
  for (const k of res.body.keys ?? []) {
    const r = k.restrictions ?? {};
    console.log(`${k.displayName || "(no name)"}  [${k.name.split("/").pop()}]`);
    console.log("  website restrictions:", r.browserKeyRestrictions?.allowedReferrers ?? "NONE");
    console.log("  API restrictions:", (r.apiTargets ?? []).map((t) => t.service) .join(", ") || "NONE (any API)");
  }
})().catch((e) => { console.error("FAILED:", e.message, JSON.stringify(e.context?.body ?? "").slice(0, 400)); process.exit(1); });
