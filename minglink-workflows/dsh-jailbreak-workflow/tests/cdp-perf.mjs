#!/usr/bin/env node
/**
 * 画布性能测量（阶段 0）：夹具图 → 拖拽 / 平移 / 整理布局，采帧率与长任务。
 *
 * 预算（AGENTS 讨论定下的）：拖拽 ≥55fps、平移 ≥58fps、长任务 ≤50ms、首挂 ≤2.5s。
 * 结论以数字为准，打印一张表；任一量级不达标退出码 1（可进 CI）。
 *
 * usage: DSH_CDP_PORT=9222 node --experimental-strip-types tests/cdp-perf.mjs [数量，逗号分隔]
 *   默认量级：50,100,200,400
 *
 * 环境自备（同 docs-shots 口径）：startShotsEnv 起实例；界面语言按 DOCS_LANG 注入；
 * cookie 用 installShotsCookie 种进浏览器（launch token 会过期，走 cookie 这条路）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootToCanvas, centerOf } from './lib/canvas-harness.mjs'
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'
import { openPage } from './lib/cdp-session.mjs'
import { buildFixtureGraph } from './lib/perf-fixture.mjs'
import { rpc } from './lib/web-session.mjs'
import { installShotsCookie, SHOTS_SESSION_TITLE, startShotsEnv } from './support/shots-env.mjs'

const COUNTS = (process.argv[2] ?? '50,100,200,400')
  .split(',')
  .map((text) => Number.parseInt(text.trim(), 10))
  .filter((n) => Number.isInteger(n) && n >= 4)
if (COUNTS.length === 0) throw new Error('量级参数不对，例：node tests/cdp-perf.mjs 50,100')
const LANG = process.env.DOCS_LANG === 'en' ? 'en' : 'zh'
const BROWSER_LANGS = LANG === 'en' ? ['en-US', 'en'] : ['zh-CN', 'zh']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 页内采帧：rAF 间隔 + PerformanceObserver(longtask)，start/stop 一对。 */
const SAMPLER = `(() => {
  if (globalThis.__perfSample !== undefined) return 'already';
  const state = { frames: [], tasks: [], stop: false, raf: null, observer: null };
  const tick = (now) => {
    if (state.stop) return;
    state.frames.push(now);
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
  try {
    state.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.tasks.push({ ms: Math.round(entry.duration), name: entry.name });
    });
    state.observer.observe({ entryTypes: ['longtask'] });
  } catch {}
  globalThis.__perfSample = state;
  return 'ok';
})()`

const SAMPLER_STOP = `(() => {
  const state = globalThis.__perfSample;
  if (state === undefined) return null;
  state.stop = true;
  if (state.raf !== null) cancelAnimationFrame(state.raf);
  if (state.observer !== null) state.observer.disconnect();
  const frames = state.frames;
  const tasks = state.tasks;
  delete globalThis.__perfSample;
  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) gaps.push(frames[i] - frames[i - 1]);
  gaps.sort((a, b) => a - b);
  const pct = (q) => (gaps.length === 0 ? 0 : gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))]);
  const span = frames.length > 1 ? frames[frames.length - 1] - frames[0] : 0;
  return {
    frames: frames.length,
    fps: frames.length > 2 && span > 0 ? Math.round(((frames.length - 1) / span) * 100000) / 100 : 0,
    p50: Math.round(pct(0.5)),
    p95: Math.round(pct(0.95)),
    worst: Math.round(gaps[gaps.length - 1] ?? 0),
    longTasks: tasks,
  };
})()`

/** 用 CDP 输入事件拖一个节点：每 16ms 一步，模拟 60fps 的 pointermove。 */
async function dragNode(session, nodeId, dx, dy, steps) {
  const from = await centerOf(session, `.react-flow__node[data-id=${JSON.stringify(nodeId)}]`)
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y })
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await session.evaluate(SAMPLER)
  for (let i = 1; i <= steps; i += 1) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + (dx * i) / steps),
      y: Math.round(from.y + (dy * i) / steps),
      button: 'left',
      buttons: 1,
    })
    await sleep(16)
  }
  const sample = await session.evaluate(SAMPLER_STOP)
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: from.x + dx,
    y: from.y + dy,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  return sample
}

/** 平移视口：按住空白处拖一段距离，同样采帧。 */
async function panViewport(session, dx, dy, steps) {
  const box = await session.evaluate(
    `(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
  )
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: box.x,
    y: box.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await session.evaluate(SAMPLER)
  for (let i = 1; i <= steps; i += 1) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: box.x + (dx * i) / steps,
      y: box.y + (dy * i) / steps,
      button: 'left',
      buttons: 1,
    })
    await sleep(16)
  }
  const sample = await session.evaluate(SAMPLER_STOP)
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: box.x + dx,
    y: box.y + dy,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  return sample
}

const HOME = await mkdtemp(join(tmpdir(), 'wfl-perf-home-'))
let env
let session
let failures = 0
try {
  env = await startShotsEnv({
    home: HOME,
    dataDir: join(HOME, 'data'),
    workspaceDir: join(HOME, 'ws'),
  })
  session = await openPage(CDP_HTTP)
  await session.send('Emulation.setLocaleOverride', { locale: BROWSER_LANGS[0] })
  await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(BROWSER_LANGS)} });
      Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(BROWSER_LANGS[0])} });`,
  })
  await installShotsCookie(session, env.base, env.cookie)

  console.log(`# 画布性能测量（lang=${LANG}，CDP=${CDP_HTTP}）`)
  console.log('量级 | 挂载ms | 拖拽fps | 拖拽p95 | 拖拽最长帧 | 平移fps | 平移p95 | 长任务>50ms')
  console.log('--- | --- | --- | --- | --- | --- | --- | ---')

  // 先建一张 1 节点的空白图并 boot 进去：之后每张夹具的「挂载」= 从空白图切过去的纯画布时间。
  await rpc('graph/create', { name: 'perf-blank' })
  await bootToCanvas(session, 'perf-blank', { lang: LANG, sessionTitle: SHOTS_SESSION_TITLE })

  /** 从当前图切到 name，量「点开 → 节点数到位」的画布时间；20 秒兜底（重连等异常返回 -1）。 */
  const mountGraphTimed = async (name) =>
    session.evaluate(`(async () => {
      const deadline = Date.now() + 20000;
      const t0 = performance.now();
      const trigger = document.querySelector('[data-testid="wl-switcher"]');
      if (!trigger) return -1;
      trigger.click();
      const option = await new Promise((resolve) => {
        const check = () => {
          const el = document.querySelector('[data-testid="wl-wf-item"][data-value=${JSON.stringify(name)}]');
          if (el !== null) resolve(el);
          else if (Date.now() > deadline) resolve(null);
          else setTimeout(check, 50);
        };
        check();
      });
      if (option === null) return -1;
      option.click();
      // 等「切换器标题已是这张图」+「画布上出现过节点」。**不能等节点数达到总数**：
      // 开视口剔除时视口外的节点不挂 DOM，数量永远小于总数。
      const ok = await new Promise((resolve) => {
        const check = () => {
          const label = (document.querySelector('[data-testid="wl-switcher"]')?.textContent || '').trim();
          const n = document.querySelectorAll('.react-flow__node').length;
          if ((label === ${JSON.stringify(name)} || n > 0) && n > 0) resolve(true);
          else if (Date.now() > deadline) resolve(false);
          else setTimeout(check, 16);
        };
        check();
      });
      if (!ok) return -1;
      // 再等两帧，让首屏排版落定（React Flow 量尺寸要一帧）。
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    })()`)

  for (const count of COUNTS) {
    const name = `perf-${count}`
    await rpc('graph/create', { name })
    const graph = buildFixtureGraph(count)
    const loaded = await rpc('graph/load', { name })
    await rpc('graph/save', {
      name,
      document: { ...graph, settings: loaded.document.settings },
      baseHash: loaded.hash,
    })

    const mountMs = await mountGraphTimed(name)

    // 开视口剔除时视口外的节点没有 DOM：拖「当前看得见」的那一个。
    const dragTarget = await session.evaluate(`(() => {
      const el = document.querySelector('.react-flow__node[data-id]');
      return el === null ? null : el.getAttribute('data-id');
    })()`)
    if (dragTarget === null) throw new Error('画布上没有可拖的节点')
    const drag = await dragNode(session, dragTarget, 120, 60, 40)
    await dragNode(session, dragTarget, -120, -60, 10) // 拖回去
    const pan = await panViewport(session, -160, -90, 40)
    await panViewport(session, 160, 90, 10)

    const long = [...drag.longTasks, ...pan.longTasks].filter((task) => task.ms > 50)
    const bad = drag.fps < 55 || pan.fps < 58 || mountMs > 2500 || long.length > 0
    if (bad) failures += 1
    console.log(
      `${count} | ${mountMs} | ${drag.fps} | ${drag.p95}ms | ${drag.worst}ms | ${pan.fps} | ${pan.p95}ms | ${long.length}${bad ? '  ⚠ 不达标' : ''}`,
    )
    const back = await mountGraphTimed('perf-blank')
    if (back === -1) console.log(`  （切回空白图超时，后面量级可能不准）`)
  }
  console.log(failures === 0 ? '✅ 全部达标' : `⚠ ${failures} 个量级不达标`)
  process.exitCode = failures === 0 ? 0 : 1
} finally {
  await env?.stop().catch(() => {})
  await rm(HOME, { recursive: true, force: true }).catch(() => {})
  // openPage 的 WebSocket 会让事件循环一直活着：关掉它，进程才会自然退出（stdout 也就刷完了）。
  session?.close()
}
