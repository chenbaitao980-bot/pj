#!/usr/bin/env node
/**
 * DSH profile 插件自检（离线、只读）。
 *
 *   node check-plugins.mjs "<profile 目录>"        # 例：%USERPROFILE%\.dsh\profiles\desktop
 *   node check-plugins.mjs "<profile 目录>" --json # 机器可读
 *
 * 为什么需要它：
 *   桌面版每次启动都会加载 profile 里 `dsh.profile.bundles` 列出的所有插件。
 *   只要有一个第三方插件的**依赖**在 profile 的 node_modules 里解析不到
 *   （典型：打包时只带了插件本体、漏了 pnpm 提升上去的传递依赖），
 *   宿主启动就会失败，Electron 弹「禁用第三方插件后重启」的恢复窗口。
 *   这个脚本在安装阶段就把这种情况抓出来，而不是等用户第一次打开才发现。
 *
 * 判定口径：
 *   * `@deepseek-ai/*` 由宿主自带（resources/app/dsh/node_modules），不检查；
 *   * 其余包必须能从 profile 目录解析到 package.json，且其 dependencies
 *     逐个能从 profile 解析（peerDependencies 里的 @deepseek-ai/* 跳过）。
 *
 * 退出码：0 全部可解析；1 有缺失；2 用法错误。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const profileArg = args.find((arg) => !arg.startsWith('--'));
if (!profileArg) {
	console.error('usage: node check-plugins.mjs <profile-dir> [--json]');
	process.exit(2);
}

const profileDir = resolve(profileArg);
const manifestPath = join(profileDir, 'package.json');
if (!existsSync(manifestPath)) {
	console.error(`profile 里没有 package.json：${manifestPath}`);
	process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const require = createRequire(manifestPath);
const bundles = manifest?.dsh?.profile?.bundles ?? [];
const dependencySpecs = manifest?.dependencies ?? {};

/** 宿主自带的包前缀。 */
const HOST_OWNED = /^@deepseek-ai\//u;

function readPackageJson(dir) {
	try {
		return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	} catch {
		return undefined;
	}
}

/** 解析一个包：返回 { ok, resolved?, reason? }。 */
function resolvePackage(name) {
	try {
		const entry = require.resolve(name);
		let dir = entry;
		// 往上找到最近的 package.json
		for (let i = 0; i < 12; i += 1) {
			dir = resolve(dir, '..');
			const pkg = readPackageJson(dir);
			if (pkg !== undefined) return { ok: true, resolved: dir, pkg };
		}
		return { ok: true, resolved: entry, pkg: undefined };
	} catch (error) {
		let viaJson;
		try {
			viaJson = require.resolve(`${name}/package.json`);
		} catch {
			viaJson = undefined;
		}
		if (viaJson !== undefined) return { ok: true, resolved: resolve(viaJson, '..'), pkg: readPackageJson(resolve(viaJson, '..')) };
		return { ok: false, reason: String(error?.code ?? error?.message ?? error) };
	}
}

const packages = [...new Set([...bundles, ...Object.keys(dependencySpecs)])].sort();
const report = { profileDir, checkedAt: new Date().toISOString(), packages: [], problems: [] };

for (const name of packages) {
	const row = { name, kind: bundles.includes(name) ? 'bundle' : 'dependency', ok: true, missing: [], version: undefined };
	if (HOST_OWNED.test(name)) {
		row.ok = true;
		row.kind = `${row.kind}:host-owned`;
		report.packages.push(row);
		continue;
	}
	const resolved = resolvePackage(name);
	if (!resolved.ok) {
		row.ok = false;
		row.missing.push(`<${name}> 本体解析失败：${resolved.reason}`);
		report.problems.push({ package: name, missing: [`<${name}>`] });
		report.packages.push(row);
		continue;
	}
	row.version = resolved.pkg?.version;
	row.resolved = resolved.resolved;
	const deps = Object.keys(resolved.pkg?.dependencies ?? {});
	for (const dep of deps) {
		if (HOST_OWNED.test(dep)) continue;
		const hit = resolvePackage(dep);
		if (!hit.ok) row.missing.push(`${dep}(${hit.reason})`);
	}
	if (row.missing.length > 0) {
		row.ok = false;
		report.problems.push({ package: name, missing: row.missing });
	}
	report.packages.push(row);
}

report.ok = report.problems.length === 0;

if (asJson) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(`profile: ${profileDir}`);
	console.log(`bundles: ${bundles.length}   依赖条目: ${Object.keys(dependencySpecs).length}`);
	console.log('');
	const width = Math.max(...report.packages.map((row) => row.name.length), 12) + 2;
	for (const row of report.packages) {
		const state = row.ok ? 'OK  ' : 'FAIL';
		const tail = row.missing.length > 0 ? `  缺 ${row.missing.length} 项：${row.missing.slice(0, 6).join(', ')}` : `  ${row.version ?? ''}`;
		console.log(`${state} ${row.name.padEnd(width)}${row.kind.padEnd(22)}${tail}`);
	}
	console.log('');
	if (report.ok) {
		console.log('全部插件依赖可解析：这个 profile 在离线新机器上可以直接启动。');
	} else {
		console.log(`发现 ${report.problems.length} 个插件依赖不完整 —— 这样的 profile 拷到新机器会被宿主判为启动失败。`);
		console.log('修复：把打包机 profile 的 node_modules 整目录带过去（含 .pnpm / .modules.yaml），或删除这些 bundle。');
	}
}

process.exit(report.ok ? 0 : 1);
