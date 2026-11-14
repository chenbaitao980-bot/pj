#!/usr/bin/env node
/**
 * Frozen-build patch: the left sidebar carries a session tracker above the
 * workspace browser.
 *
 * The sidebar shell declares one more child hole, `sidebar.tracker`, on its
 * root slot registration and renders it inside the region area, before
 * `sidebar.workspaces`. `@local/dsh-session-tracker`'s client half registers
 * the panel there; without this patch that registration has no hole to land
 * in and the tracker never mounts.
 *
 * Idempotent: the inserted pieces carry a marker and are skipped when present.
 *
 * usage: node patch-session-tracker.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:sidebar-tracker*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-session-tracker.js <payloadRoot> [--dry]');
  process.exit(2);
}

const file = path.join(
  payloadRoot,
  'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai',
  'dsh-client-ui-sidebar', 'lib', 'client.js',
);

if (!fs.existsSync(file)) {
  console.error(`MISSING  ${file}`);
  process.exit(1);
}

const original = fs.readFileSync(file, 'utf8');

if (original.includes(MARK)) {
  console.log('skip     sidebar tracker (already applied)');
  process.exit(0);
}

/** 1. Declare the child hole next to `sidebar.workspaces`. */
const FIND_CHILD = `\t\t\t\t\t"sidebar.workspaces": {\n\t\t\t\t\t\tkind: "single",\n\t\t\t\t\t\tscope: "root"\n\t\t\t\t\t},`;
const REPLACE_CHILD = `\t\t\t\t\t${MARK}\n\t\t\t\t\t// Session tracker panel, mounted above the workspace browser.\n\t\t\t\t\t"sidebar.tracker": {\n\t\t\t\t\t\tkind: "single",\n\t\t\t\t\t\tscope: "root"\n\t\t\t\t\t},\n\t\t\t\t\t"sidebar.workspaces": {\n\t\t\t\t\t\tkind: "single",\n\t\t\t\t\t\tscope: "root"\n\t\t\t\t\t},`;

/** 2. Render it (wide sidebar only; the 56px rail has no room) inside the region area. */
const FIND_RENDER = `\t\t\t\t\t\tclassName: SidebarRoot_module_css_default.regionArea,\n\t\t\t\t\t\tchildren: renderSlot("sidebar.workspaces", {\n\t\t\t\t\t\t\twide,\n\t\t\t\t\t\t\texpandSidebar: () => {\n\t\t\t\t\t\t\t\tif (collapsed) toggleSidebar();\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t})`;
const REPLACE_RENDER = `\t\t\t\t\t\tclassName: SidebarRoot_module_css_default.regionArea,\n\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t${MARK} wide && renderSlot("sidebar.tracker", { wide }),\n\t\t\t\t\t\t\trenderSlot("sidebar.workspaces", {\n\t\t\t\t\t\t\t\twide,\n\t\t\t\t\t\t\t\texpandSidebar: () => {\n\t\t\t\t\t\t\t\t\tif (collapsed) toggleSidebar();\n\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t})\n\t\t\t\t\t\t]`;

for (const [label, find, replace] of [
  ['child slot declaration', FIND_CHILD, REPLACE_CHILD],
  ['region area render', FIND_RENDER, REPLACE_RENDER],
]) {
  const hits = original.split(find).length - 1;
  if (hits !== 1) {
    console.error(`FAIL     ${label} anchor matched ${hits} time(s)`);
    process.exit(1);
  }
}

let next = original.replace(FIND_CHILD, REPLACE_CHILD).replace(FIND_RENDER, REPLACE_RENDER);

if (dry) {
  console.log('dry      would patch', file);
  process.exit(0);
}

fs.writeFileSync(file, next, 'utf8');
console.log(`patched  ${path.relative(payloadRoot, file)}`);
