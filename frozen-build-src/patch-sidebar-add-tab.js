#!/usr/bin/env node
/**
 * Frozen-build patch: the right panel's "+" keeps creating side chats.
 *
 * `@local/dsh-side-chat` installs `globalThis.__DSH_SIDE_CHAT__.claimAddTab`.
 * While the Session already keeps a side-chat tab open, the add control asks
 * that hook first, so "+" opens another side chat of the same conversation
 * instead of the tab guide (browser / files / terminal …). With no side chat
 * open the guide still opens exactly as shipped.
 *
 * Idempotent: the inserted block carries a marker and is skipped when present.
 *
 * usage: node patch-sidebar-add-tab.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:side-chat-addtab*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-sidebar-add-tab.js <payloadRoot> [--dry]');
  process.exit(2);
}

const file = path.join(
  payloadRoot,
  'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai',
  'dsh-client-ui-sidebar-right', 'lib', 'client.js',
);

if (!fs.existsSync(file)) {
  console.error(`MISSING  ${file}`);
  process.exit(1);
}

const original = fs.readFileSync(file, 'utf8');

if (original.includes(MARK)) {
  console.log('skip     side-chat add-tab (already applied)');
  process.exit(0);
}

const find = `\t\t\t\taddTab: (paneId) => {
\t\t\t\t\topenTab(GUIDE_KIND, {
\t\t\t\t\t\tpaneId,
\t\t\t\t\t\trevealIfOpened: false
\t\t\t\t\t});
\t\t\t\t},`;

const replace = `\t\t\t\taddTab: (paneId) => { ${MARK}
\t\t\t\t\tconst sideChat = globalThis.__DSH_SIDE_CHAT__;
\t\t\t\t\tif (sideChat !== void 0 && sideChat.claimAddTab?.(sessionId, paneId) === true) return;
\t\t\t\t\topenTab(GUIDE_KIND, {
\t\t\t\t\t\tpaneId,
\t\t\t\t\t\trevealIfOpened: false
\t\t\t\t\t});
\t\t\t\t},`;

const hits = original.split(find).length - 1;
if (hits !== 1) {
  console.error(`FAIL     addTab anchor matched ${hits} time(s)`);
  process.exit(1);
}

const next = original.replace(find, replace);
if (next.includes(MARK) !== true) {
  console.error('FAIL     marker did not land');
  process.exit(1);
}

if (dry) {
  console.log(`dry      would write ${original.length} -> ${next.length} bytes`);
} else {
  fs.writeFileSync(file, next, 'utf8');
  console.log(`write    ${original.length} -> ${next.length} bytes`);
}
console.log('ok       side-chat add-tab hook inserted');
