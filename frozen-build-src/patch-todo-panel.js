#!/usr/bin/env node
/**
 * Frozen-build patch: the Session todo dock becomes a live task board.
 *
 * Upstream renders `TodoPanel` collapsed by default: a one-line summary the
 * user has to click open. The frozen build keeps the list expanded, re-expands
 * it whenever the set of `in_progress` items changes, and spells each row's
 * status out (done / in progress / pending) with strikethrough for finished
 * rows, so the current Session's task list reads at a glance and follows the
 * `todos` projection live.
 *
 * The visible status text repeats the glyph's `aria-label`, so it is hidden
 * from assistive technology; the glyph stays the announced element.
 *
 * Idempotent. Three inputs are recognised:
 *   - already v2 (marker `dsh:todo-live-v2`): skipped;
 *   - v1 from 0.2.11-rc.1/rc.2 (marker `dsh:todo-live` only): upgraded in
 *     place (active-set dependency + aria-hidden);
 *   - pristine: both edits are applied.
 *
 * usage: node patch-todo-panel.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:todo-live*/';
const MARK_V2 = '/*dsh:todo-live-v2*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-todo-panel.js <payloadRoot> [--dry]');
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

const write = (from, to, label) => {
  if (dry) {
    console.log(`dry      ${label}: ${from.length} -> ${to.length} bytes`);
  } else {
    fs.writeFileSync(file, to, 'utf8');
    console.log(`write    ${label}: ${from.length} -> ${to.length} bytes`);
  }
};

const original = fs.readFileSync(file, 'utf8');

/* ---------------------------------------------------------------- v1 -> v2 */
const V1_BLOCK = `\t\t\t// ${MARK} keep the task list open and follow the todos projection.\n\t\t\tconst [collapsed, setCollapsed] = (0, react.useState)(false);\n\t\t\tconst hasActive = todos.some((item) => item.status === "in_progress");\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tif (hasActive) setCollapsed(false);\n\t\t\t}, [hasActive]);`;

const V2_BLOCK = `\t\t\t// ${MARK} ${MARK_V2} keep the task list open and follow the active set.\n\t\t\tconst [collapsed, setCollapsed] = (0, react.useState)(false);\n\t\t\tconst activeKey = todos.filter((item) => item.status === "in_progress").map((item) => item.content).join("\\u0000");\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tif (activeKey !== "") setCollapsed(false);\n\t\t\t}, [activeKey]);`;

const STATUS_SPAN_V1 = `\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\tstyle: {\n\t\t\t\t\t\t\t\t\tmarginLeft: "auto",`;
const STATUS_SPAN_V2 = `\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\t"aria-hidden": true,\n\t\t\t\t\t\t\t\tstyle: {\n\t\t\t\t\t\t\t\t\tmarginLeft: "auto",`;

const count = (haystack, needle) => haystack.split(needle).length - 1;

if (original.includes(MARK_V2)) {
  // Already v2. Assert the second edit survived any other tooling.
  if (count(original, STATUS_SPAN_V1) === 0 && original.includes('"aria-hidden": true,\n\t\t\t\t\t\t\t\tstyle: {\n\t\t\t\t\t\t\t\t\tmarginLeft: "auto",')) {
    console.log('skip     todo panel (already v2)');
    process.exit(0);
  }
  console.error('FAIL     todo panel carries the v2 marker but its status column or aria-hidden edit is missing');
  process.exit(1);
}

if (original.includes(MARK)) {
  const blockHits = count(original, V1_BLOCK);
  const spanHits = count(original, STATUS_SPAN_V1);
  if (blockHits !== 1 || spanHits !== 1) {
    console.error(`FAIL     v1 upgrade anchors matched ${blockHits} block / ${spanHits} span hit(s)`);
    process.exit(1);
  }
  const next = original.replace(V1_BLOCK, V2_BLOCK).replace(STATUS_SPAN_V1, STATUS_SPAN_V2);
  write(original, next, 'upgraded v1 -> v2');
  console.log('ok       todo panel upgraded (active-set dependency + aria-hidden)');
  process.exit(0);
}

/* ------------------------------------------------------------------ pristine */
const EDITS = [
  [
    'panel: expanded by default and re-expanded when the active set changes',
    `\t\tfunction TodoPanel({ todos, t }) {\n\t\t\tconst [collapsed, setCollapsed] = (0, react.useState)(true);\n\t\t\tif (todos.length === 0) return null;`,
    `\t\tfunction TodoPanel({ todos, t }) {\n${V2_BLOCK}\n\t\t\tif (todos.length === 0) return null;`,
  ],
  [
    'row: explicit status text (aria-hidden) and finished/active emphasis',
    `\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\tclassName: TodoPanel_module_css_default.content,\n\t\t\t\t\t\t\t\tchildren: item.content\n\t\t\t\t\t\t\t})]`,
    `\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\tclassName: TodoPanel_module_css_default.content,\n\t\t\t\t\t\t\t\tstyle: item.status === "completed" ? {\n\t\t\t\t\t\t\t\t\ttextDecoration: "line-through",\n\t\t\t\t\t\t\t\t\tcolor: "var(--dsw-alias-label-tertiary)"\n\t\t\t\t\t\t\t\t} : item.status === "in_progress" ? {\n\t\t\t\t\t\t\t\t\tcolor: "var(--dsw-alias-label-primary)",\n\t\t\t\t\t\t\t\t\tfontWeight: 500\n\t\t\t\t\t\t\t\t} : void 0,\n\t\t\t\t\t\t\t\tchildren: item.content\n\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\t\t"aria-hidden": true,\n\t\t\t\t\t\t\t\tstyle: {\n\t\t\t\t\t\t\t\t\tmarginLeft: "auto",\n\t\t\t\t\t\t\t\t\tflex: "none",\n\t\t\t\t\t\t\t\t\tfontSize: "11px",\n\t\t\t\t\t\t\t\t\tlineHeight: "16px",\n\t\t\t\t\t\t\t\t\tcolor: item.status === "in_progress" ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)"\n\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\tchildren: statusLabel(item.status, t)\n\t\t\t\t\t\t\t})]`,
  ],
];

let failed = 0;
for (const [label, find] of EDITS) {
  const hits = count(original, find);
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
write(original, next, 'applied todo panel v2');
console.log('ok       todo panel is now a live, expanded task board');
