#!/usr/bin/env node
/**
 * DeepSeek Harness · Token 用量统计（离线，只读）
 *
 * 数据源：$DSH_HOME/storages/session_projcache/sessions/*.json
 *   - tokenUsage.val.totals : uncachedInputTokens / outputTokens / cacheReadTokens / cacheWriteTokens
 *   - modelSelection.val.lastUsed : provider / model
 *   - identity.cwd : 会话所属工作区
 *   - sessionStats.val : turns / steps
 *   - 文件 mtime : 最近活动时间（用于时间范围过滤与分桶）
 *
 * 用法：
 *   node usage-report.mjs                       # 默认 30 天，生成 usage-report.html
 *   node usage-report.mjs --range all --out D:\report.html
 *   node usage-report.mjs --json                # 只打印汇总 JSON
 *
 * 说明：一个会话只记「最后使用的 provider/model」，跨模型会话按最后一次归属；
 * 时间按会话文件 mtime 归桶，长会话会整体落在最后活动的时间桶里。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const DSH_HOME = argOf('home', process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const RANGE = argOf('range', '30d');
const OUT = argOf('out', join(process.cwd(), 'usage-report.html'));
const JSON_ONLY = has('json');

const RANGES = {
  '1h': 3600e3,
  '6h': 6 * 3600e3,
  '24h': 24 * 3600e3,
  '7d': 7 * 86400e3,
  '30d': 30 * 86400e3,
  '90d': 90 * 86400e3,
  '1y': 365 * 86400e3,
  all: Number.POSITIVE_INFINITY,
};

const BUCKET_BY_RANGE = {
  '1h': 'hour',
  '6h': 'hour',
  '24h': 'hour',
  '7d': 'day',
  '30d': 'day',
  '90d': 'day',
  '1y': 'month',
  all: 'month',
};

function decodeWorkspace(folder, cwd) {
  if (cwd && cwd.trim().length > 0) {
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || cwd;
  }
  // 形如 --E-claude-project4-pj--
  const body = folder.replace(/^-+|-+$/g, '');
  const segs = body.split('-').filter(Boolean).map((s) => {
    if (/^~[0-9A-F]{4}~?/i.test(s)) {
      try {
        return String.fromCharCode(...s.split('~').filter((x) => /^[0-9A-F]{4}$/i.test(x)).map((h) => parseInt(h, 16)));
      } catch {
        return s;
      }
    }
    return s;
  });
  return segs.slice(-1)[0] ?? folder;
}

function loadSessions() {
  const root = join(DSH_HOME, 'storages', 'session_projcache', 'sessions');
  let names = [];
  try {
    names = readdirSync(root).filter((n) => n.endsWith('.json'));
  } catch {
    console.error(`读不到投影缓存：${root}`);
    return [];
  }
  const sessions = [];
  for (const name of names) {
    const path = join(root, name);
    let doc;
    try {
      doc = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    const rec = doc?.record;
    if (!rec) continue;
    const usage = rec.rows?.tokenUsage?.val;
    if (!usage?.totals) continue;
    const t = usage.totals;
    const model = rec.rows?.modelSelection?.val?.lastUsed ?? {};
    const stats = rec.rows?.sessionStats?.val ?? {};
    let mtime = 0;
    try { mtime = statSync(path).mtimeMs; } catch { /* ignore */ }
    const cwd = rec.identity?.cwd ?? '';
    sessions.push({
      id: name.replace(/^session-|\.json$/g, ''),
      cwd,
      workspace: decodeWorkspace(cwd, cwd),
      createdAt: rec.identity?.createdAt ?? 0,
      lastActivity: mtime || rec.identity?.createdAt || 0,
      provider: model.provider ?? '(unknown)',
      model: model.model ?? '(unknown)',
      input: t.uncachedInputTokens ?? 0,
      output: t.outputTokens ?? 0,
      cacheRead: t.cacheReadTokens ?? 0,
      cacheWrite: t.cacheWriteTokens ?? 0,
      turns: stats.turns ?? 0,
      steps: stats.steps ?? 0,
      title: rec.rows?.title?.val ?? '',
    });
  }
  return sessions;
}

function bucketKey(ts, granularity) {
  const d = new Date(ts);
  if (granularity === 'hour') {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`;
  }
  if (granularity === 'day') {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const COLORS = ['#4F7CFF', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#06B6D4', '#EC4899', '#84CC16', '#F97316', '#64748B'];
const colorOf = (() => {
  const map = new Map();
  let i = 0;
  return (key) => {
    if (!map.has(key)) map.set(key, COLORS[i++ % COLORS.length]);
    return map.get(key);
  };
})();

function fmt(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function build(sessions, rangeKey) {
  const span = RANGES[rangeKey] ?? RANGES['30d'];
  const now = Date.now();
  const list = sessions.filter((s) => span === Number.POSITIVE_INFINITY || now - s.lastActivity <= span);
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, sessions: list.length, turns: 0, steps: 0 };
  const byProvider = new Map();
  const byModel = new Map();
  const byWorkspace = new Map();
  const granularity = BUCKET_BY_RANGE[rangeKey] ?? 'day';
  const buckets = new Map();

  for (const s of list) {
    const sum = s.input + s.output + s.cacheRead + s.cacheWrite;
    total.input += s.input;
    total.output += s.output;
    total.cacheRead += s.cacheRead;
    total.cacheWrite += s.cacheWrite;
    total.turns += s.turns;
    total.steps += s.steps;

    const add = (map, key) => {
      const row = map.get(key) ?? { key, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, sessions: 0 };
      row.input += s.input;
      row.output += s.output;
      row.cacheRead += s.cacheRead;
      row.cacheWrite += s.cacheWrite;
      row.total += sum;
      row.sessions += 1;
      map.set(key, row);
    };
    add(byProvider, s.provider);
    add(byModel, `${s.provider}/${s.model}`);
    add(byWorkspace, s.workspace);

    const stamp = s.createdAt > 0 ? s.createdAt : s.lastActivity;
    const bk = bucketKey(stamp, granularity);
    const bucket = buckets.get(bk) ?? { key: bk, byProvider: new Map(), total: 0 };
    bucket.byProvider.set(s.provider, (bucket.byProvider.get(s.provider) ?? 0) + sum);
    bucket.total += sum;
    buckets.set(bk, bucket);
  }

  const sorted = (map) => [...map.values()].sort((a, b) => b.total - a.total);

  // 补齐空桶，保证时间轴连续（否则只有"有数据的那几天"，看着像缺图）
  const filled = [];
  if (Number.isFinite(span)) {
    const stepMs = granularity === 'hour' ? 3600e3 : granularity === 'day' ? 86400e3 : 0;
    if (stepMs > 0) {
      const start = now - span;
      const seen = new Set(buckets.keys());
      for (let t = start; t <= now + stepMs; t += stepMs) {
        const key = bucketKey(t, granularity);
        if (seen.has(key)) continue;
        seen.add(key);
        buckets.set(key, { key, byProvider: new Map(), total: 0 });
      }
    } else {
      // 月粒度：从起点月补到当前月
      const start = new Date(now - span);
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const seen = new Set(buckets.keys());
      while (cursor.getTime() <= now) {
        const key = bucketKey(cursor.getTime(), 'month');
        if (!seen.has(key)) { seen.add(key); buckets.set(key, { key, byProvider: new Map(), total: 0 }); }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
  }
  for (const b of buckets.values()) filled.push(b);

  return {
    range: rangeKey,
    generatedAt: new Date().toISOString(),
    granularity,
    total: { ...total, all: total.input + total.output + total.cacheRead + total.cacheWrite },
    providers: sorted(byProvider),
    models: sorted(byModel),
    workspaces: sorted(byWorkspace),
    buckets: filled.sort((a, b) => (a.key < b.key ? -1 : 1)).map((b) => ({ key: b.key, total: b.total, byProvider: Object.fromEntries(b.byProvider) })),
    sessions: list.map((s) => ({ id: s.id, workspace: s.workspace, provider: s.provider, model: s.model, at: s.lastActivity, total: s.input + s.output + s.cacheRead + s.cacheWrite, title: s.title })),
  };
}

function stackedBar(report) {
  const { buckets } = report;
  if (buckets.length === 0) return '<p class="empty">这个时间范围内没有会话。</p>';
  const providers = [...new Set(buckets.flatMap((b) => Object.keys(b.byProvider)))];
  const max = Math.max(...buckets.map((b) => b.total), 1);
  const W = 980, H = 320, padL = 64, padB = 46, padT = 16;
  const innerW = W - padL - 16, innerH = H - padT - padB;
  const bw = Math.max(2, Math.min(48, innerW / buckets.length - 6));
  const step = innerW / Math.max(buckets.length, 1);
  let bars = '';
  buckets.forEach((b, i) => {
    const x = padL + i * step + (step - bw) / 2;
    let y = padT + innerH;
    for (const p of providers) {
      const v = b.byProvider[p] ?? 0;
      if (v <= 0) continue;
      const h = (v / max) * innerH;
      y -= h;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${colorOf(p)}"><title>${b.key} · ${p} · ${fmt(v)}</title></rect>`;
    }
    const label = b.key.length > 10 ? b.key.slice(5) : b.key;
    if (buckets.length <= 24 || i % Math.ceil(buckets.length / 16) === 0) {
      bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - padB + 16}" class="tick" text-anchor="middle">${label}</text>`;
    }
  });
  const grid = [0, 0.25, 0.5, 0.75, 1].map((r) => {
    const y = padT + innerH * (1 - r);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - 16}" y2="${y.toFixed(1)}" class="grid"/><text x="${padL - 8}" y="${(y + 4).toFixed(1)}" class="tick" text-anchor="end">${fmt(max * r)}</text>`;
  }).join('');
  const legend = providers.map((p) => `<span class="lg"><i style="background:${colorOf(p)}"></i>${p}</span>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}</svg><div class="legend">${legend}</div></div>`;
}

function pie(rows, valueKey = 'total') {
  const data = rows.slice(0, 8);
  const sum = data.reduce((a, r) => a + r[valueKey], 0);
  if (sum <= 0) return '<p class="empty">没有数据。</p>';
  const R = 110, C = 130;
  let angle = -Math.PI / 2;
  let paths = '';
  for (const row of data) {
    const frac = row[valueKey] / sum;
    const next = angle + frac * Math.PI * 2;
    const x1 = C + R * Math.cos(angle), y1 = C + R * Math.sin(angle);
    const x2 = C + R * Math.cos(next), y2 = C + R * Math.sin(next);
    const large = frac > 0.5 ? 1 : 0;
    paths += `<path d="M${C},${C} L${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${colorOf(row.key)}"><title>${row.key} · ${fmt(row[valueKey])} · ${(frac * 100).toFixed(1)}%</title></path>`;
    angle = next;
  }
  const legend = data.map((r) => `<li><i style="background:${colorOf(r.key)}"></i><span class="k">${r.key}</span><b>${(r[valueKey] / sum * 100).toFixed(1)}%</b><span class="v">${fmt(r[valueKey])}</span></li>`).join('');
  return `<div class="pie"><svg viewBox="0 0 260 260" role="img">${paths}</svg><ul class="pielegend">${legend}</ul></div>`;
}

function table(rows) {
  if (rows.length === 0) return '<p class="empty">没有数据。</p>';
  const body = rows.map((r) => `<tr><td>${r.key}</td><td class="num">${fmt(r.input)}</td><td class="num">${fmt(r.output)}</td><td class="num">${fmt(r.cacheRead)}</td><td class="num">${fmt(r.total)}</td><td class="num">${r.sessions}</td></tr>`).join('');
  return `<table><thead><tr><th>厂商 / 模型</th><th class="num">未缓存输入</th><th class="num">输出</th><th class="num">缓存命中</th><th class="num">合计</th><th class="num">会话</th></tr></thead><tbody>${body}</tbody></table>`;
}

const sessions = loadSessions();
const report = build(sessions, RANGE);

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const rangeTabs = Object.keys(RANGES).map((k) => `<a class="tab${k === RANGE ? ' on' : ''}" href="#" data-range="${k}">${k === 'all' ? '总共' : '最近 ' + k}</a>`).join('');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DSH Token 用量 · ${RANGE}</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--fg:#e7eaf0;--muted:#8b93a7;--accent:#4F7CFF}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "Microsoft YaHei UI",system-ui,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:24px 20px 60px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 12px;color:var(--muted);font-weight:600}
.sub{color:var(--muted);font-size:12px}
.tabs{display:flex;gap:8px;margin:18px 0}.tab{padding:6px 12px;border:1px solid var(--line);border-radius:999px;color:var(--muted);text-decoration:none}
.tab.on{background:var(--accent);border-color:var(--accent);color:#fff}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.card .k{color:var(--muted);font-size:12px}.card .v{font-size:22px;font-weight:700;margin-top:6px}
.chart,.pie{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}
svg{width:100%;height:auto;display:block}.grid{stroke:#262b36;stroke-width:1}.tick{fill:#8b93a7;font-size:11px}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;color:var(--muted);font-size:12px}
.lg i,.pielegend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:middle}
.pie{display:flex;gap:16px;align-items:center}.pie svg{width:260px;flex:0 0 260px}
.pielegend{list-style:none;padding:0;margin:0;flex:1;min-width:220px}
.pielegend li{display:grid;grid-template-columns:14px 1fr auto auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)}
.pielegend .k{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pielegend b{font-weight:600}.pielegend .v{color:var(--muted);font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;font-size:13px}
th{color:var(--muted);font-weight:600;background:#12151b}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.empty{color:var(--muted)}
</style></head><body><div class="wrap">
<h1>DeepSeek Harness · Token 用量</h1>
<div class="sub">数据源 ${DSH_HOME}\\storages\\session_projcache　·　生成于 ${new Date(report.generatedAt).toLocaleString('zh-CN')}　·　会话数 ${report.total.sessions}</div>
<div class="tabs" id="tabs">${rangeTabs}</div>
<div class="cards">
  <div class="card"><div class="k">合计 Token</div><div class="v">${fmt(report.total.all)}</div></div>
  <div class="card"><div class="k">未缓存输入</div><div class="v">${fmt(report.total.input)}</div></div>
  <div class="card"><div class="k">输出</div><div class="v">${fmt(report.total.output)}</div></div>
  <div class="card"><div class="k">缓存命中</div><div class="v">${fmt(report.total.cacheRead)}</div></div>
  <div class="card"><div class="k">会话 / 轮 / 步</div><div class="v">${report.total.sessions} / ${report.total.turns} / ${report.total.steps}</div></div>
</div>
<h2>按时间分布（${report.granularity === 'hour' ? '每小时' : report.granularity === 'day' ? '每天' : '每月'}，按厂商堆叠）</h2>
${stackedBar(report)}
<h2>工作区占比</h2>
${pie(report.workspaces)}
<h2>厂商 / 模型明细</h2>
${table(report.models)}
<script>
const RANGES = ${JSON.stringify(Object.keys(RANGES))};
document.getElementById('tabs').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-range]'); if (!a) return;
  e.preventDefault();
  location.hash = a.dataset.range;
  location.reload();
});
if (location.hash) { const r = location.hash.slice(1); if (RANGES.includes(r)) location.search = '?range=' + r; }
</script>
</div></body></html>`;

writeFileSync(OUT, html, 'utf8');
console.log(`range=${RANGE} sessions=${report.total.sessions} total=${fmt(report.total.all)} (input ${fmt(report.total.input)} / output ${fmt(report.total.output)} / cacheRead ${fmt(report.total.cacheRead)})`);
for (const p of report.providers) console.log(`  provider ${p.key}: ${fmt(p.total)} (${p.sessions} sessions)`);
for (const w of report.workspaces.slice(0, 5)) console.log(`  workspace ${w.key}: ${fmt(w.total)}`);
console.log(`HTML: ${OUT}`);
