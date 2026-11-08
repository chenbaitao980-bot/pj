const fs = require("fs");

const appRoot = process.env.FROZEN_APP || "D:/dsh-freeze-build/payload/resources/app";
const mainPath = `${appRoot}/lib/main.js`;

let s = fs.readFileSync(mainPath, "utf8");
const before = 'enabled = () => app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"))';
const after = "enabled = () => false";
if (!s.includes(before)) throw new Error("enabled pattern not found");
s = s.replace(before, after);
fs.writeFileSync(mainPath, s, "utf8");

const pjPath = `${appRoot}/package.json`;
const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
delete pj.dshMandatoryUpdatePolicy;
pj.dshFrozenBuild = true;
fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + "\n", "utf8");

console.log("main.js patched:", s.includes("enabled = () => false"));
console.log("policy removed:", !("dshMandatoryUpdatePolicy" in pj));
