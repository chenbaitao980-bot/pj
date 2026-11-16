#!/usr/bin/env node
// 列出编辑器当前可写的画布目标（文档/页面/版本）。用法：node targets.mjs [--base URL]
import { listTargets, parseArgs, printJson, resolveConfig } from './bridge.mjs';
const config = resolveConfig(parseArgs(process.argv.slice(2)));
printJson({ ok: true, ...(await listTargets(config)) });
