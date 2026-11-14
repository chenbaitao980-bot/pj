#!/usr/bin/env node
/**
 * Remove the 0.2.3–0.2.6 Ctrl+; bundle patch.
 *
 * `patch-side-session.js` registered `session.side` from inside
 * `dsh-client-ui-workspace`. That registration is superseded by
 * `@local/dsh-side-chat`, which owns the shortcut, always produces a side
 * chat (fork when a turn has finished, fresh Session otherwise), and renders
 * the conversation as a right-panel tab. Keeping both would register the
 * same shortcut id twice, which the shortcut registry rejects.
 *
 * Idempotent: a file without the marker is reported and left unchanged.
 *
 * usage: node unpatch-side-session.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:side-session*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node unpatch-side-session.js <payloadRoot> [--dry]');
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
if (!original.includes(MARK)) {
  console.log('skip     side-session patch already absent');
  process.exit(0);
}

const pattern = /\n\t\t\t\/\/ \/\*dsh:side-session\*\/[^\n]*\n[\s\S]*?\n\t\t\t\}\);\n/g;
const hits = [...original.matchAll(pattern)];
if (hits.length !== 1) {
  console.error(`FAIL     side-session block matched ${hits.length} time(s)`);
  process.exit(1);
}

const next = original.replace(pattern, '\n');
if (next.includes(MARK)) {
  console.error('FAIL     marker survived removal');
  process.exit(1);
}

if (dry) {
  console.log(`dry      would write ${original.length} -> ${next.length} bytes`);
} else {
  fs.writeFileSync(file, next, 'utf8');
  console.log(`write    ${original.length} -> ${next.length} bytes`);
}
console.log('ok       side-session bundle patch removed');
