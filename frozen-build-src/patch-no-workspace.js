#!/usr/bin/env node
/**
 * Frozen-build patch: allow creating and using a Session that belongs to no workspace.
 *
 *  1. dsh-client-ui-conversation -- the hero chip label falls back to the cwd label
 *     even after the workspace list is ready, so a cwd-only Session is no longer
 *     treated as "no workspace selected" (the composer `inert` gate reads
 *     `chipTitle`).
 *  2. dsh-client-ui-workspace -- the empty-state picker gains a "no workspace"
 *     entry that creates a Session through `sessions.create({})` (the Host
 *     resolves `defaultCwd`) and opens it.
 *
 * Each edit uses a whitespace-tolerant regex and must match exactly once. A file
 * that already carries its marker is reported as applied and skipped, so the
 * script is safe to re-run.
 *
 * usage: node patch-no-workspace.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK_CONVERSATION = '/*dsh:no-workspace-conversation*/';
const MARK_PICKER = '/*dsh:no-workspace-picker*/';

const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-no-workspace.js <payloadRoot> [--dry]');
  process.exit(2);
}

const PKG = path.join(payloadRoot, 'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai');
const CONVERSATION = path.join(PKG, 'dsh-client-ui-conversation', 'lib', 'client.js');
const WORKSPACE = path.join(PKG, 'dsh-client-ui-workspace', 'lib', 'client.js');

/** [label, file, find, replace] */
const EDITS = [
  [
    'conversation: cwd label survives a ready workspace list',
    CONVERSATION,
    /workspaces\.phase === "ready" \|\| cwd === void 0 \|\| cwd === ""/,
    `cwd === void 0 || cwd === "" ${MARK_CONVERSATION}`,
  ],
  [
    'picker: declare the no-workspace entry id',
    WORKSPACE,
    /const ADD_WORKSPACE = "::add-workspace";/,
    'const ADD_WORKSPACE = "::add-workspace";\n\t\tconst NO_WORKSPACE = "::no-workspace";',
  ],
  [
    'picker: expose createWithoutWorkspace to the flow',
    WORKSPACE,
    /(const pickerInjected = \(\) => \(\{\s*\n\s*createWorkspace: \(input\) => workspaces\.create\(input\),)/,
    `$1\n\t\t\t\tcreateWithoutWorkspace: async () => { ${MARK_PICKER}
\t\t\t\t\tconst created = await sessions.create({});
\t\t\t\t\tconst id = typeof created === "string" ? created : created && created.sessionId;
\t\t\t\t\tif (id === void 0) throw new Error("session create returned no id");
\t\t\t\t\tuiWorkspace.openSession(id);
\t\t\t\t\treturn id;
\t\t\t\t},`,
  ],
  [
    'flow: accept the new prop',
    WORKSPACE,
    /function WorkspacePickFlow\(\{ t, open, anchorRef, useWorkspaces, createWorkspace, useDirectoryFlow,/,
    'function WorkspacePickFlow({ t, open, anchorRef, useWorkspaces, createWorkspace, createWithoutWorkspace, useDirectoryFlow,',
  ],
  [
    'flow: append the "no workspace" menu entry',
    WORKSPACE,
    /(\n\t\t\tconst menuIsEmpty = items\.length === 0;)/,
    `
\t\t\tif (createWithoutWorkspace !== void 0) items.push({
\t\t\t\tid: NO_WORKSPACE,
\t\t\t\tlabel: "\\u4e0d\\u4f7f\\u7528\\u5de5\\u4f5c\\u533a",
\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 }),
\t\t\t\tdisabled: flowBusy
\t\t\t});$1`,
  ],
  [
    'flow: route a pick of the new entry',
    WORKSPACE,
    /const handleSelect = \(id\) => \{\n\t\t\t\tif \(id === ADD_WORKSPACE\) \{\n\t\t\t\t\topenDirectoryFlow\(\);\n\t\t\t\t\treturn;\n\t\t\t\t\}/,
    `const handleSelect = (id) => {
\t\t\t\tif (id === ADD_WORKSPACE) {
\t\t\t\t\topenDirectoryFlow();
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (id === NO_WORKSPACE && createWithoutWorkspace !== void 0) {
\t\t\t\t\tonClose();
\t\t\t\t\tcreateWithoutWorkspace().catch((reason) => {
\t\t\t\t\t\tsetModalError(reason instanceof Error ? reason.message : String(reason));
\t\t\t\t\t\tsetErrorOpen(true);
\t\t\t\t\t});
\t\t\t\t\treturn;
\t\t\t\t}`,
  ],
  [
    'picker wrapper: receive the new prop',
    WORKSPACE,
    /function WorkspacePicker\(\{ open, anchorRef, useWorkspaces, selectedId, onPick, onClose, createWorkspace, useDirectoryFlow, renderSlot, t \}\)/,
    'function WorkspacePicker({ open, anchorRef, useWorkspaces, selectedId, onPick, onClose, createWorkspace, createWithoutWorkspace, useDirectoryFlow, renderSlot, t })',
  ],
  [
    'picker wrapper: forward the new prop',
    WORKSPACE,
    /(\n\t\t\t\tuseWorkspaces,\n\t\t\t\tcreateWorkspace,)(\n\t\t\t\tuseDirectoryFlow,)/,
    '$1\n\t\t\t\tcreateWithoutWorkspace,$2',
  ],
];

const MARKERS = new Map([
  [CONVERSATION, MARK_CONVERSATION],
  [WORKSPACE, MARK_PICKER],
]);

let failed = 0;
let changed = 0;
const texts = new Map();
const originals = new Map();

for (const [label, file, find, replace] of EDITS) {
  if (!texts.has(file)) {
    if (!fs.existsSync(file)) {
      console.error(`MISSING  ${file}`);
      failed += 1;
      texts.set(file, null);
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    texts.set(file, source);
    originals.set(file, source);
  }
  const text = texts.get(file);
  if (text === null) continue;

  const marker = MARKERS.get(file);
  if (marker && originals.get(file).includes(marker)) {
    console.log(`skip     ${label} (already applied)`);
    continue;
  }

  const matches = [...text.matchAll(new RegExp(find.source, 'g'))];
  if (matches.length !== 1) {
    console.error(`FAIL     ${label} -- anchor matched ${matches.length} time(s)`);
    failed += 1;
    continue;
  }

  const next = text.replace(find, replace);
  if (next === text) {
    console.error(`FAIL     ${label} -- replacement produced no change`);
    failed += 1;
    continue;
  }
  texts.set(file, next);
  changed += 1;
  console.log(`ok       ${label}`);
}

for (const [file, text] of texts) {
  if (text === null) continue;
  const original = fs.readFileSync(file, 'utf8');
  if (text === original) continue;
  const pkg = path.basename(path.dirname(path.dirname(file)));
  if (dry) {
    console.log(`dry      ${pkg}: would write ${original.length} -> ${text.length} bytes`);
  } else {
    fs.writeFileSync(file, text, 'utf8');
    console.log(`write    ${pkg}: ${original.length} -> ${text.length} bytes`);
  }
}

console.log(`\n${changed} edit(s) applied, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
