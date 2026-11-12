#!/usr/bin/env node
/**
 * Frozen-build patch: per-workspace local notes.
 *
 * Adds a “编辑备注” item to the Workspace context menu. The note is stored in
 * the renderer's localStorage (`dsh-workspace-note:v1:<workspaceId>`) and is
 * shown under the Workspace title; it never travels to the host, so it is a
 * local annotation rather than Session state.
 *
 * Idempotent: the inserted code carries `/*dsh:workspace-notes*\/` and the
 * script exits early when that marker is already present.
 *
 * usage: node patch-workspace-notes.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:workspace-notes*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-workspace-notes.js <payloadRoot> [--dry]');
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
  console.log('skip     workspace notes (already applied)');
  process.exit(0);
}

const helper = `${MARK}
\t\tconst WORKSPACE_NOTE_PREFIX = "dsh-workspace-note:v1:";
\t\tconst workspaceNoteListeners = new Set();
\t\tfunction readWorkspaceNote(workspaceId) {
\t\t\tif (workspaceId === void 0) return "";
\t\t\ttry {
\t\t\t\treturn window.localStorage.getItem(WORKSPACE_NOTE_PREFIX + workspaceId) ?? "";
\t\t\t} catch (_error) {
\t\t\t\treturn "";
\t\t\t}
\t\t}
\t\tfunction writeWorkspaceNote(workspaceId, note) {
\t\t\tif (workspaceId === void 0) return;
\t\t\ttry {
\t\t\t\tconst key = WORKSPACE_NOTE_PREFIX + workspaceId;
\t\t\t\tif (note.trim() === "") window.localStorage.removeItem(key);
\t\t\t\telse window.localStorage.setItem(key, note);
\t\t\t} catch (_error) {
\t\t\t\t// Storage may be unavailable; the note simply does not persist.
\t\t\t}
\t\t\tfor (const listener of workspaceNoteListeners) {
\t\t\t\ttry {
\t\t\t\t\tlistener(workspaceId);
\t\t\t\t} catch (_error) {
\t\t\t\t\t// A broken listener must not break the others.
\t\t\t\t}
\t\t\t}
\t\t}
\t\tfunction useWorkspaceNote(workspaceId) {
\t\t\tconst [note, setNote] = (0, react.useState)(() => readWorkspaceNote(workspaceId));
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tsetNote(readWorkspaceNote(workspaceId));
\t\t\t\tconst listener = (changedId) => {
\t\t\t\t\tif (changedId === workspaceId) setNote(readWorkspaceNote(workspaceId));
\t\t\t\t};
\t\t\t\tworkspaceNoteListeners.add(listener);
\t\t\t\treturn () => {
\t\t\t\t\tworkspaceNoteListeners.delete(listener);
\t\t\t\t};
\t\t\t}, [workspaceId]);
\t\t\treturn note;
\t\t}
\t\tfunction ProjectRow({ group, containsCurrentDescendant = false, onToggle, onCreate, drag: offeredDrag, home, newShortcut, t, access, openWorkspaceMenu, useContextMenuTarget, useContextMenu }) {`;

const noteDialog = `\t\tfunction WorkspaceNoteDialog({ request, settleWorkspaceAction, t }) {
\t\t\tconst target = request !== null && request.action === "note" ? request : null;
\t\t\tconst [draft, setDraft] = (0, react.useState)("");
\t\t\tconst loadedFor = (0, react.useRef)(null);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (target === null) {
\t\t\t\t\tloadedFor.current = null;
\t\t\t\t\tsetDraft("");
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (loadedFor.current === target.workspaceId) return;
\t\t\t\tloadedFor.current = target.workspaceId;
\t\t\t\tsetDraft(readWorkspaceNote(target.workspaceId));
\t\t\t}, [target]);
\t\t\tconst close = () => {
\t\t\t\tsettleWorkspaceAction();
\t\t\t};
\t\t\tconst save = () => {
\t\t\t\tif (target === null) return;
\t\t\t\twriteWorkspaceNote(target.workspaceId, draft);
\t\t\t\tsettleWorkspaceAction();
\t\t\t};
\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
\t\t\t\topen: target !== null,
\t\t\t\tonClose: close,
\t\t\t\tcloseLabel: t("close"),
\t\t\t\ttitle: t("note.title"),
\t\t\t\tfooter: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
\t\t\t\t\t(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\tvariant: "outline",
\t\t\t\t\t\tonClick: close,
\t\t\t\t\t\tchildren: t("cancel")
\t\t\t\t\t}),
\t\t\t\t\t(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\tvariant: "primary",
\t\t\t\t\t\tonClick: save,
\t\t\t\t\t\tchildren: t("note.save")
\t\t\t\t\t})
\t\t\t\t] }),
\t\t\t\tchildren: [
\t\t\t\t\t(0, react_jsx_runtime.jsx)("textarea", {
\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.renameInput,
\t\t\t\t\t\tstyle: { height: "120px", resize: "vertical", padding: "10px 14px", lineHeight: "20px" },
\t\t\t\t\t\tvalue: draft,
\t\t\t\t\t\tplaceholder: t("note.placeholder"),
\t\t\t\t\t\t"data-modal-autofocus": true,
\t\t\t\t\t\tonChange: (e) => {
\t\t\t\t\t\t\tsetDraft(e.target.value);
\t\t\t\t\t\t}
\t\t\t\t\t}),
\t\t\t\t\t(0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.renameError,
\t\t\t\t\t\tstyle: { color: "var(--dsw-alias-label-tertiary)" },
\t\t\t\t\t\tchildren: t("note.hint")
\t\t\t\t\t})
\t\t\t\t]
\t\t\t});
\t\t}
\t\t/**
\t\t* The text one Workspace is labeled with. A Workspace still carrying the`;

const EDITS = [
  [
    'ProjectRow helper + note hook',
    `\t\tfunction ProjectRow({ group, containsCurrentDescendant = false, onToggle, onCreate, drag: offeredDrag, home, newShortcut, t, access, openWorkspaceMenu, useContextMenuTarget, useContextMenu }) {`,
    helper,
  ],
  [
    'read the row note',
    '\t\t\tconst row = group;',
    '\t\t\tconst row = group;\n\t\t\tconst note = useWorkspaceNote(row.workspaceId);',
  ],
  [
    'grow a row that has a note',
    '\t\t\t\tclassName: clsx(Rows_module_css_default.projectRow, menuOpen && Rows_module_css_default.menuOpen),',
    '\t\t\t\tclassName: clsx(Rows_module_css_default.projectRow, menuOpen && Rows_module_css_default.menuOpen),\n\t\t\t\tstyle: note === "" ? void 0 : { height: "52px" },',
  ],
  [
    'show the note under the title',
    `\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tclassName: Rows_module_css_default.projectText,
\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\tclassName: Rows_module_css_default.title,
\t\t\t\t\t\t\tchildren: label
\t\t\t\t\t\t})
\t\t\t\t\t}),`,
    `\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tclassName: Rows_module_css_default.projectText,
\t\t\t\t\t\ttitle: note === "" ? void 0 : note,
\t\t\t\t\t\tchildren: [
\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\tclassName: Rows_module_css_default.title,
\t\t\t\t\t\t\t\tchildren: label
\t\t\t\t\t\t\t}),
\t\t\t\t\t\t\tnote !== "" && (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\tclassName: Rows_module_css_default.meta,
\t\t\t\t\t\t\t\tchildren: note
\t\t\t\t\t\t\t})
\t\t\t\t\t\t]
\t\t\t\t\t}),`,
  ],
  [
    'workspace context menu item',
    '\t\t\t}), "workspace: delete menu action");',
    `\t\t\t}), "workspace: delete menu action");
\t\t\tctx.effect(() => ctx.contextMenus.register({
\t\t\t\tid: "workspace.note",
\t\t\t\ttarget: "workspace",
\t\t\t\torder: 120,
\t\t\t\tresolve: ({ workspaceId, displayTitle }) => [{
\t\t\t\t\tid: "note",
\t\t\t\t\tlabel: ctx.locale.bind(NS)("note.edit"),
\t\t\t\t\trun: () => {
\t\t\t\t\t\trequestWorkspaceAction(workspaceId, displayTitle, "note");
\t\t\t\t\t}
\t\t\t\t}]
\t\t\t}), "workspace: note menu action");`,
  ],
  [
    'allow local notes without a host permission',
    '\t\t\t\tif (workspace === void 0 || !ctx.remoteAccess.source("workspace", workspaceId, `workspace/${action}`).getSnapshot()) return;',
    '\t\t\t\tif (workspace === void 0) return;\n\t\t\t\tif (action !== "note" && !ctx.remoteAccess.source("workspace", workspaceId, `workspace/${action}`).getSnapshot()) return;',
  ],
  [
    'WorkspaceNoteDialog component',
    `\t\t/**
\t\t* The text one Workspace is labeled with. A Workspace still carrying the`,
    noteDialog,
  ],
  [
    'open the note dialog from WorkspaceBrowser',
    `\t\t\t\t\tworkspaceActionRequest !== null && (0, react_jsx_runtime.jsx)(WorkspaceDialogs, {
\t\t\t\t\t\trequest: workspaceActionRequest,
\t\t\t\t\t\tworkspaces,
\t\t\t\t\t\trenameWorkspace,
\t\t\t\t\t\tdeleteWorkspace,
\t\t\t\t\t\tsettleWorkspaceAction,
\t\t\t\t\t\tt
\t\t\t\t\t}, \`\${workspaceActionRequest.action}/\${workspaceActionRequest.workspaceId}\`)`,
    `\t\t\t\t\tworkspaceActionRequest !== null && workspaceActionRequest.action !== "note" && (0, react_jsx_runtime.jsx)(WorkspaceDialogs, {
\t\t\t\t\t\trequest: workspaceActionRequest,
\t\t\t\t\t\tworkspaces,
\t\t\t\t\t\trenameWorkspace,
\t\t\t\t\t\tdeleteWorkspace,
\t\t\t\t\t\tsettleWorkspaceAction,
\t\t\t\t\t\tt
\t\t\t\t\t}, \`\${workspaceActionRequest.action}/\${workspaceActionRequest.workspaceId}\`),
\t\t\t\t\tworkspaceActionRequest !== null && workspaceActionRequest.action === "note" && (0, react_jsx_runtime.jsx)(WorkspaceNoteDialog, {
\t\t\t\t\t\trequest: workspaceActionRequest,
\t\t\t\t\t\tsettleWorkspaceAction,
\t\t\t\t\t\tt
\t\t\t\t\t}, \`note/\${workspaceActionRequest.workspaceId}\`)`,
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

// Dictionary entries. Add an English fallback to every shipped dictionary
// first (a missing key would render the raw key in the menu), then replace the
// Chinese fallback with the Chinese strings so that dictionary does not end up
// with duplicate keys.
const otherRe = /^(\s*)"delete\.workspace": "[^"]*",$/gm;
let otherHits = 0;
next = next.replace(otherRe, (line, indent) => {
  otherHits += 1;
  return `${line}
${indent}"note.edit": "Edit note",
${indent}"note.title": "Edit workspace note",
${indent}"note.placeholder": "Write a note that stays on this computer…",
${indent}"note.hint": "Notes are stored in this browser only and do not sync to other devices.",
${indent}"note.save": "Save note",`;
});
if (otherHits !== 8) {
  console.error(`FAIL     note dictionary fallback: expected 8 locales, matched ${otherHits}`);
  process.exit(1);
}

const zhFind = `\t\t\t"delete.workspace": "删除工作区",
\t\t\t"note.edit": "Edit note",
\t\t\t"note.title": "Edit workspace note",
\t\t\t"note.placeholder": "Write a note that stays on this computer…",
\t\t\t"note.hint": "Notes are stored in this browser only and do not sync to other devices.",
\t\t\t"note.save": "Save note",`;
const zhHits = next.split(zhFind).length - 1;
if (zhHits !== 1) {
  console.error(`FAIL     zh note dictionary: anchor matched ${zhHits} time(s)`);
  process.exit(1);
}
next = next.replace(zhFind, `\t\t\t"delete.workspace": "删除工作区",
\t\t\t"note.edit": "编辑备注",
\t\t\t"note.title": "编辑项目备注",
\t\t\t"note.placeholder": "写一段只保存在本机的备注…",
\t\t\t"note.hint": "备注只保存在本机浏览器存储中，不会同步到其他设备。",
\t\t\t"note.save": "保存备注",`);

if (dry) {
  console.log(`dry      would write ${original.length} -> ${next.length} bytes`);
} else {
  fs.writeFileSync(file, next, 'utf8');
  console.log(`write    ${original.length} -> ${next.length} bytes`);
}
console.log('ok       workspace notes inserted');
