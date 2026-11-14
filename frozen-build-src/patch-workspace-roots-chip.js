#!/usr/bin/env node
/**
 * Frozen-build patch: show the extra workspace roots on the composer chip.
 *
 * `@local/dsh-multi-workspace` publishes a `multiWorkspaceRoots` session
 * projection, so every Client already receives the Session's roots as
 * `projectionValues.multiWorkspaceRoots.roots`. The workspace chip appends
 * ` +N` when a Session has extra roots, making a multi-workspace Session
 * visibly different from a single-workspace one.
 *
 * Idempotent: the inserted code carries a marker and is skipped when present.
 *
 * usage: node patch-workspace-roots-chip.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:roots-chip*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-workspace-roots-chip.js <payloadRoot> [--dry]');
  process.exit(2);
}

const file = path.join(
  payloadRoot,
  'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai',
  'dsh-client-ui-conversation', 'lib', 'client.js',
);

if (!fs.existsSync(file)) {
  console.error(`MISSING  ${file}`);
  process.exit(1);
}

const original = fs.readFileSync(file, 'utf8');
if (original.includes(MARK)) {
  console.log('skip     roots chip (already applied)');
  process.exit(0);
}

const EDITS = [
  [
    'subscribe to the roots projection',
    'const cwd = useSessions((s) => sessionId === void 0 ? void 0 : s.byId[sessionId]?.cwd);',
    `const cwd = useSessions((s) => sessionId === void 0 ? void 0 : s.byId[sessionId]?.cwd);
\t\t\tconst multiWorkspaceRoots = useSessions((s) => sessionId === void 0 ? void 0 : s.byId[sessionId]?.projectionValues?.multiWorkspaceRoots?.roots); ${MARK}`,
  ],
  [
    'append the extra-root count to the chip label',
    '\t\t\t\t\t\tlabel: chipTitle,',
    '\t\t\t\t\t\tlabel: chipTitle === void 0 ? void 0 : multiWorkspaceRoots !== void 0 && multiWorkspaceRoots.length > 0 ? chipTitle + " +" + multiWorkspaceRoots.length : chipTitle,',
  ],
];

let failed = 0;
for (const [label, find] of EDITS) {
  const hits = original.split(find).length - 1;
  if (hits !== 1) {
    console.error(`FAIL     ${label}: anchor matched ${hits} time(s)`);
    failed += 1;
  }
}
if (failed > 0) {
  console.error(`FAIL     ${failed} edit(s) did not apply`);
  process.exit(1);
}

let next = original;
for (const [, find, replace] of EDITS) next = next.replace(find, replace);

if (dry) {
  console.log(`dry      would write ${original.length} -> ${next.length} bytes`);
} else {
  fs.writeFileSync(file, next, 'utf8');
  console.log(`write    ${original.length} -> ${next.length} bytes`);
}
console.log('ok       roots chip inserted');
