// Restrict the Firebase browser key to our own websites (HTTP referrers). Only the
// website list is changed (updateMask); the allowed-APIs list is left as it is.
// Usage: node scripts/restrict-api-key.cjs
const { requireAuth } = require("firebase-tools/lib/requireAuth");
const { Client } = require("firebase-tools/lib/apiv2");

const KEY = "projects/pistachio-kitchen/locations/global/keys/2ce3f517-3196-4274-b5d5-2545a314d6ee";
const ALLOWED = [
  "https://jonahbyu.github.io/*",               // Cookbook, Maze Racer, old scrim site
  "https://dota2scrimcircuittracker.github.io/*", // scrim tracker (org site)
  "https://pistachio-kitchen.firebaseapp.com/*", // Firebase auth handler pages
  "https://pistachio-kitchen.web.app/*",
  "http://localhost/*",                          // local dev
  "http://localhost:*/*",
  "http://127.0.0.1:*/*",
];

(async () => {
  const acct = require("firebase-tools/lib/auth").getGlobalDefaultAccount();
  await requireAuth({ project: "pistachio-kitchen", user: acct.user, tokens: acct.tokens });
  const c = new Client({ urlPrefix: "https://apikeys.googleapis.com", apiVersion: "v2" });
  const op = await c.patch(`/${KEY}`, { restrictions: { browserKeyRestrictions: { allowedReferrers: ALLOWED } } },
    { queryParams: { updateMask: "restrictions.browserKeyRestrictions" } });
  console.log("operation:", op.body.name, "done:", op.body.done ?? false);
  const after = (await c.get(`/${KEY}`)).body.restrictions;
  console.log("allowed websites now:", after.browserKeyRestrictions?.allowedReferrers);
  console.log("allowed APIs unchanged:", (after.apiTargets ?? []).length, "services");
})().catch((e) => { console.error("FAILED:", e.message, JSON.stringify(e.context?.body ?? "").slice(0, 500)); process.exit(1); });
