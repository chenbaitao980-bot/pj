#!/usr/bin/env node
/**
 * 把一个画布作用域（项目）里的建模表和记录复制到另一个画布作用域，原画布的数据只读不动。
 * 仅在用户明确要求整表副本时使用；聚合图默认按业务归属分布记录并绑定对应节点和连线。
 *
 * 用法：node copy-models.mjs --from <源项目ID> --to <目标项目ID> [--name <目标项目名>]
 * 项目 ID 是 `proj-<文档ID>`（主页面）；先用 tool 的 modeling_read 读到 project_id。
 * 直接调后端 REST（默认 http://127.0.0.1:18000，可用 PM_BACKEND 覆盖），不需要命令桥，也不受“只能有一个编辑器窗口”限制。
 * 幂等：目标里已有同名建模就跳过，已有记录就不重复复制。字段（含枚举选项、附件字段）用 copy_from_model_id 原样带过去；
 * 子表关系和父子记录会重映射；完成后逐表核对记录数。附件文件按文件名共享，不复制文件本身。
 */
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const BASE = process.env.PM_BACKEND || 'http://127.0.0.1:18000';
const SRC = arg('from');
const DST = arg('to');
const DST_NAME = arg('name') || DST;
if (!SRC || !DST || SRC === DST) {
  console.error('用法：node copy-models.mjs --from <源项目ID> --to <目标项目ID> [--name <目标项目名>]');
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function allRecords(mid) {
  const out = [];
  for (let page = 1; ; page += 1) {
    const r = await api('GET', `/api/models/${mid}/records?limit=200&page=${page}`);
    out.push(...r.items);
    if (out.length >= r.total || r.items.length === 0) break;
  }
  return out;
}

await api('POST', '/api/projects', { id: DST, name: DST_NAME, status: '进行中' });
const srcModels = (await api('GET', `/api/projects/${SRC}/models`)).filter((m) => m.type !== 'template').sort((a, b) => a.order - b.order);
const dstModels = await api('GET', `/api/projects/${DST}/models`);
const idMap = new Map();
const report = [];

// 1. 建模表（字段用 copy_from_model_id 原样复制，枚举选项和附件字段随之带过去）
for (const m of srcModels) {
  const existing = dstModels.find((d) => d.name === m.name);
  if (existing) { idMap.set(m.id, existing.id); report.push(`skip model ${m.name} (already there)`); continue; }
  const created = await api('POST', `/api/projects/${DST}/models`, { name: m.name, icon: m.icon, description: m.description, order: m.order, type: m.type, copy_from_model_id: m.id });
  idMap.set(m.id, created.id);
  report.push(`model ${m.name}: ${created.fields.length}/${m.fields.length} fields`);
}
// 2. 子表关系
for (const m of srcModels) {
  const children = (m.child_model_ids || []).map((id) => idMap.get(id)).filter(Boolean);
  if (children.length) await api('PATCH', `/api/models/${idMap.get(m.id)}`, { child_model_ids: children });
}
// 3. 记录（父记录先建，再重映射 parent_record_id）
const recMap = new Map();
let copied = 0;
let skipped = 0;
for (const m of srcModels) {
  const dstId = idMap.get(m.id);
  const have = await allRecords(dstId);
  if (have.length > 0) { skipped += have.length; report.push(`skip records of ${m.name} (${have.length} already there)`); continue; }
  const recs = await allRecords(m.id);
  const pending = [...recs];
  let guard = 0;
  while (pending.length && guard++ < 10) {
    for (let i = 0; i < pending.length;) {
      const r = pending[i];
      const parent = r.parent_record_id ? recMap.get(r.parent_record_id) : undefined;
      if (r.parent_record_id && !parent && recs.some((x) => x.id === r.parent_record_id)) { i += 1; continue; }
      const body = { type: r.type || '', values: r.values || {}, order: r.order, start_date: r.start_date, end_date: r.end_date, assignee_ids: r.assignee_ids || [], ...(parent ? { parent_record_id: parent } : {}) };
      const created = await api('POST', `/api/models/${dstId}/records`, body);
      recMap.set(r.id, created.id);
      copied += 1;
      pending.splice(i, 1);
    }
  }
}
console.log(report.join('\n'));
console.log(`records copied: ${copied}, already present: ${skipped}`);

// 4. 逐表核对记录数
let ok = true;
for (const m of srcModels) {
  const a = (await allRecords(m.id)).length;
  const b = (await allRecords(idMap.get(m.id))).length;
  if (a !== b) { ok = false; console.log(`MISMATCH ${m.name}: source ${a}, copy ${b}`); }
}
console.log(ok ? 'verified: every model has the same number of records as the original' : 'verification failed');
process.exit(ok ? 0 : 1);
