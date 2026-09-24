// Add a domain to Firebase Auth's authorized domains (keeps the existing ones).
// Usage: node scripts/add-auth-domain.cjs dota2scrimcircuittracker.github.io
const { requireAuth } = require("firebase-tools/lib/requireAuth");
const { Client } = require("firebase-tools/lib/apiv2");
const domain = process.argv[2];
if (!domain) throw new Error("usage: node scripts/add-auth-domain.cjs <domain>");
(async () => {
  const acct = require("firebase-tools/lib/auth").getGlobalDefaultAccount();
  await requireAuth({ project: "pistachio-kitchen", user: acct.user, tokens: acct.tokens });
  const c = new Client({ urlPrefix: "https://identitytoolkit.googleapis.com", apiVersion: "admin/v2" });
  const cfg = (await c.get("/projects/pistachio-kitchen/config")).body;
  const current = cfg.authorizedDomains ?? [];
  if (current.includes(domain)) { console.log("already authorized:", current); return; }
  const next = [...current, domain];
  await c.patch("/projects/pistachio-kitchen/config", { authorizedDomains: next }, { queryParams: { updateMask: "authorizedDomains" } });
  console.log("authorized domains now:", (await c.get("/projects/pistachio-kitchen/config")).body.authorizedDomains);
})().catch((e) => { console.error("FAILED:", e.message, JSON.stringify(e.context?.body ?? "").slice(0, 400)); process.exit(1); });
