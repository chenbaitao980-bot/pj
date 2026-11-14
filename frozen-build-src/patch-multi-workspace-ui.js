#!/usr/bin/env node
/**
 * Frozen-build patch: the workspace picker can select several workspaces at
 * once.
 *
 * The picker menu gains a "多选工作区…" entry that opens the dialog owned by
 * `@local/dsh-multi-workspace`'s client half. The dialog creates the Session in
 * the first checked workspace and attaches the remaining checked workspaces to
 * it through the `/roots` Host command, so the Session model keeps a single
 * `cwd` while the model still sees every selected root.
 *
 * This script also adds `openWorkspaceWithRoots()` to the UiWorkspace service:
 * it creates/reuses a blank Session in the chosen workspace, executes
 * `/roots add <path>` for each extra root through the commands Remote, and then
 * reveals the Session in the main view.
 *
 * Idempotent: the inserted code carries markers and is skipped when present.
 *
 * usage: node patch-multi-workspace-ui.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:multi-workspace-ui*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-multi-workspace-ui.js <payloadRoot> [--dry]');
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

/** The pre-0.2.9 invocation that threw "cannot get property remote.commands without inject". */
const OLD_INVOKE = `\t\t\t\tconst commands = this.ctx.get("remote")?.commands;
\t\t\t\tif (commands !== void 0 && Array.isArray(extraPaths)) for (const root of extraPaths) {
\t\t\t\t\tif (typeof root !== "string" || root === "") continue;
\t\t\t\t\ttry {
\t\t\t\t\t\tawait commands.execute(sessionId, \`/roots add \${root}\`, []);
\t\t\t\t\t} catch (error) {
\t\t\t\t\t\tconsole.warn("multi-workspace: /roots add failed:", error);
\t\t\t\t\t}
\t\t\t\t}`;

/** Awaited form: reports roots the Host refused instead of closing over them. */
const AWAIT_NEXT = `\t\t\t\t// Both the service and the commands namespace must be injected for the
\t\t\t\t// accessor to resolve. The adds are awaited so a refused root reaches the
\t\t\t\t// picker instead of a Session that silently lacks it.
\t\t\t\t/*dsh:multi-workspace-roots-await*/
\t\t\t\tconst roots = Array.isArray(extraPaths) ? extraPaths.filter((root) => typeof root === "string" && root !== "") : [];
\t\t\t\tconst failedRoots = [];
\t\t\t\tif (roots.length > 0) {
\t\t\t\t\tawait new Promise((resolve) => {
\t\t\t\t\t\tthis.ctx.inject(["remote", "remote.commands"], (scope) => {
\t\t\t\t\t\t\tconst commands = scope.remote.commands;
\t\t\t\t\t\t\tPromise.all(roots.map((root) => commands.execute(sessionId, \`/roots add \${root}\`, []).then((result) => {
\t\t\t\t\t\t\t\tif (result === void 0 || result.ok) return;
\t\t\t\t\t\t\t\tthrow new Error(result.error?.message ?? result.error?.code ?? "roots add failed");
\t\t\t\t\t\t\t}).catch((error) => {
\t\t\t\t\t\t\t\tconsole.warn("multi-workspace: /roots add failed:", error);
\t\t\t\t\t\t\t\tfailedRoots.push(root);
\t\t\t\t\t\t\t}))).then(() => resolve(), () => resolve());
\t\t\t\t\t\t});
\t\t\t\t\t});
\t\t\t\t}
\t\t\t\tthis.replaceMain(sessionId, navigation, "reveal", beforeOpen);
\t\t\t\treturn { sessionId, failedRoots };
\t\t\t}`;

/** The inject-scoped invocation used from 0.2.9 on. */
const AWAIT_CURRENT = `\t\t\t\t// The workspace bundle declares \`remote\` and \`remote.directoryPicker\`
\t\t\t\t// but not the commands namespace, so a bare ctx.get("remote").commands
\t\t\t\t// throws "cannot get property remote.commands without inject".
\t\t\t\tthis.ctx.inject(["remote", "remote.commands"], (scope) => {
\t\t\t\t\tconst commands = scope.remote.commands;
\t\t\t\t\tif (!Array.isArray(extraPaths)) return;
\t\t\t\t\tfor (const root of extraPaths) {
\t\t\t\t\t\tif (typeof root !== "string" || root === "") continue;
\t\t\t\t\t\tcommands.execute(sessionId, \`/roots add \${root}\`, []).catch((error) => {
\t\t\t\t\t\t\tconsole.warn("multi-workspace: /roots add failed:", error);
\t\t\t\t\t\t});
\t\t\t\t\t}
\t\t\t\t});
\t\t\t\tthis.replaceMain(sessionId, navigation, "reveal", beforeOpen);
\t\t\t}`;
const NEW_INVOKE = `\t\t\t\t// The workspace bundle declares \`remote\` and \`remote.directoryPicker\`
\t\t\t\t// but not the commands namespace; both the service and its namespace
\t\t\t\t// must be injected for the accessor to resolve.
\t\t\t\tthis.ctx.inject(["remote", "remote.commands"], (scope) => {
\t\t\t\t\tconst commands = scope.remote.commands;
\t\t\t\t\tif (!Array.isArray(extraPaths)) return;
\t\t\t\t\tfor (const root of extraPaths) {
\t\t\t\t\t\tif (typeof root !== "string" || root === "") continue;
\t\t\t\t\t\tcommands.execute(sessionId, \`/roots add \${root}\`, []).catch((error) => {
\t\t\t\t\t\t\tconsole.warn("multi-workspace: /roots add failed:", error);
\t\t\t\t\t\t});
\t\t\t\t\t}
\t\t\t\t});`;

if (original.includes(MARK)) {
  if (original.includes('dsh:multi-workspace-roots-await')) {
    console.log('skip     multi-workspace picker (roots add already awaited)');
  } else if (original.includes(AWAIT_CURRENT.split('\n').slice(0, 3).join('\n'))) {
    // Fire-and-forget form shipped before the awaited migration.
    if (dry) {
      console.log(`dry      would migrate the roots add to an awaited form (${original.length} bytes)`);
    } else {
      const migrated = original.replace(AWAIT_CURRENT, AWAIT_NEXT);
      if (migrated === original) {
        console.error('FAIL     awaited migration anchor did not match');
        process.exit(1);
      }
      fs.writeFileSync(file, migrated, 'utf8');
      console.log('write    migrated the roots add to an awaited form');
    }
  } else if (original.includes(OLD_INVOKE)) {
    if (dry) {
      console.log(`dry      would migrate the roots invocation (${original.length} bytes)`);
    } else {
      fs.writeFileSync(file, original.replace(OLD_INVOKE, NEW_INVOKE), 'utf8');
      console.log('write    migrated the roots invocation to an inject scope');
    }
  } else if (original.includes('this.ctx.inject(["remote.commands"], (scope) => {')) {
    if (dry) {
      console.log('dry      would add the remote service to the inject scope');
    } else {
      fs.writeFileSync(
        file,
        original.replace(
          'this.ctx.inject(["remote.commands"], (scope) => {',
          'this.ctx.inject(["remote", "remote.commands"], (scope) => {',
        ),
        'utf8',
      );
      console.log('write    added remote to the inject scope');
    }
  } else {
    console.log('skip     multi-workspace picker (already applied)');
  }
  process.exit(0);
}

/** [label, find, replace] — every find must match exactly once. */
const EDITS = [
  [
    'constants: declare the multi-select entry id',
    'const NO_WORKSPACE = "::no-workspace";',
    `const NO_WORKSPACE = "::no-workspace";\n\t\tconst MULTI_WORKSPACE = "::multi-workspace"; ${MARK}`,
  ],
  [
    'flow: accept the new prop',
    'function WorkspacePickFlow({ t, open, anchorRef, useWorkspaces, createWorkspace, createWithoutWorkspace, useDirectoryFlow, renderDirectoryFlow, onPick, onClose, addOnly = false, onBusyChange, side = "bottom", selectedId }) {',
    'function WorkspacePickFlow({ t, open, anchorRef, useWorkspaces, createWorkspace, createWithoutWorkspace, openMultiWorkspace, useDirectoryFlow, renderDirectoryFlow, onPick, onClose, addOnly = false, onBusyChange, side = "bottom", selectedId }) {',
  ],
  [
    'flow: add the menu entry',
    `\t\t\tif (createWithoutWorkspace !== void 0) items.push({
\t\t\t\tid: NO_WORKSPACE,
\t\t\t\tlabel: "\\u4e0d\\u4f7f\\u7528\\u5de5\\u4f5c\\u533a",
\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 }),
\t\t\t\tdisabled: flowBusy
\t\t\t});`,
    `\t\t\tif (createWithoutWorkspace !== void 0) items.push({
\t\t\t\tid: NO_WORKSPACE,
\t\t\t\tlabel: "\\u4e0d\\u4f7f\\u7528\\u5de5\\u4f5c\\u533a",
\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 }),
\t\t\t\tdisabled: flowBusy
\t\t\t});
\t\t\tif (openMultiWorkspace !== void 0 && !addOnly && listed.length > 1) items.push({
\t\t\t\tid: MULTI_WORKSPACE,
\t\t\t\tlabel: "\\u591a\\u9009\\u5de5\\u4f5c\\u533a\\u2026",
\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutlineRegular, { size: 16 }),
\t\t\t\tdisabled: flowBusy
\t\t\t});`,
  ],
  [
    'flow: route a pick of the new entry',
    `\t\t\t\tif (id === NO_WORKSPACE && createWithoutWorkspace !== void 0) {
\t\t\t\t\tonClose();
\t\t\t\t\tcreateWithoutWorkspace().catch((reason) => {
\t\t\t\t\t\tsetModalError(reason instanceof Error ? reason.message : String(reason));
\t\t\t\t\t\tsetErrorOpen(true);
\t\t\t\t\t});
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tonPick(id);`,
    `\t\t\t\tif (id === NO_WORKSPACE && createWithoutWorkspace !== void 0) {
\t\t\t\t\tonClose();
\t\t\t\t\tcreateWithoutWorkspace().catch((reason) => {
\t\t\t\t\t\tsetModalError(reason instanceof Error ? reason.message : String(reason));
\t\t\t\t\t\tsetErrorOpen(true);
\t\t\t\t\t});
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (id === MULTI_WORKSPACE && openMultiWorkspace !== void 0) {
\t\t\t\t\tonClose();
\t\t\t\t\topenMultiWorkspace();
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tonPick(id);`,
  ],
  [
    'picker wrapper: receive and forward the new prop',
    `\t\tfunction WorkspacePicker({ open, anchorRef, useWorkspaces, selectedId, onPick, onClose, createWorkspace, createWithoutWorkspace, useDirectoryFlow, renderSlot, t }) {
\t\t\treturn (0, react_jsx_runtime.jsx)(WorkspacePickFlow, {
\t\t\t\tt,
\t\t\t\topen,
\t\t\t\tanchorRef,
\t\t\t\tuseWorkspaces,
\t\t\t\tcreateWorkspace,
\t\t\t\tcreateWithoutWorkspace,
\t\t\t\tuseDirectoryFlow,`,
    `\t\tfunction WorkspacePicker({ open, anchorRef, useWorkspaces, selectedId, onPick, onClose, createWorkspace, createWithoutWorkspace, openMultiWorkspace, useDirectoryFlow, renderSlot, t }) {
\t\t\treturn (0, react_jsx_runtime.jsx)(WorkspacePickFlow, {
\t\t\t\tt,
\t\t\t\topen,
\t\t\t\tanchorRef,
\t\t\t\tuseWorkspaces,
\t\t\t\tcreateWorkspace,
\t\t\t\tcreateWithoutWorkspace,
\t\t\t\topenMultiWorkspace,
\t\t\t\tuseDirectoryFlow,`,
  ],
  [
    'inject: expose the dialog opener to the picker',
    '\t\t\t\tcreateWithoutWorkspace: async () => { /*dsh:no-workspace-picker*/',
    '\t\t\t\topenMultiWorkspace: () => ctx.get("multiWorkspaceUi")?.open(),\n\t\t\t\tcreateWithoutWorkspace: async () => { /*dsh:no-workspace-picker*/',
  ],
  [
    'service: create a Session and attach extra roots',
    `\t\t\tasync openWorkspaceSession(workspaceId, beforeOpen, reuse) {
\t\t\t\tconst navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal]);
\t\t\t\tlet sessionId;
\t\t\t\ttry {
\t\t\t\t\tsessionId = await this.connectBlank(workspaceId, reuse);
\t\t\t\t} catch (error) {
\t\t\t\t\tif (!navigation.aborted) this.notify({
\t\t\t\t\t\tkind: "createFailed",
\t\t\t\t\t\tmessage: creationFailureMessage(error)
\t\t\t\t\t});
\t\t\t\t\tthrow error;
\t\t\t\t}
\t\t\t\tif (navigation.aborted) return;
\t\t\t\tthis.replaceMain(sessionId, navigation, "reveal", beforeOpen);
\t\t\t}`,
    `\t\t\tasync openWorkspaceSession(workspaceId, beforeOpen, reuse) {
\t\t\t\tconst navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal]);
\t\t\t\tlet sessionId;
\t\t\t\ttry {
\t\t\t\t\tsessionId = await this.connectBlank(workspaceId, reuse);
\t\t\t\t} catch (error) {
\t\t\t\t\tif (!navigation.aborted) this.notify({
\t\t\t\t\t\tkind: "createFailed",
\t\t\t\t\t\tmessage: creationFailureMessage(error)
\t\t\t\t\t});
\t\t\t\t\tthrow error;
\t\t\t\t}
\t\t\t\tif (navigation.aborted) return;
\t\t\t\tthis.replaceMain(sessionId, navigation, "reveal", beforeOpen);
\t\t\t}
\t\t\t/**
\t\t\t* Open a blank Session in one Workspace and attach the other selected
\t\t\t* Directories as extra roots through the multi-workspace command.
\t\t\t* @param workspaceId - Workspace that owns the Session.
\t\t\t* @param extraPaths - absolute paths of the additional roots.
\t\t\t* @param beforeOpen - callback run after the Session is connected.
\t\t\t*/
\t\t\tasync openWorkspaceWithRoots(workspaceId, extraPaths, beforeOpen) {
\t\t\t\tconst navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal]);
\t\t\t\tlet sessionId;
\t\t\t\ttry {
\t\t\t\t\tsessionId = await this.connectBlank(workspaceId, {});
\t\t\t\t} catch (error) {
\t\t\t\t\tif (!navigation.aborted) this.notify({
\t\t\t\t\t\tkind: "createFailed",
\t\t\t\t\t\tmessage: creationFailureMessage(error)
\t\t\t\t\t});
\t\t\t\t\tthrow error;
\t\t\t\t}
\t\t\t\tif (navigation.aborted) return;
\t\t\t\t// Both the service and its commands namespace must be injected for the
\t\t\t\t// accessor to resolve. The adds are awaited so a refused root reaches the
\t\t\t\t// picker instead of a Session that silently lacks it.
\t\t\t\t/*dsh:multi-workspace-roots-await*/
\t\t\t\tconst roots = Array.isArray(extraPaths) ? extraPaths.filter((root) => typeof root === "string" && root !== "") : [];
\t\t\t\tconst failedRoots = [];
\t\t\t\tif (roots.length > 0) {
\t\t\t\t\tawait new Promise((resolve) => {
\t\t\t\t\t\tthis.ctx.inject(["remote", "remote.commands"], (scope) => {
\t\t\t\t\t\t\tconst commands = scope.remote.commands;
\t\t\t\t\t\t\tPromise.all(roots.map((root) => commands.execute(sessionId, \`/roots add \${root}\`, []).then((result) => {
\t\t\t\t\t\t\t\tif (result === void 0 || result.ok) return;
\t\t\t\t\t\t\t\tthrow new Error(result.error?.message ?? result.error?.code ?? "roots add failed");
\t\t\t\t\t\t\t}).catch((error) => {
\t\t\t\t\t\t\t\tconsole.warn("multi-workspace: /roots add failed:", error);
\t\t\t\t\t\t\t\tfailedRoots.push(root);
\t\t\t\t\t\t\t}))).then(() => resolve(), () => resolve());
\t\t\t\t\t\t});
\t\t\t\t\t});
\t\t\t\t}
\t\t\t\tthis.replaceMain(sessionId, navigation, "reveal", beforeOpen);
\t\t\t\treturn { sessionId, failedRoots };
\t\t\t}`,
  ],
];

let failed = 0;
for (const [label, find, replace] of EDITS) {
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
console.log('ok       multi-workspace picker inserted');
