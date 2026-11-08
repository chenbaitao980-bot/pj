const fs = require("fs");
const p = (process.env.FROZEN_APP || "D:/dsh-freeze-build/payload/resources/app") + "/lib/main.js";
let s = fs.readFileSync(p, "utf8");
const before = "\t}\n\tautomaticCheck();\n\tawait reconcileBackend()";
const after = [
  "\t} else {",
  '\t\tconst idleView = () => ({ locale, policy: { blocking: false, checking: false }, update: { phase: "idle" }, deferred: false });',
  "\t\tipcMain.handle(MANDATORY_IPC.status, () => idleView());",
  '\t\tipcMain.handle(MANDATORY_IPC.action, () => { throw new Error("desktop policy: no mandatory decision is active"); });',
  "\t}",
  "\tautomaticCheck();",
  "\tawait reconcileBackend()",
].join("\n");
if (!s.includes(before)) throw new Error("anchor not found");
s = s.replace(before, after);
fs.writeFileSync(p, s, "utf8");
console.log("patched");
