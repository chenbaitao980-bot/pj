#!/usr/bin/env node
/**
 * Frozen-build patch: a localized title for the "plugin" group in the `/` menu.
 *
 * `MenuView` titles each source with `t(source.name)` in the `slash.menu`
 * namespace, so a source registered by a local plugin would read "plugin". The
 * zh and en dictionaries are owned by `dsh-client-ui-input-trigger` (a second
 * `locale.register` on the same namespace/locale throws), so the title is added
 * to the shipped dictionaries.
 *
 * The locale chain always falls back to `en`, so every other shipped locale
 * (ja/es/fr/de/ru/pt) resolves the new key to "Plugins" — the English value —
 * rather than the raw key.
 *
 * Idempotent per dictionary: an edit whose key is already present is skipped,
 * so a partially applied file converges instead of gaining a duplicate key.
 *
 * usage: node patch-slash-plugin-group.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-slash-plugin-group.js <payloadRoot> [--dry]');
  process.exit(2);
}

const file = path.join(
  payloadRoot,
  'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai',
  'dsh-client-ui-input-trigger', 'lib', 'client.js',
);

if (!fs.existsSync(file)) {
  console.error(`MISSING  ${file}`);
  process.exit(1);
}

const original = fs.readFileSync(file, 'utf8');

/** One dictionary each; `key` proves that dictionary already carries the entry. */
const EDITS = [
  {
    label: 'zh dictionary',
    key: '"plugin": "插件"',
    find: '\t\tconst zh = {\n\t\t\t"command": "指令",',
    replace: '\t\tconst zh = {\n\t\t\t"command": "指令",\n\t\t\t"plugin": "插件",',
  },
  {
    label: 'en dictionary',
    key: '"plugin": "Plugins"',
    find: '\t\tconst en = {\n\t\t\t"command": "Commands",',
    replace: '\t\tconst en = {\n\t\t\t"command": "Commands",\n\t\t\t"plugin": "Plugins",',
  },
];

const count = (haystack, needle) => haystack.split(needle).length - 1;

let next = original;
let applied = 0;
let skipped = 0;
let failed = 0;

for (const edit of EDITS) {
  if (next.includes(edit.key)) {
    skipped += 1;
    continue;
  }
  const hits = count(next, edit.find);
  if (hits !== 1) {
    console.error(`FAIL     ${edit.label}: anchor matched ${hits} time(s)`);
    failed += 1;
    continue;
  }
  next = next.replace(edit.find, edit.replace);
  applied += 1;
}

if (failed > 0) {
  console.error(`FAIL     ${failed} edit(s) did not apply`);
  process.exit(1);
}

if (applied === 0) {
  console.log('skip     slash plugin group title (already applied)');
  process.exit(0);
}

if (dry) {
  console.log(`dry      would write ${original.length} -> ${next.length} bytes (${applied} edit(s), ${skipped} already present)`);
} else {
  fs.writeFileSync(file, next, 'utf8');
  console.log(`write    ${original.length} -> ${next.length} bytes (${applied} edit(s), ${skipped} already present)`);
}
console.log('ok       slash.menu carries the plugin group title');
