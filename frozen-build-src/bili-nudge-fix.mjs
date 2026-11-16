#!/usr/bin/env node
/**
 * bili-nudge-fix.mjs — billion-context 压缩 nudge 死锁修复（幂等）
 *
 * 背景：nudge 的 formatRanges() 把 compressible 段与 protected 段合并成一条展示行，
 * 而服务端 outOfRecommendedRanges() 的放行集合不含 protected 段，
 * 于是「照抄 nudge 的范围」必被拒；叠加 minCompressRange 二次过滤与
 * 「无可压范围时仍催促压缩」的文案，形成每轮必报 Compression REFUSED 的死循环。
 *
 * 用法：
 *   node bili-nudge-fix.mjs                          # 打补丁（默认 profile）
 *   node bili-nudge-fix.mjs --profile <profileDir>   # 指定 profile（冻结包安装时用）
 *   node bili-nudge-fix.mjs --check                  # 只检查
 *   node bili-nudge-fix.mjs --revert                 # 从 .bak-20261115-bili 恢复
 *
 * 目标不存在（未装 billion-context）时直接退出 0，供安装脚本无脑调用。
 * 生效：改完需要重启 bili 代理进程（dsh 会在下一次模型请求时自动 respawn）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
};
const PROFILE = path.resolve(
  argOf('--profile') || process.env.BILI_PROFILE_DIR || path.join(os.homedir(), '.dsh', 'profiles', 'desktop'),
).replace(/\\/g, '/');
const DIST = PROFILE + '/node_modules/billion-context/dist/index.js';
const BAK = DIST + '.bak-20261115-bili';
const NL = String.fromCharCode(10);

const EDITS = [
  {
    name: 'P1 gate accepts the nudge protectedRanges it displays',
    from: 'function outOfRecommendedRanges(ranges,ctx){const exempt=mergeIntervals([...recommendedIntervals(ctx),...coveredRefRuns(ctx.session.state)]);',
    to:   'function outOfRecommendedRanges(ranges,ctx){const protSpans=(ctx.lastNudge?.protectedRanges??[]).map(r=>{const ps=refToIndex(r.startRef);const pe=refToIndex(r.endRef);return ps!==null&&pe!==null&&ps<=pe?[ps,pe]:null}).filter(Boolean);const exempt=mergeIntervals([...recommendedIntervals(ctx),...coveredRefRuns(ctx.session.state),...protSpans]);',
  },
  {
    name: 'P2 no duplicate minCompressRange filter on the nudge path',
    from: 'function recommendedIntervals(ctx){let ranges;if(ctx.lastNudge){ranges=excludeDeadRefRanges(viableRanges(ctx.lastNudge.compressibleRanges??[]),ctx.session.state.deadRefs)}else{ranges=liveCompressionRanges(ctx)?.ranges}const minChars=ctx.config.compress.minCompressRange;const out=[];for(const r of ranges??[]){if(minChars>0&&(r.chars??r.tokens*4)<minChars)continue;',
    to:   'function recommendedIntervals(ctx){const fromNudge=!!ctx.lastNudge;let ranges;if(ctx.lastNudge){ranges=excludeDeadRefRanges(viableRanges(ctx.lastNudge.compressibleRanges??[]),ctx.session.state.deadRefs)}else{ranges=liveCompressionRanges(ctx)?.ranges}const minChars=ctx.config.compress.minCompressRange;const out=[];for(const r of ranges??[]){if(!fromNudge&&minChars>0&&(r.chars??r.tokens*4)<minChars)continue;',
  },
  {
    name: 'P3 never merge a compressible row with a protected row',
    from: 'if(last&&!e.noMergeBefore&&e.startPos<=last.endPos+1){last.endRef=e.endRef;',
    to:   'if(last&&!e.noMergeBefore&&e.startPos<=last.endPos+1&&((last.protectedTokens===0)===(e.protectedTokens===0))){last.endRef=e.endRef;',
  },
  {
    name: 'P4 empty recommendation stops inviting untargeted compress',
    from: 'return"[No specific ranges detected \\u2014 compress any consumed content.]"}',
    to:   'return"[No compressible range is eligible right now \\u2014 do NOT call compress this round; continue the task and wait for the next nudge.]"}',
  },
  {
    name: 'P5 range header states the submission rule',
    from: 'return`Compressible ranges (${merged.length}, oldest first):' + NL + '${lines.join("\\n")}`}',
    to:   'return`Compressible ranges (${merged.length}, oldest first \\u2014 submit each compressible row as its own range, in ONE call; never span a [PROTECTED] row):' + NL + '${lines.join("\\n")}`}',
  },
  {
    // 2026-11-15 21:45：requireNudge 的 armed 只在“本轮真的注入了 nudge”时为真，
    // 而 nudge 是增长阈值（100K）驱动、且注入后去重；模型看到 nudge 里列出的范围再调用 compress 时，
    // armed 已回落为 false → 42 次里 0 次压缩成功。放行「落在当前 nudge 可压范围内」的调用。
    name: 'P6 gate lets a call through when its spans are inside the live nudge ranges',
    from: 'function applyRanges(parsed,ctx,opts){const trackLoop=opts?.loopTracking!==false;const gate=trackLoop?unpromptedGateOf(ctx.session):void 0;if(gate?.requireNudge&&!gate.armed){',
    to:   'function biliRangesOfferedNow(ranges,ctx){try{if(!Array.isArray(ranges)||ranges.length===0)return false;const live=liveCompressionRanges(ctx);const list=live?.ranges;if(!Array.isArray(list)||list.length===0)return false;const num=r=>/^m\\d+$/.test(String(r))?Number(String(r).slice(1)):null;const win=[];for(const r of list){const a=num(r.startRef),b=num(r.endRef);if(a===null||b===null)continue;win.push(a<=b?[a,b]:[b,a])}if(win.length===0)return false;return ranges.every(r=>{const a=num(r.startRef),b=num(r.endRef);if(a===null||b===null)return false;const lo=Math.min(a,b),hi=Math.max(a,b);return win.some(([c,d])=>lo>=c&&hi<=d)})}catch{return false}}function applyRanges(parsed,ctx,opts){const trackLoop=opts?.loopTracking!==false;const gate=trackLoop?unpromptedGateOf(ctx.session):void 0;if(gate?.requireNudge&&!gate.armed&&!biliRangesOfferedNow(parsed.ranges,ctx)){',
  },
  {
    // 2026-11-16 07:5x：批量里只要有一段摘要不够长，整批回滚
    // （"Batch rejected before folding any range — 1 of 4 ... Summary too short (367 chars, min 600)"）。
    // 改成：够长的段照fold，不合规的段单独跳过并在 warnings 里点名，让模型只补那一段。
    name: 'P9 one short summary no longer rolls back the whole batch',
    from: '{const lengthFailures=[];for(const spec of input.ranges){if(skipSpecs.has(spec))continue;',
    to:   '{const __biliShort=[];for(const spec of input.ranges){if(skipSpecs.has(spec))continue;const __biliRes=classifications.get(spec);if(__biliRes===void 0)continue;const __biliFresh=__biliRes.status==="ok";const __biliRefold=__biliRes.status==="consumed"&&refoldDecisions.get(spec)?.kind==="refold";if(!__biliFresh&&!__biliRefold)continue;try{validateSummaryLength(spec,input.config.compress)}catch(__biliErr){__biliShort.push(rangeError(spec,__biliErr instanceof Error?__biliErr.message:String(__biliErr)))}}const __biliFoldable=input.ranges.filter(s=>!skipSpecs.has(s)&&(classifications.get(s)?.status==="ok"||(classifications.get(s)?.status==="consumed"&&refoldDecisions.get(s)?.kind==="refold"))).length;if(__biliShort.length>0&&__biliShort.length<__biliFoldable){for(const spec of input.ranges){if(skipSpecs.has(spec))continue;const __biliR2=classifications.get(spec);if(__biliR2===void 0)continue;const __biliF2=__biliR2.status==="ok";const __biliD2=__biliR2.status==="consumed"&&refoldDecisions.get(spec)?.kind==="refold";if(!__biliF2&&!__biliD2)continue;try{validateSummaryLength(spec,input.config.compress)}catch{skipSpecs.add(spec)}}warnings.push(`Skipped ${__biliShort.length} of ${__biliFoldable} foldable range(s) whose summary fell outside the length cap: ${__biliShort.join(" | ")}. The rest were folded; fix the skipped range(s) and resend only them.`)}const lengthFailures=[];for(const spec of input.ranges){if(skipSpecs.has(spec))continue;',
  },
];

// P8：同一份非法配置每轮都 warn 一次（实测 14 分钟 6058 行），按错误文本去重只报一次。
const WARN_FILE_EDITS = [
  DIST,
  PROFILE + '/node_modules/billion-context/dist/agent/opencode-native.js',
  PROFILE + '/node_modules/billion-context/dist/agent/pi-native.js',
].map((file) => ({
  file,
  name: 'P8 dedupe the per-request config validation warning (' + file.split('/').pop() + ')',
  from: 'console.warn(`[acp-kernel] Config validation warnings: ${configErrors.join("; ")}. Thresholds may not fire correctly.`)',
  to:   '{const __biliWarnKey=configErrors.join("; ");const __biliWarnSeen=globalThis.__BILI_CFG_WARNED??(globalThis.__BILI_CFG_WARNED=new Set);if(!__biliWarnSeen.has(__biliWarnKey)){__biliWarnSeen.add(__biliWarnKey);console.warn(`[acp-kernel] Config validation warnings: ${configErrors.join("; ")}. Thresholds may not fire correctly.`)}}',
}));

const mode = process.argv.includes('--revert') ? 'revert'
  : process.argv.includes('--check') ? 'check' : 'apply';

if (!fs.existsSync(DIST)) {
  console.log('skip: billion-context not installed at ' + DIST);
  process.exit(0);
}

if (mode === 'revert') {
  if (!fs.existsSync(BAK)) { console.error('backup not found: ' + BAK); process.exit(2); }
  fs.copyFileSync(BAK, DIST);
  console.log('reverted from ' + BAK);
  console.log('restart the bili proxy to load the original code.');
  process.exit(0);
}

let text = fs.readFileSync(DIST, 'utf8');
let applied = 0, skipped = 0, missing = 0;

for (const e of EDITS) {
  const hasTo = text.includes(e.to);
  const hasFrom = text.split(e.from).length - 1 === 1;
  if (hasTo) { skipped++; console.log('SKIP  ' + e.name); continue; }
  if (!hasFrom) { missing++; console.error('MISS  ' + e.name + ' (anchor not found; version drift?)'); continue; }
  if (mode === 'apply') { text = text.replace(e.from, e.to); applied++; }
  console.log((mode === 'apply' ? 'PATCH ' : 'READY ') + e.name);
}

// 先落 DIST，再改 warn 目标：index.js 同时是 DIST 与 warn 目标，顺序反了会被覆盖回旧内容。
if (mode === 'apply' && applied > 0) {
  if (!fs.existsSync(BAK)) fs.copyFileSync(DIST, BAK);
  fs.writeFileSync(DIST, text, 'utf8');
}

const warnResults = [];
for (const e of WARN_FILE_EDITS) {
  if (!fs.existsSync(e.file)) { warnResults.push([e, 'absent']); continue; }
  const src = fs.readFileSync(e.file, 'utf8');
  if (src.includes(e.to)) { warnResults.push([e, 'skip']); continue; }
  if (src.split(e.from).length - 1 !== 1) { warnResults.push([e, 'miss']); continue; }
  if (mode === 'apply') {
    const bak = e.file + '.bak-20261115-bili';
    if (!fs.existsSync(bak)) fs.copyFileSync(e.file, bak);
    fs.writeFileSync(e.file, src.replace(e.from, e.to), 'utf8');
    warnResults.push([e, 'patch']);
  } else {
    warnResults.push([e, 'ready']);
  }
}
for (const [e, state] of warnResults) {
  if (state === 'miss') { missing++; console.error('MISS  ' + e.name + ' (anchor not found; version drift?)'); continue; }
  if (state === 'skip') { skipped++; console.log('SKIP  ' + e.name); continue; }
  if (state === 'absent') { console.log('GONE  ' + e.name); continue; }
  applied++;
  console.log((state === 'patch' ? 'PATCH ' : 'READY ') + e.name);
}

if (mode === 'apply' && applied > 0) {
  console.log('written; restart the bili proxy: Stop-Process the node process listening on 18787 (dsh respawns it).');
}
console.log('summary applied=' + applied + ' already=' + skipped + ' missing=' + missing);
if (missing > 0) process.exit(1);
