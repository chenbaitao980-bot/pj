#!/usr/bin/env node
/**
 * Mirror workspace plugins into a live DSH home.
 *
 * The frozen payload ships plugins through
 * `<payload>/dsh-home/plugins` + `profiles/desktop/node_modules`, but a live
 * `~/.dsh` profile resolves real copies in both places, so syncing a plugin
 * into the running installation needs the same two copies and manifest rows.
 * Re-running replaces the mirrored copies and re-asserts the manifest entries.
 *
 * usage: node sync-live-plugins.js <dshHome> <pluginDir...> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const args = argv.filter((a) => !a.startsWith('--'));
const [home, ...pluginDirs] = args;

if (!home || pluginDirs.length === 0) {
  console.error('usage: node sync-live-plugins.js <dshHome> <pluginDir...> [--dry]');
  process.exit(2);
}

const profileDir = path.join(home, 'profiles', 'desktop');
const profileFile = path.join(profileDir, 'package.json');
if (!fs.existsSync(profileFile)) {
  console.error(`MISSING  ${profileFile}`);
  process.exit(1);
}

/** Vendored plugin sources may carry VCS/dep directories; never mirror them. */
const SKIP_NAMES = new Set(['.git', '.github', 'node_modules', '.pnpm', '.DS_Store']);

function mirror(from, to) {
  if (dry) {
    console.log(`dry      ${from} -> ${to}`);
    return;
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => !SKIP_NAMES.has(path.basename(src)) });
  console.log(`copy     ${to}`);
}

const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
profile.dependencies ??= {};
profile.dsh ??= {};
profile.dsh.profile ??= {};
profile.dsh.profile.bundles ??= [];
let changed = false;

for (const dir of pluginDirs) {
  const pkgFile = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    console.error(`MISSING  ${pkgFile}`);
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const name = pkg.name;
  const folder = path.basename(dir);
  mirror(dir, path.join(home, 'plugins', folder));
  mirror(dir, path.join(profileDir, 'node_modules', ...name.split('/')));
  const spec = `file:../../plugins/${folder}`;
  if (profile.dependencies[name] !== spec) {
    profile.dependencies[name] = spec;
    changed = true;
    console.log(`manifest dependency ${name} = ${spec}`);
  }
  if (!profile.dsh.profile.bundles.includes(name)) {
    profile.dsh.profile.bundles.push(name);
    changed = true;
    console.log(`manifest bundle     ${name}`);
  }
}

if (!dry && changed) {
  fs.writeFileSync(profileFile, `${JSON.stringify(profile, null, 4)}\n`, 'utf8');
  console.log(`write    ${profileFile}`);
} else if (!changed) {
  console.log('manifest already lists every plugin');
}
console.log('ok       live plugins synced');
