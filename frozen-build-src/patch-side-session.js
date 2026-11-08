#!/usr/bin/env node
/**
 * Frozen-build patch: a side-Session shortcut (Ctrl+;) modelled on the shipped
 * `session.fork` action.
 *
 * Pressing it forks the Session you started from, opens the fork as an
 * independent Session, and remembers that origin so pressing it again opens
 * another side Session of the SAME main Session instead of chaining forks of
 * forks. The main Session keeps running in the background — a fork is a real
 * Session with its own agent loop.
 *
 * Idempotent: the inserted block carries a marker and is skipped when present.
 *
 * usage: node patch-side-session.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:side-session*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-side-session.js <payloadRoot> [--dry]');
  process.exit(2);
}

const file = path.join(
  payloadRoot,
  'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai',
  'dsh-client-ui-workspace', 'lib', 'client.js',
);

if (!fs.existsSync(file)) {
  console.error(`MISSING  ${file}`);
  process.exit(1);
}

const original = fs.readFileSync(file, 'utf8');

if (original.includes(MARK)) {
  console.log('skip     side-session shortcut (already applied)');
  process.exit(0);
}

const block = `\t\t\t// ${MARK} Ctrl+; opens another side Session of the Session you started from.
\t\t\tlet sideOrigin;
\t\t\tregister("session.side", () => "\\u526f\\u4f1a\\u8bdd", ["side session", "side chat"], "Semicolon", ["primary"], ["primary", "alt"], () => {
\t\t\t\tconst here = current();
\t\t\t\tif (here === void 0) return {
\t\t\t\t\tstatus: "blocked",
\t\t\t\t\treason: t("shortcut.noSession")
\t\t\t\t};
\t\t\t\tconst known = sideOrigin !== void 0 && sessions.list.getSnapshot().byId[sideOrigin] !== void 0;
\t\t\t\tconst originId = known ? sideOrigin : here.id;
\t\t\t\tif (here.blank && originId === here.id) return {
\t\t\t\t\tstatus: "blocked",
\t\t\t\t\treason: t("shortcut.noCompletedTurn")
\t\t\t\t};
\t\t\t\tsideOrigin = originId;
\t\t\t\treturn {
\t\t\t\t\tstatus: "handled",
\t\t\t\t\trun: () => {
\t\t\t\t\t\tnavigation.forkSession(originId).catch((error) => {
\t\t\t\t\t\t\tconst unavailable = error instanceof Error && error.name === "SessionForkError" && error.rpcError.code === "session/fork-unavailable";
\t\t\t\t\t\t\treportForkFailure(unavailable ? "unavailable" : "failed");
\t\t\t\t\t\t\tif (!unavailable) console.warn("side session fork rejected:", error);
\t\t\t\t\t\t});
\t\t\t\t\t}
\t\t\t\t};
\t\t\t});
`;

const anchor = /\n\t\t\tregister\("session\.archive"/;
const hits = [...original.matchAll(new RegExp(anchor.source, 'g'))];
if (hits.length !== 1) {
  console.error(`FAIL     anchor matched ${hits.length} time(s)`);
  process.exit(1);
}

const next = original.replace(anchor, `\n${block}\t\t\tregister("session.archive"`);
if (dry) {
  console.log(`dry      would write ${original.length} -> ${next.length} bytes`);
} else {
  fs.writeFileSync(file, next, 'utf8');
  console.log(`write    ${original.length} -> ${next.length} bytes`);
}
console.log('ok       side-session shortcut inserted');
