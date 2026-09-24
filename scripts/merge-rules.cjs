// Insert (or replace) the Dota Scrim League block in the project-wide rules file.
// Firestore has one ruleset per project, and it's deployed from the Cookbook repo, so this
// block has to live there too. Usage: node scripts/merge-rules.cjs <path-to-Cookbook/firestore.rules>
const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (!target) throw new Error("usage: node scripts/merge-rules.cjs <firestore.rules>");
const block = fs.readFileSync(path.join(__dirname, "..", "firebase", "scrimleague.rules"), "utf8").replace(/\r/g, "").trimEnd();
const original = fs.readFileSync(target, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
let src = original.replace(/\r/g, "");

const START = "    // ---------- Dota Scrim League ----------";
const existing = src.indexOf(START);
if (existing >= 0) {
  // Replace: from the marker to the end of its match block (the line "    }" before the closers).
  const end = src.lastIndexOf("\n  }\n}");
  src = src.slice(0, existing).trimEnd() + "\n\n" + block + "\n" + src.slice(end);
} else {
  const end = src.lastIndexOf("\n  }\n}");
  if (end < 0) throw new Error("Couldn't find the closing braces of the documents match block.");
  src = src.slice(0, end).trimEnd() + "\n\n" + block + "\n" + src.slice(end);
}
fs.writeFileSync(target, src.replace(/\n/g, eol));
console.log(existing >= 0 ? "replaced existing block" : "inserted block", "in", target);
