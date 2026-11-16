#!/usr/bin/env node
// 应用一批操作（整批一次撤销，失败整批回滚）。
// 已有目标：node apply.mjs --doc <id> --page <id> --base-version <read 返回的 version> --ops ops.json [--key <幂等键>]
// 新建画布：node apply.mjs --create "采购流程" --ops ops.json [--key <幂等键>]
import fs from 'node:fs';
import { fail, parseArgs, printJson, resolveConfig, runCommand } from './bridge.mjs';
const args = parseArgs(process.argv.slice(2));
if (!args.ops || args.ops === true) fail('需要 --ops <文件>（JSON 数组，每项含 op 字段）。');
let ops;
try { ops = JSON.parse(fs.readFileSync(args.ops, 'utf8')); } catch (error) { fail(`无法读取 ops 文件：${error.message}`); }
if (!Array.isArray(ops) || !ops.length) fail('ops 必须是非空数组。');
const command = { type: 'apply', ops };
if (args.key && args.key !== true) command.idempotency_key = args.key;
if (args.create && args.create !== true) {
  if (args.doc !== undefined || args.page !== undefined) fail('--create 与 --doc/--page 不能同时使用。');
  command.target = { create: { name: args.create } };
} else {
  if (typeof args.doc !== 'string' || typeof args.page !== 'string') fail('已有目标需要 --doc 与 --page；新建画布请用 --create <名称>。');
  if (!args['base-version'] || args['base-version'] === true) fail('已有目标需要 --base-version（先 read 获取），避免覆盖他人改动。');
  command.target = { document_id: args.doc, page_id: args.page };
  command.base_version = args['base-version'];
}
const config = resolveConfig(args);
printJson({ ok: true, ...(await runCommand(config, command)) });
