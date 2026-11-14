#!/usr/bin/env node
/**
 * Frozen-build patch: keep side chats out of the left session list.
 *
 * A side chat is a real forked Session, so the Host catalogs it and the
 * workspace list would render it as another row next to the conversation it
 * was forked from. `@local/dsh-side-chat` publishes
 * `globalThis.__DSH_SIDE_CHAT__.isSideSession(id)` (backed by its persisted
 * links); this patch makes `sessionVisible` consult it, so side chats live
 * only in the right panel — Ctrl+; still reopens them, and the tab machinery
 * is untouched.
 *
 * The predicate is optional: without the plugin (or before it loads) the list
 * behaves exactly like upstream.
 *
 * Idempotent: the inserted line carries a marker and is skipped when present.
 *
 * usage: node patch-side-chat-hide.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:side-chat-hidden*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-side-chat-hide.js <payloadRoot> [--dry]');
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
  console.log('skip     side-chat list hiding (already applied)');
  process.exit(0);
}

const ANCHOR =
  '\t\tfunction sessionVisible(session, current, archived, archivedFilter) {\n' +
  '\t\t\tif (session.origin === "subagent") return false;';

const hits = original.split(ANCHOR).length - 1;
if (hits !== 1) {
  console.error(`FAIL     sessionVisible anchor matched ${hits} time(s)`);
  process.exit(1);
}

const INSERT =
  `${ANCHOR}\n` +
  `\t\t\t// ${MARK} Side chats render in the right panel, never as session rows.\n` +
  '\t\t\tif (globalThis.__DSH_SIDE_CHAT__?.isSideSession?.(session.id) === true) return false;';

const next = original.replace(ANCHOR, INSERT);

if (dry) {
  console.log(`dry      would write ${original.length} -> ${next.length} bytes`);
} else {
  fs.writeFileSync(file, next, 'utf8');
  console.log(`write    ${original.length} -> ${next.length} bytes`);
}
console.log('ok       side chats hidden from the session list');
