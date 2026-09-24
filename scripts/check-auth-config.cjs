const { requireAuth } = require("firebase-tools/lib/requireAuth");
const { Client } = require("firebase-tools/lib/apiv2");
(async () => {
  const acct = require("firebase-tools/lib/auth").getGlobalDefaultAccount();
  await requireAuth({ project: "pistachio-kitchen", user: acct.user, tokens: acct.tokens });
  const c = new Client({ urlPrefix: "https://identitytoolkit.googleapis.com", apiVersion: "admin/v2" });
  const cfg = (await c.get("/projects/pistachio-kitchen/config")).body;
  console.log("anonymous:", cfg.signIn?.anonymous?.enabled, "| email:", cfg.signIn?.email?.enabled);
  console.log("authorizedDomains:", cfg.authorizedDomains);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
