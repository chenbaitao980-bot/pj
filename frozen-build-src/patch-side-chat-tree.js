#!/usr/bin/env node
/**
 * Frozen-build patch: render side chats as a tree under their main Session.
 *
 * The side-chat Client names each fork `⧉ <parent-session-id> · <name>`.
 * This patch (1) removes the old "hide side chats" predicate, (2) nests each
 * side row directly after its parent inside a workspace group, (3) indents
 * the row and suppresses completion/pending status text, and (4) preserves
 * the title marker when the user renames a side chat.
 *
 * Idempotent: the inserted block carries `dsh:side-chat-tree` and is skipped
 * when present. The old `dsh:side-chat-hidden` block is removed when found.
 *
 * usage: node patch-side-chat-tree.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:side-chat-tree*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-side-chat-tree.js <payloadRoot> [--dry]');
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

let source = fs.readFileSync(file, 'utf8');

const SEARCH_TITLE_OLD = '\t\t\t\t\t\ttitle: sessionTitle(summary),\n';
const SEARCH_TITLE_NEW = '\t\t\t\t\t\ttitle: sessionTitle(summary).replace(/^⧉ [^ ]+ · /u, ""),\n';

if (source.includes(MARK)) {
  if (!source.includes(SEARCH_TITLE_OLD)) {
    console.log('skip     side-chat tree (already applied)');
    process.exit(0);
  }
  const upgraded = replaceOnce(source, 'search result title', SEARCH_TITLE_OLD, SEARCH_TITLE_NEW);
  if (!dry) fs.writeFileSync(file, upgraded);
  console.log(`${dry ? 'dry     ' : 'upgrade '}search result title strips the side-chat marker`);
  process.exit(0);
}

function replaceOnce(current, label, needle, replacement) {
  const hits = current.split(needle).length - 1;
  if (hits !== 1) {
    throw new Error(`${label} anchor matched ${hits} time(s)`);
  }
  return current.replace(needle, replacement);
}

// 1. Remove the old predicate that hid side chats from the left list.
const HIDE_RE = /\t\t\t\/\/ \/\*dsh:side-chat-hidden\*\/[^\n]*\n\t\t\tif \(globalThis\.__DSH_SIDE_CHAT__\?\.isSideSession\?\.\(session\.id\) === true\) return false;\n/u;
source = source.replace(HIDE_RE, '');

// 2. Insert the nesting helpers after sectionMembers().
const SECTION_END =
  '\t\t\treturn [\n' +
  '\t\t\t\t...placeholders,\n' +
  '\t\t\t\t...leading,\n' +
  '\t\t\t\t...rest\n' +
  '\t\t\t];\n' +
  '\t\t}\n';

const HELPERS =
  '\n' +
  '\t\t// ' + MARK + ' A side chat is titled `⧉ <parent-id> · <name>` by the\n' +
  '\t\t// side-chat Client. Keep the row next to its parent and render it as a child.\n' +
  '\t\tfunction sideParentIdOf(session) {\n' +
  '\t\t\tconst match = /^⧉ ([^ ]+) · /u.exec(sessionTitle(session));\n' +
  '\t\t\treturn match === null ? void 0 : match[1];\n' +
  '\t\t}\n' +
  '\t\tfunction nestSideSessions(members) {\n' +
  '\t\t\tconst byId = new Map(members.map((session) => [session.id, session]));\n' +
  '\t\t\tconst children = new Map();\n' +
  '\t\t\tconst roots = [];\n' +
  '\t\t\tfor (const member of members) {\n' +
  '\t\t\t\tconst parentId = sideParentIdOf(member);\n' +
  '\t\t\t\tif (parentId === void 0 || parentId === member.id || !byId.has(parentId)) {\n' +
  '\t\t\t\t\troots.push(member);\n' +
  '\t\t\t\t\tcontinue;\n' +
  '\t\t\t\t}\n' +
  '\t\t\t\tconst bucket = children.get(parentId);\n' +
  '\t\t\t\tif (bucket === void 0) children.set(parentId, [member]);\n' +
  '\t\t\t\telse bucket.push(member);\n' +
  '\t\t\t}\n' +
  '\t\t\tconst ordered = [];\n' +
  '\t\t\tconst seen = new Set();\n' +
  '\t\t\tconst visit = (member) => {\n' +
  '\t\t\t\tif (seen.has(member.id)) return;\n' +
  '\t\t\t\tseen.add(member.id);\n' +
  '\t\t\t\tordered.push(member);\n' +
  '\t\t\t\tfor (const child of children.get(member.id) ?? []) visit(child);\n' +
  '\t\t\t};\n' +
  '\t\t\tfor (const root of roots) visit(root);\n' +
  '\t\t\tfor (const member of members) visit(member);\n' +
  '\t\t\treturn ordered;\n' +
  '\t\t}\n';

source = replaceOnce(source, 'sectionMembers end', SECTION_END, SECTION_END + HELPERS);

// 3. sessionNode: parse the marker, strip it from the displayed title.
const NODE_HEAD =
  '\t\tfunction sessionNode(s, list, statuses, pinned, archived) {\n' +
  '\t\t\tconst status = statuses.get(s.id);\n' +
  '\t\t\tconst pendingInteraction = visiblePendingKind(status?.pendingInteraction?.kind);\n' +
  '\t\t\treturn {\n' +
  '\t\t\t\tid: s.id,\n' +
  '\t\t\t\ttitle: sessionTitle(s),\n';

const NODE_NEW =
  '\t\tfunction sessionNode(s, list, statuses, pinned, archived) {\n' +
  '\t\t\tconst status = statuses.get(s.id);\n' +
  '\t\t\tconst pendingInteraction = visiblePendingKind(status?.pendingInteraction?.kind);\n' +
  '\t\t\tconst rawTitle = sessionTitle(s);\n' +
  '\t\t\tconst sideMatch = /^⧉ ([^ ]+) · /u.exec(rawTitle);\n' +
  '\t\t\treturn {\n' +
  '\t\t\t\tid: s.id,\n' +
  '\t\t\t\ttitle: sideMatch === null ? rawTitle : rawTitle.slice(sideMatch[0].length),\n' +
  '\t\t\t\t...sideMatch === null ? {} : { sideParentId: sideMatch[1] },\n';

source = replaceOnce(source, 'sessionNode head', NODE_HEAD, NODE_NEW);

// 4. Workspace groups: nest side rows under their parent.
const GROUPS_LINE =
  '\t\t\t\t\tsessions: expanded ? sectionMembers(g.sessions, pinned, archived).map((session) => sessionNode(session, list, statuses, pinned, archived)) : []';
const GROUPS_NEW =
  '\t\t\t\t\tsessions: expanded ? nestSideSessions(sectionMembers(g.sessions, pinned, archived)).map((session) => sessionNode(session, list, statuses, pinned, archived)) : []';
source = replaceOnce(source, 'deriveGroups sessions', GROUPS_LINE, GROUPS_NEW);

// 5. The flat "In one list" view uses the same nesting order.
const FLAT_HEAD =
  '\t\t\treturn sectionMembers(sessionIds.flatMap((id) => {';
const FLAT_HEAD_NEW =
  '\t\t\tconst orderedMembers = sectionMembers(sessionIds.flatMap((id) => {';
source = replaceOnce(source, 'deriveFlat head', FLAT_HEAD, FLAT_HEAD_NEW);

const FLAT_TAIL =
  '\t\t\t}), pinned, archived).map((session) => sessionNode(session, list, statuses, pinned, archived));';
const FLAT_TAIL_NEW =
  '\t\t\t}), pinned, archived);\n' +
  '\t\t\treturn nestSideSessions(orderedMembers).map((session) => sessionNode(session, list, statuses, pinned, archived));';
source = replaceOnce(source, 'deriveFlat tail', FLAT_TAIL, FLAT_TAIL_NEW);

// 6. SessionNodeItem: indentation, child glyph, and no completion/pending text.
const ITEM_HEAD =
  '\t\t\tconst selected = node.id === currentId;\n' +
  '\t\t\tconst statuses = sessionStatuses(node, t);\n' +
  '\t\t\tconst primaryStatus = statuses[0];\n' +
  '\t\t\tconst showStatus = primaryStatus.state !== "idle";\n';
const ITEM_HEAD_NEW =
  '\t\t\tconst selected = node.id === currentId;\n' +
  '\t\t\tconst sideChat = node.sideParentId !== void 0;\n' +
  '\t\t\tconst statuses = sessionStatuses(node, t);\n' +
  '\t\t\tconst primaryStatus = statuses[0];\n' +
  '\t\t\tconst showStatus = primaryStatus.state !== "idle" && !sideChat;\n';
source = replaceOnce(source, 'SessionNodeItem head', ITEM_HEAD, ITEM_HEAD_NEW);

const ARIA =
  '\t\t\t\t\t"aria-selected": selected,\n';
const ARIA_NEW =
  '\t\t\t\t\t"aria-selected": selected,\n' +
  '\t\t\t\t\tstyle: sideChat ? {\n' +
  '\t\t\t\t\t\tpaddingInlineStart: "calc(var(--dsh-sidebar-row-padding) - var(--dsh-sidebar-paint-inset) + var(--dsh-workspace-indent, 0px) + 18px)"\n' +
  '\t\t\t\t\t} : void 0,\n';
source = replaceOnce(source, 'SessionNodeItem row style', ARIA, ARIA_NEW);

const TITLE_CHILD =
  '\t\t\t\t\t\t\tchildren: title\n' +
  '\t\t\t\t\t\t}),\n' +
  '\t\t\t\t\t\t!row.blank && (0, react_jsx_runtime.jsxs)("span", {\n';
const TITLE_CHILD_NEW =
  '\t\t\t\t\t\t\tchildren: sideChat ? "↳ " + title : title\n' +
  '\t\t\t\t\t\t}),\n' +
  '\t\t\t\t\t\t!row.blank && (0, react_jsx_runtime.jsxs)("span", {\n';
source = replaceOnce(source, 'SessionNodeItem title', TITLE_CHILD, TITLE_CHILD_NEW);

const TRAILING =
  '\t\t\t\t\t\t\t\t\tchildren: primaryStatus.trailingLabel ?? timeLabel(row.updatedAt, now, t)\n';
const TRAILING_NEW =
  '\t\t\t\t\t\t\t\t\tchildren: sideChat ? timeLabel(row.updatedAt, now, t) : primaryStatus.trailingLabel ?? timeLabel(row.updatedAt, now, t)\n';
source = replaceOnce(source, 'SessionNodeItem trailing', TRAILING, TRAILING_NEW);

// 7. Renaming a side row must keep its `⧉ <parent> · ` marker.
const RENAME =
  '\t\t\tconst renameSession = async (sessionId, title) => {\n' +
  '\t\t\t\tconst result = await sessions.using(sessionId, { source: "workspaceOperation" }, (reference) => reference.binding.session.rename(title));\n';
const RENAME_NEW =
  '\t\t\tconst renameSession = async (sessionId, title) => {\n' +
  '\t\t\t\tconst sideParent = globalThis.__DSH_SIDE_CHAT__?.parentOf?.(sessionId);\n' +
  '\t\t\t\tconst nextTitle = sideParent === undefined || title.startsWith("⧉ ") ? title : "⧉ " + sideParent + " · " + title;\n' +
  '\t\t\t\tconst result = await sessions.using(sessionId, { source: "workspaceOperation" }, (reference) => reference.binding.session.rename(nextTitle));\n';
source = replaceOnce(source, 'renameSession marker', RENAME, RENAME_NEW);

if (dry) {
  console.log(`dry      would write ${fs.statSync(file).size} -> ${Buffer.byteLength(source, 'utf8')} bytes`);
} else {
  fs.writeFileSync(file, source, 'utf8');
  console.log(`write    ${fs.statSync(file).size} bytes`);
}
console.log('ok       side chats render as a tree under their main Session');
