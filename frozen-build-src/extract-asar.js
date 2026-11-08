// Minimal ASAR extractor (no deps). Usage: node extract-asar.js <app.asar> <outDir>
const fs = require("fs");
const path = require("path");

const asar = process.argv[2];
const out = process.argv[3];
if (!asar || !out) {
  console.error("usage: node extract-asar.js <app.asar> <outDir>");
  process.exit(2);
}

const buf = fs.readFileSync(asar);
const headerSize = buf.readUInt32LE(4);
const jsonSize = buf.readUInt32LE(12);
const header = JSON.parse(buf.slice(16, 16 + jsonSize).toString("utf8"));
const base = 8 + headerSize;

let files = 0;
let dirs = 0;

function walk(node, rel) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = rel ? path.join(rel, name) : name;
    if (entry.files) {
      fs.mkdirSync(path.join(out, p), { recursive: true });
      dirs += 1;
      walk(entry, p);
    } else if (entry.link) {
      // symlink: recreate as file copy of target if it exists, else skip
      continue;
    } else {
      const dest = path.join(out, p);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const start = base + Number(entry.offset || 0);
      fs.writeFileSync(dest, buf.subarray(start, start + Number(entry.size || 0)));
      files += 1;
    }
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
walk(header, "");
console.log(JSON.stringify({ out, files, dirs }));
