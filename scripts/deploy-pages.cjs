// Publish public/ to the gh-pages branch, which GitHub Pages serves.
// Usage: npm run deploy   (commit your changes on main first)
const { execSync } = require("child_process");
const run = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

if (run("git status --porcelain -- public")) {
  console.error("public/ has uncommitted changes — commit them first.");
  process.exit(1);
}
const sha = run("git subtree split --prefix public HEAD");
execSync(`git push origin ${sha}:refs/heads/gh-pages --force`, { stdio: "inherit" });
console.log(`Published public/ (${sha.slice(0, 7)}) to gh-pages.`);
