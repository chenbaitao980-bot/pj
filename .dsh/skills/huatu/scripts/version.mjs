#!/usr/bin/env node
// 升版 / 写版本备注（走命令桥 tool op，不需要屏幕操作）。
//   node version.mjs --doc <document_id> [--note "vN 日期 改了什么"]      # 只升版
//   node version.mjs --doc <document_id> --upgrade --note "..."          # 升版并给新版本写备注
//   node version.mjs --doc <document_id> --note "..." --rename-only      # 只给该版本写备注
import { fail, parseArgs, printJson, resolveConfig, runCommand } from './bridge.mjs';

const args = parseArgs(process.argv.slice(2));
if (typeof args.doc !== 'string') fail('需要 --doc <document_id>（targets.mjs 可查）。');
const note = typeof args.note === 'string' ? args.note.trim() : '';
const upgrade = args.upgrade === true || (args.note !== undefined && args.renameOnly !== true);
const renameOnly = args['rename-only'] === true;

if (!upgrade && !note) fail('至少指定 --upgrade 或 --note。');
if (renameOnly && !note) fail('--rename-only 需要 --note。');
if (note.length > 200) fail('--note 最多 200 字。');

const config = resolveConfig(args);
const out = { ok: true, document_id: args.doc };

let targetDocId = args.doc;
let versionId;
if (upgrade) {
  const up = await runCommand(config, {
    type: 'tool',
    ops: [{ op: 'upgrade_flow_version', documentId: args.doc }],
  });
  const result = up.result ?? {};
  targetDocId = result.document_id ?? args.doc;
  versionId = result.version_id;
  if (!versionId || !result.document_id) fail('升版结果缺少 version_id/document_id。', 7, up);
  out.upgraded = { flow_id: result.flow_id, version_id: versionId, seq: result.seq, document_id: result.document_id, page_id: result.page_id };
}

if (note) {
  const renamed = await runCommand(config, {
    type: 'tool',
    ops: [{ op: 'rename_flow_version', documentId: targetDocId, versionId: versionId ?? args.doc, name: note }],
  });
  out.note = renamed.result ?? {};
}

printJson(out);
