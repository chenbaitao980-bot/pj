#!/usr/bin/env node
// Copies the Codex Desktop computer-use engine into ./vendor.
//
// Source of truth: the unpacked Codex runtime that the Codex app itself keeps at
//   %LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\<hash>\bin\node_modules\@oai\sky
// (the MSIX install directory is read-only and stores the same tree as hard links).
//
// Only what the engine needs is copied:
//   dist/**                       pure ESM JS, includes its own tslib / oai_js_core
//   bin/windows/codex-computer-use.exe
//   bin/windows/swift/**          only when --with-swift is passed (54 MB, not required)
//   package.json
//
// Usage: node scripts/sync-vendor.mjs [--from <cua_node dir>] [--with-swift] [--force]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const withSwift = flag('--with-swift');
const force = flag('--force');
const explicitFrom = value('--from', '');

function findRuntimeRoot() {
  if (explicitFrom) return path.resolve(explicitFrom);
  const base = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'runtimes', 'cua_node');
  if (!existsSync(base)) return '';
  const dirs = readdirSync(base)
    .map((name) => path.join(base, name))
    .filter((dir) => existsSync(path.join(dir, 'bin', 'node_modules', '@oai', 'sky', 'package.json')))
    .map((dir) => ({ dir, mtime: statSync(path.join(dir, 'bin', 'node_modules', '@oai', 'sky', 'package.json')).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.dir ?? '';
}

const runtimeRoot = findRuntimeRoot();
if (!runtimeRoot) {
  console.error('找不到 Codex cua_node 运行时。用 --from <dir> 指定，或先安装 Codex 桌面版。');
  process.exit(2);
}

const source = path.join(runtimeRoot, 'bin', 'node_modules', '@oai', 'sky');
const vendorRoot = path.join(ROOT, 'vendor', '@oai', 'sky');
if (force && existsSync(vendorRoot)) rmSync(vendorRoot, { recursive: true, force: true });
mkdirSync(vendorRoot, { recursive: true });

const copy = (relative, options = {}) => {
  const from = path.join(source, relative);
  const to = path.join(vendorRoot, relative);
  if (!existsSync(from)) {
    if (options.optional) return false;
    throw new Error(`源缺失: ${from}`);
  }
  cpSync(from, to, { recursive: true, force: true, dereference: true });
  return true;
};

copy('dist');
copy('package.json');
copy(path.join('bin', 'windows', 'codex-computer-use.exe'));
copy(path.join('bin', 'windows', 'codex-computer-use-arm64.exe'), { optional: true });
if (withSwift) copy(path.join('bin', 'windows', 'swift'));
copy('docs', { optional: true });

// @statsig/* is a hard dependency of the sky telemetry module; resolve it from
// vendor/node_modules so nothing outside the plugin directory is required.
const statsigTarget = path.join(ROOT, 'vendor', 'node_modules', '@statsig');
for (const name of ['js-client', 'client-core']) {
  const from = path.join(runtimeRoot, 'bin', 'node_modules', '@statsig', name);
  if (!existsSync(from)) throw new Error(`源缺失: ${from}`);
  cpSync(from, path.join(statsigTarget, name), { recursive: true, force: true, dereference: true });
}

const helper = path.join(vendorRoot, 'bin', 'windows', 'codex-computer-use.exe');
const indexPath = path.join(vendorRoot, 'dist', 'project', 'cua', 'sky_js', 'src', 'index.js');
const servicePath = path.join(vendorRoot, 'dist', 'project', 'cua', 'sky_js', 'src', 'service.js');
for (const required of [helper, indexPath, servicePath]) {
  if (!existsSync(required)) throw new Error(`vendor 不完整，缺 ${required}`);
}

const pkg = JSON.parse(String(readFileSync(path.join(vendorRoot, 'package.json'))));
writeFileSync(path.join(ROOT, 'vendor', 'SOURCE.json'), `${JSON.stringify({
  syncedAt: new Date().toISOString(),
  runtimeRoot,
  package: pkg.name,
  version: pkg.version,
  withSwift,
}, null, 2)}\n`);

console.log(`vendor 就绪: @oai/sky ${pkg.version}`);
console.log(`  from    ${runtimeRoot}`);
console.log(`  helper  ${helper}`);
console.log(`  index   ${indexPath}`);
