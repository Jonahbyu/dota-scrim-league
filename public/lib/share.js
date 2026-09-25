// Link previews (Discord, iMessage, Slack) read a page's HTML and never see the part of a
// link after "#", so every #/... route looked like the home page. At deploy time
// scripts/share-pages.js writes a tiny page at a real path for each shareable route
// (/heroic/week/, /ad2l/teams/123/, ...) with that page's own title and description,
// which then forwards to the #/ route. These two functions are the mapping both ways.

const TABS = "week|players|heroes|predict|upload";
const SHAREABLE = new RegExp(`^(?:(?:${TABS}|teams)|(?:ad2l|conqueror|heroic(?:/[ab])?)(?:/(?:${TABS}))?|(?:ad2l|heroic|conqueror)/(?:teams|game)/\\d+)?$`);

// "#/heroic/b/week" -> "/heroic/b/week/"; null when the route has no preview page.
export function sharePath(hash) {
  const p = String(hash || "#/").replace(/^#\/?/, "").replace(/\/+$/, "");
  return SHAREABLE.test(p) ? (p ? `/${p}/` : "/") : null;
}

// "heroic/b/week" -> "#/heroic/b/week"; a bare league root keeps its trailing slash.
export function routeOf(path) {
  const p = path.replace(/^\/+|\/+$/g, "");
  return /^(ad2l|conqueror|heroic(\/[ab])?)$/.test(p) ? `#/${p}/` : `#/${p}`;
}
