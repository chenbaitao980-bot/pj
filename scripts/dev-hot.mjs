#!/usr/bin/env node
/**
 * Hot-deploy workspace plugins into the running DSH home.
 *
 * Why this exists: a frozen install loads plugins from `~/.dsh/plugins` and
 * `~/.dsh/profiles/desktop/node_modules`, not from this repo. Editing
 * `plugins/<name>/client.js` therefore changes nothing until the file is
 * mirrored into both copies. `@deepseek-ai/dsh-client-hmr` then picks the new
 * bundle up by polling its entry artifact's mtime and swaps the plugin into the
 * open page - no reload, no reinstall.
 *
 * usage:
 *   node scripts/dev-hot.mjs                 # sync every plugin once
 *   node scripts/dev-hot.mjs --watch         # sync on every change
 *   node scripts/dev-hot.mjs --only dsh-task-board,dsh-toolcall-tone
 *   node scripts/dev-hot.mjs --reconcile     # also bump cordis.patch.yml
 *
 * Exit codes: 0 ok, 1 sync/syntax failure, 2 bad usage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const syncScript = path.join(repoRoot, 'frozen-build-src', 'sync-live-plugins.js');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const home = path.resolve(value('--home', path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')));
const pluginsRoot = path.resolve(value('--plugins', path.join(repoRoot, 'plugins')));
const only = (value('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const watch = flag('--watch');
const forceReconcile = flag('--reconcile');

if (!fs.existsSync(path.join(home, 'profiles', 'desktop', 'package.json'))) {
  console.error(`no DSH profile at ${home}`);
  process.exit(2);
}
if (!fs.existsSync(syncScript)) {
  console.error(`missing ${syncScript}`);
  process.exit(2);
}

const ENTRY_CANDIDATES = ['client.js', 'index.js', 'index.mjs'];

function pluginDirs() {
  if (!fs.existsSync(pluginsRoot)) return [];
  return fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(pluginsRoot, d.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .filter((dir) => only.length === 0 || only.includes(path.basename(dir)));
}

function readProfile() {
  const file = path.join(home, 'profiles', 'desktop', 'package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function registered(name) {
  const profile = readProfile();
  return Array.isArray(profile?.dsh?.profile?.bundles) && profile.dsh.profile.bundles.includes(name);
}

/** Reject a broken bundle before it reaches the live profile. */
function syntaxOk(dir) {
  for (const entry of ENTRY_CANDIDATES) {
    const file = path.join(dir, entry);
    if (!fs.existsSync(file)) continue;
    const run = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (run.status !== 0) {
      console.error(`syntax  ${path.relative(repoRoot, file)}`);
      console.error(run.stderr?.trim() ?? '');
      return false;
    }
  }
  return true;
}

function touchPatchFile(reason) {
  const patchFile = path.join(home, 'profiles', 'desktop', 'cordis.patch.yml');
  if (!fs.existsSync(patchFile)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.appendFileSync(patchFile, `# dev-hot ${stamp} ${reason}\n`, 'utf8');
  console.log(`reconcile ${patchFile}`);
}

function syncOne(dir) {
  const name = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name;
  if (!syntaxOk(dir)) return false;
  const wasRegistered = registered(name);
  const run = spawnSync(process.execPath, [syncScript, home, dir], { encoding: 'utf8', stdio: 'pipe' });
  if (run.status !== 0) {
    console.error(`sync failed ${path.basename(dir)}`);
    console.error((run.stderr || run.stdout || '').trim());
    return false;
  }
  for (const line of (run.stdout ?? '').split(/\r?\n/)) {
    if (line.trim() && !line.startsWith('ok ')) console.log(`  ${line.trim()}`);
  }
  const needsReconcile = forceReconcile || !wasRegistered || /manifest (bundle|dependency)/.test(run.stdout ?? '');
  if (needsReconcile) touchPatchFile(name);
  console.log(`synced  ${path.basename(dir)} -> ${home}`);
  return true;
}

function syncAll() {
  let ok = true;
  for (const dir of pluginDirs()) {
    if (!syncOne(dir)) ok = false;
  }
  return ok;
}

if (!watch) {
  process.exit(syncAll() ? 0 : 1);
}

if (!syncAll()) process.exitCode = 1;

const pending = new Map();
let timer = null;

function schedule(file) {
  const rel = path.relative(pluginsRoot, file);
  const folder = rel.split(path.sep)[0];
  if (!folder) return;
  const dir = path.join(pluginsRoot, folder);
  if (only.length && !only.includes(folder)) return;
  if (!fs.existsSync(path.join(dir, 'package.json'))) return;
  pending.set(folder, dir);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const jobs = [...pending.values()];
    pending.clear();
    for (const dir of jobs) syncOne(dir);
  }, 400);
}

console.log(`watching ${pluginsRoot} -> ${home} (ctrl+c to stop)`);
fs.watch(pluginsRoot, { recursive: true }, (_event, file) => {
  if (!file) return;
  const name = path.basename(String(file));
  if (name.endsWith('.swp') || name.endsWith('~') || name.startsWith('.#')) return;
  schedule(path.join(pluginsRoot, String(file)));
});
