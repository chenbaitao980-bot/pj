#!/usr/bin/env node
// 读取图库目录：全部类别、专业子类、条目 ID（含个人组件）。AI 只能使用目录内的图形。
import { parseArgs, printJson, resolveConfig, runCommand } from './bridge.mjs';
const config = resolveConfig(parseArgs(process.argv.slice(2)));
printJson({ ok: true, ...(await runCommand(config, { type: 'catalog' })) });
