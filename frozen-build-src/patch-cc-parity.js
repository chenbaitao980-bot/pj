#!/usr/bin/env node
/**
 * Frozen-build patch: the two chat-bundle seams that plugin code cannot reach.
 *
 * Everything else in the Claude-Code parity work lives in `@local/dsh-cc-touch`
 * and hot-reloads. Two behaviours are compiled into the shipped bundles:
 *
 *   1. The session row only knows `onPointerEnter: marquee.enter`, so nothing
 *      can warm a Session journal before the click. This patch forwards hover
 *      to `window.__dshPrefetchSession(id)` (published by the plugin) which
 *      calls the idempotent `Session.open()`.
 *   2. ChatView replaces its whole message area with one text line while
 *      `openState === "loading"`, and the running indicator is a fixed
 *      "深度求索中" template. This patch swaps the line for an empty element
 *      carrying the same aria label (the plugin paints skeleton bars into it)
 *      and lets `window.__dshRunningLabel()` supply a verb, falling back to the
 *      shipped copy whenever the plugin is absent or idle.
 *
 * Every hop is optional at runtime: with the plugin unloaded the patched
 * bundles behave exactly like upstream.
 *
 * Idempotent: each step carries a marker and is skipped when present.
 *
 * usage: node patch-cc-parity.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-cc-parity.js <payloadRoot> [--dry]');
  process.exit(2);
}

const DSH = path.join(payloadRoot, 'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai');

const WORKSPACE = path.join(DSH, 'dsh-client-ui-workspace', 'lib', 'client.js');
const CHAT = path.join(DSH, 'dsh-client-ui-chat', 'lib', 'client.js');

let failed = 0;

/**
 * Apply one anchored replacement.
 *
 * `anchor` must appear exactly once; when `mark` is already in the file the
 * step is skipped, which makes a second packaging run a no-op instead of a
 * double insert. A miss is reported and counted, never silently ignored.
 */
function step(label, file, mark, anchor, next) {
  if (!fs.existsSync(file)) {
    console.error(`MISSING  ${label}: ${file}`);
    failed += 1;
    return;
  }

  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(mark)) {
    console.log(`skip     ${label} (already applied)`);
    return;
  }

  const hits = source.split(anchor).length - 1;
  if (hits !== 1) {
    console.error(`FAIL     ${label}: anchor matched ${hits} time(s)`);
    failed += 1;
    return;
  }

  const patched = source.replace(anchor, next);
  if (dry) {
    console.log(`dry      ${label}: ${source.length} -> ${patched.length} bytes`);
    return;
  }
  fs.writeFileSync(file, patched, 'utf8');
  console.log(`write    ${label}: ${source.length} -> ${patched.length} bytes`);
}

/* 1. Session rows warm their journal on hover. */
step(
  'workspace.prefetch-hover',
  WORKSPACE,
  '/*dsh:cc-prefetch*/',
  'onPointerEnter: marquee.enter,',
  'onPointerEnter: (event) => { /*dsh:cc-prefetch*/ marquee.enter(event); window.__dshPrefetchSession?.(node.id); },',
);

/* 2a. Loading line becomes an empty skeleton host that keeps the aria label. */
step(
  'chat.loading-skeleton',
  CHAT,
  '/*dsh:cc-skeleton*/',
  'children: t("chat.loadingHistory")',
  '"aria-label": t("chat.loadingHistory") /*dsh:cc-skeleton*/',
);

step(
  'chat.loading-skeleton-class',
  CHAT,
  '/*dsh:cc-skeleton-class*/',
  'className: ChatView_module_css_default.hint,',
  'className: ChatView_module_css_default.hint + " dsh-chat-skeleton" /*dsh:cc-skeleton-class*/,',
);

/* 2b. The running label asks the plugin for a live verb, then falls back. */
const LABEL_ANCHOR =
  'const label = startTime === void 0 ? t("chat.deepDiving") : t("chat.deepDivingFor", { duration: formatRunDuration(Math.max(1e3, now - startTime), t).map((part) => part.text).join("") });';

const LABEL_NEXT =
  '/*dsh:cc-running-label*/ const __ccLive = typeof window.__dshRunningLabel === "function" ? window.__dshRunningLabel() : null; ' +
  'const __ccElapsed = startTime === void 0 ? "" : formatRunDuration(Math.max(1e3, now - startTime), t).map((part) => part.text).join(""); ' +
  'const label = typeof __ccLive === "string" && __ccLive.length > 0 ? (__ccElapsed === "" ? __ccLive : __ccLive + " · " + __ccElapsed) : ' +
  '(startTime === void 0 ? t("chat.deepDiving") : t("chat.deepDivingFor", { duration: __ccElapsed }));';

step('chat.running-label', CHAT, '/*dsh:cc-running-label*/', LABEL_ANCHOR, LABEL_NEXT);

if (failed > 0) {
  console.error(`\n${failed} step(s) failed`);
  process.exit(1);
}

console.log('ok       chat bundle parity seams applied');
