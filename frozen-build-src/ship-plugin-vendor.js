#!/usr/bin/env node
/**
 * Ship a workspace plugin that carries its own nested `vendor/node_modules`.
 *
 * `ship-plugin.js` skips every directory named `node_modules` because vendored
 * plugin sources usually only contain dependency trees that the profile already
 * resolves. A plugin that vendors a private runtime (dsh-codex-cua ships
 * `vendor/@oai/sky` + `vendor/node_modules/@statsig`) needs those directories to
 * survive: dropping them makes the package install fine and fail at the first
 * import, because Node walks up from `vendor/@oai/sky/dist/...` and only finds
 * `@statsig` in `vendor/node_modules`.
 *
 * Rules:
 *   * the plugin's OWN top-level `node_modules` is still skipped (a profile
 *     resolves it), only nested vendor trees are kept;
 *   * `state/` is skipped: it is runtime output (sky options, approval audit),
 *     recreated on first start;
 *   * manifest rows and the exports check match ship-plugin.js.
 *
 * Idempotent: re-running replaces the mirrored copies and re-asserts the
 * manifest entries without duplicating them.
 *
 * usage: node ship-plugin-vendor.js <payloadRoot> <pluginDir> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dry = process.argv.includes('--dry');
const [payloadRoot, pluginDir] = argv;

if (!payloadRoot || !pluginDir) {
  console.error('usage: node ship-plugin-vendor.js <payloadRoot> <pluginDir> [--dry]');
  process.exit(2);
}

const pkgFile = path.join(pluginDir, 'package.json');
if (!fs.existsSync(pkgFile)) {
  console.error(`MISSING  ${pkgFile}`);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const name = pkg.name;
if (!name) {
  console.error('plugin package.json has no name');
  process.exit(1);
}
const folder = path.basename(pluginDir);

const home = path.join(payloadRoot, 'dsh-home');
const pluginDest = path.join(home, 'plugins', folder);
const profileDir = path.join(home, 'profiles', 'desktop');
const moduleDest = path.join(profileDir, 'node_modules', ...name.split('/'));
const profileFile = path.join(profileDir, 'package.json');

if (!fs.existsSync(profileFile)) {
  console.error(`MISSING  ${profileFile}`);
  process.exit(1);
}

/** VCS noise plus runtime state; never ship them. */
const SKIP_NAMES = new Set(['.git', '.github', '.pnpm', '.DS_Store', 'state']);

function keep(src) {
  const base = path.basename(src);
  if (SKIP_NAMES.has(base)) return false;
  // Only the plugin's own dependency tree is profile-resolved; nested vendor
  // trees are private runtime and must survive.
  if (base === 'node_modules' && path.dirname(src) === pluginDir) return false;
  return true;
}

function mirror(from, to) {
  if (dry) {
    console.log(`dry      ${from} -> ${to}`);
    return;
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, filter: keep });
  const stat = fs
    .readdirSync(to, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile());
  console.log(`copy     ${to} (${stat.length} files)`);
}

mirror(pluginDir, pluginDest);
mirror(pluginDir, moduleDest);

const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
profile.dependencies ??= {};
profile.dsh ??= {};
profile.dsh.profile ??= {};
profile.dsh.profile.bundles ??= [];

const spec = `file:../../plugins/${folder}`;
let changed = false;

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

if (!changed) {
  console.log('manifest already lists the plugin');
} else if (dry) {
  console.log('dry      would write profile package.json');
} else {
  fs.writeFileSync(profileFile, `${JSON.stringify(profile, null, 4)}\n`, 'utf8');
  console.log(`write    ${profileFile}`);
}

// `exports` values may be a string, an array, or a conditions object.
function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets);
  return [];
}

if (!dry) {
  const shippedManifest = path.join(moduleDest, 'package.json');
  if (!fs.existsSync(shippedManifest)) {
    console.error(`FAIL     shipped package missing: ${shippedManifest}`);
    process.exit(1);
  }
  const shipped = JSON.parse(fs.readFileSync(shippedManifest, 'utf8'));
  for (const [key, value] of Object.entries(shipped.exports ?? {})) {
    for (const rel of exportTargets(value)) {
      if (rel.includes('*')) continue;
      if (!fs.existsSync(path.join(moduleDest, rel))) {
        console.error(`FAIL     export ${key} -> ${rel} does not exist`);
        process.exit(1);
      }
    }
  }

  // Vendor trees are the whole point of this shipper: prove they landed.
  const required = [
    'vendor/@oai/sky/package.json',
    'vendor/@oai/sky/bin/windows/codex-computer-use.exe',
    'vendor/node_modules/@statsig/js-client/package.json',
    'vendor/node_modules/@statsig/client-core/package.json',
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(moduleDest, rel)));
  if (missing.length > 0) {
    console.error(`FAIL     vendored runtime incomplete: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`ok       ${name}@${shipped.version} shipped with vendored runtime`);
}
