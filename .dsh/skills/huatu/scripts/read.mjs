#!/usr/bin/env node
// 读取目标页完整图（节点位置/样式、连线端点）与版本。用法：node read.mjs --doc <document_id> --page <page_id>
import { fail, parseArgs, printJson, resolveConfig, runCommand } from './bridge.mjs';
const args = parseArgs(process.argv.slice(2));
if (typeof args.doc !== 'string' || typeof args.page !== 'string') fail('需要 --doc 与 --page（先运行 targets.mjs 确认精确目标）。');
const config = resolveConfig(args);
const result = await runCommand(config, { type: 'read', target: { document_id: args.doc, page_id: args.page } });
printJson({ ok: true, ...result });
