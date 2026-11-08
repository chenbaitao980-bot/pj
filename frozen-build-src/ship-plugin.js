#!/usr/bin/env node
/**
 * Ship a workspace plugin inside the frozen payload.
 *
 * An installed frozen build resolves profile bundles from
 * `<payload>/dsh-home/profiles/desktop/node_modules`, and that profile's `file:`
 * dependencies point at `<payload>/dsh-home/plugins`. A plugin that only exists
 * in the developer's workspace (or in a symlinked local profile) therefore
 * reaches neither a fresh install nor the mobile client. This script mirrors the
 * package into both places and registers it in the profile manifest.
 *
 * Idempotent: re-running replaces the mirrored copies and re-asserts the
 * manifest entries without duplicating them.
 *
 * usage: node ship-plugin.js <payloadRoot> <pluginDir> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dry = process.argv.includes('--dry');
const [payloadRoot, pluginDir] = argv;

if (!payloadRoot || !pluginDir) {
  console.error('usage: node ship-plugin.js <payloadRoot> <pluginDir> [--dry]');
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

function mirror(from, to) {
  if (dry) {
    console.log(`dry      ${from} -> ${to}`);
    return;
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`copy     ${to}`);
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

// Verify the shipped copy is loadable: its declared exports must resolve.
const shippedManifest = path.join(moduleDest, 'package.json');
if (!dry) {
  if (!fs.existsSync(shippedManifest)) {
    console.error(`FAIL     shipped package missing: ${shippedManifest}`);
    process.exit(1);
  }
  const shipped = JSON.parse(fs.readFileSync(shippedManifest, 'utf8'));
  for (const [key, rel] of Object.entries(shipped.exports ?? {})) {
    if (rel.includes('*')) continue;
    if (!fs.existsSync(path.join(moduleDest, rel))) {
      console.error(`FAIL     export ${key} -> ${rel} does not exist`);
      process.exit(1);
    }
  }
  console.log(`ok       ${name}@${shipped.version} shipped and exports resolve`);
}
