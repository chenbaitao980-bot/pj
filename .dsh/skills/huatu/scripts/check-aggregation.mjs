#!/usr/bin/env node
// 聚合图排版自检（只读）：递归读取聚合图及其引用的画布，按“展开时真实占位”估算每个引用框，
// 报告同层引用框重叠、标题压框、文字溢出节点框、引用 id 在多个画布重复、每层元素数超 50。
// 用法：node check-aggregation.mjs --doc <document_id> --page <page_id>
import { fail, parseArgs, printJson, resolveConfig, runCommand } from './bridge.mjs';

const CARD = { width: 340, height: 120 };
const args = parseArgs(process.argv.slice(2));
if (typeof args.doc !== 'string' || typeof args.page !== 'string') fail('需要 --doc 与 --page（先运行 targets.mjs 确认精确目标）。');
const config = resolveConfig(args);

const pages = new Map();
async function load(documentId, pageId) {
  const key = `${documentId}::${pageId}`;
  if (!pages.has(key)) {
    const result = await runCommand(config, { type: 'read', target: { document_id: documentId, page_id: pageId } });
    pages.set(key, result.result ?? result);
  }
  return pages.get(key);
}
const sizeOf = (node) => ({
  width: node.size?.width ?? node.style?.width ?? node.data?.width ?? 150,
  height: node.size?.height ?? node.style?.height ?? node.data?.height ?? 56,
});
const union = (boxes) => boxes.length === 0 ? { x: 0, y: 0, width: 0, height: 0 } : (() => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
})();
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const round = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });

const issues = [];
const refOwners = new Map();

/**
 * Text nodes scale their font with the box (sqrt(area / 160x44), clamped 0.75..3) unless data.textScaleWithNode is
 * false, so a wide title box with font 22 renders at 66px and spills over what is below it. Estimate the lines the
 * label needs at the rendered size and compare with the box height.
 */
function textOverflow(node) {
  if (node.type !== 'text') return null;
  const { width, height } = sizeOf(node);
  const base = Number(node.data?.fontSize) || 16;
  const scale = node.data?.textScaleWithNode === false ? 1 : Math.max(0.75, Math.min(3, Math.sqrt((width * height) / (160 * 44))));
  const font = Math.round(base * scale);
  const lines = String(node.data?.label ?? '').split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(([...line].length * font) / Math.max(1, width - 16))), 0);
  const needed = Math.round(lines * font * 1.375 + 20);
  if (needed <= height) return null;
  return `渲染字号 ${font}px（设定 ${base}${scale !== 1 ? `，随框放大 ×${scale.toFixed(2)}` : ''}），约 ${lines} 行需高 ${needed}，框高只有 ${height}`;
}

/** Box of a page's content in its own coordinates, as mirrored (references expanded or folded as saved). */
async function contentBox(page, depth, trail) {
  const local = page.nodes.map((node) => ({ x: node.position.x, y: node.position.y, ...sizeOf(node), id: node.id }));
  const total = page.nodes.length + page.edges.length + (page.references ?? []).length + (page.crossGraphEdges ?? []).length;
  if (total > 50) issues.push(`「${page.name}」元素 ${total} 个，超过 50`);
  for (const node of page.nodes) {
    const overflow = textOverflow(node);
    if (overflow) issues.push(`「${page.name}」文字节点 ${node.id} 溢出：${overflow}；写 data.textScaleWithNode:false 并按行数给高度`);
  }
  // Relation line endpoints are a direct reference or a mirror path (`a>b`) into nested ones; each must reach a real node.
  for (const edge of page.crossGraphEdges ?? []) {
    for (const endpoint of [edge.source, edge.target]) {
      if (endpoint?.scope !== 'reference' || !endpoint.referenceId) continue;
      let owner = page;
      for (const id of endpoint.referenceId.split('>')) {
        const reference = (owner?.references ?? []).find((item) => item.id === id);
        owner = reference ? await load(reference.target.documentId, reference.target.pageId).catch(() => null) : null;
      }
      if (!owner) issues.push(`「${page.name}」连线 ${edge.id} 的端点路径 ${endpoint.referenceId} 找不到`);
      else if (!owner.nodes.some((node) => node.id === endpoint.objectId)) issues.push(`「${page.name}」连线 ${edge.id} 的端点 ${endpoint.referenceId}:${endpoint.objectId} 不存在`);
    }
  }
  const frames = [];
  for (const reference of page.references ?? []) {
    refOwners.set(reference.id, [...(refOwners.get(reference.id) ?? []), page.name]);
    const target = await load(reference.target.documentId, reference.target.pageId).catch(() => null);
    const px = reference.placement?.x ?? 0;
    const py = reference.placement?.y ?? 0;
    if (!target) { issues.push(`「${page.name}」引用 ${reference.id} 的目标读不到`); continue; }
    if (trail.includes(reference.target.pageId) || depth >= 6) continue;
    const inner = await contentBox(target, depth + 1, [...trail, reference.target.pageId]);
    const box = reference.collapsed
      ? { x: px + Math.min(0, inner.x) - 18, y: py + Math.min(0, inner.y) - 30, width: CARD.width + 36, height: CARD.height + 48 }
      : { x: px + inner.x - 18, y: py + inner.y - 30, width: inner.width + 36, height: inner.height + 48 };
    frames.push({ id: reference.id, label: reference.label ?? reference.id, collapsed: Boolean(reference.collapsed), box });
  }
  for (let i = 0; i < frames.length; i += 1) {
    for (let j = i + 1; j < frames.length; j += 1) {
      if (overlaps(frames[i].box, frames[j].box)) issues.push(`「${page.name}」引用框重叠：${frames[i].label}${frames[i].collapsed ? '(卡片)' : '(展开)'} 与 ${frames[j].label}${frames[j].collapsed ? '(卡片)' : '(展开)'}`);
    }
    for (const node of local) {
      if (overlaps(frames[i].box, node)) issues.push(`「${page.name}」本图节点 ${node.id} 压在引用框 ${frames[i].label} 上`);
    }
  }
  if (depth === 0) report.frames = frames.map((frame) => ({ id: frame.id, label: frame.label, collapsed: frame.collapsed, box: round(frame.box) }));
  return union([...local, ...frames.map((frame) => frame.box)]);
}

const report = {};
const root = await load(args.doc, args.page);
report.name = root.name;
report.bounds = round(await contentBox(root, 0, [args.page]));
for (const [id, owners] of refOwners) {
  if (new Set(owners).size > 1) issues.push(`引用 id ${id} 在 ${new Set(owners).size} 张画布里重复（${[...new Set(owners)].join('、')}），建议改成 <聚合图>:<目标>`);
}
report.issues = issues;
printJson({ ok: issues.length === 0, ...report });
