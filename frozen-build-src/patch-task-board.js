#!/usr/bin/env node
/**
 * Frozen-build patch: hand the composer task dock over to `@local/dsh-task-board`.
 *
 * Upstream registers `conversation-todo-dock` on `conversation.input.dock`. The
 * frozen task board replaces it because it also needs per-Subagent lists and
 * the Session's run state (to stop the "in progress" pulse when a Session is
 * stopped). Two panels would stack, so the upstream registration is removed.
 *
 * The upstream `TodoPanel`/`TodoDock` definitions stay in the bundle (unused);
 * only the slot registration is disabled.
 *
 * Idempotent: the replaced block carries a marker and is skipped when present.
 *
 * usage: node patch-task-board.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:todo-board-replaced*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-task-board.js <payloadRoot> [--dry]');
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

const original = fs.readFileSync(file, 'utf8');

if (original.includes(MARK)) {
  console.log('skip     task board replacement (already applied)');
  process.exit(0);
}

const FIND = `\t\t\tapply(ctx) {\n\t\t\t\tctx.slots.inject("conversation.input.dock", () => ctx.slots.register({\n\t\t\t\t\tname: "conversation.input.dock",\n\t\t\t\t\tid: "todo",\n\t\t\t\t\torder: 0,\n\t\t\t\t\tlocale: NS\n\t\t\t\t}, TodoDock));\n\t\t\t}`;

const REPLACE = `\t\t\tapply(ctx) {\n\t\t\t\t// ${MARK} The frozen task board (@local/dsh-task-board) owns this dock.\n\t\t\t}`;

const hits = original.split(FIND).length - 1;
if (hits !== 1) {
  console.error(`FAIL     upstream todo dock anchor matched ${hits} time(s)`);
  process.exit(1);
}

const next = original.replace(FIND, REPLACE);

if (dry) {
  console.log(`dry      would write ${original.length} -> ${next.length} bytes`);
} else {
  fs.writeFileSync(file, next, 'utf8');
  console.log(`write    ${original.length} -> ${next.length} bytes`);
}
console.log('ok       upstream todo dock disabled');
