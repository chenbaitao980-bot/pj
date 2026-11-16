#!/usr/bin/env node
// Execute one editor/library/modeling action. Database writes are separate from canvas undo.
import fs from 'node:fs';
import { fail, parseArgs, printJson, resolveConfig, runCommand } from './bridge.mjs';

const args = parseArgs(process.argv.slice(2));
if (typeof args.request !== 'string') fail('需要 --request <action.json>，内容为单个工具操作对象。');
let action;
try { action = JSON.parse(fs.readFileSync(args.request, 'utf8').replace(/^\uFEFF/, '')); }
catch (error) { fail(`无法读取操作文件：${error.message}`); }
if (!action || typeof action !== 'object' || Array.isArray(action)) fail('操作文件必须为单个对象。');
if (Boolean(args.doc) !== Boolean(args.page)) fail('--doc 与 --page 必须同时提供。');
const target = args.doc ? { document_id: args.doc, page_id: args.page } : undefined;
printJson({ ok: true, ...(await runCommand(resolveConfig(args), {
  type: 'tool', ops: [action], ...(target ? { target } : {}),
  ...(args['base-version'] ? { base_version: args['base-version'] } : {}),
  ...(args.key ? { idempotency_key: args.key } : {}),
})) });
