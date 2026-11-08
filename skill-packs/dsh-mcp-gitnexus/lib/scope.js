/**
 * 按工作区决定插件是否启用（dsh 插件通用小工具，随包复制到各插件）。
 *
 * 三级配置，优先级从高到低：
 *   1. 工作区文件 `<项目根>/.dsh/plugins.json`
 *        { "trellis": { "enabled": false },
 *          "gitnexus": { "enabled": true, "autoInit": false },
 *          "*": { "enabled": true } }
 *   2. profile 里的按工作区覆盖
 *        config:
 *          workspaces:
 *            "D:/work/legacy": { "enabled": false }
 *       （按路径前缀匹配，最长前缀优先；大小写与斜杠已归一化）
 *   3. profile 里的全局默认（config.enabled / config.autoInit）
 *
 * 只用 node: 内置模块，读文件失败一律当「没配置」，不影响会话。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 本进程内按 mtime 缓存工作区配置文件，避免每步都读盘。 */
const cache = new Map();
const CACHE_LIMIT = 64;

/** 布尔归一化：字符串 "false" / 数字 0 也按 false 处理，避免 `if (scope.enabled)` 语义反转。 */
function asBool(value) {
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return !(v === 'false' || v === '0' || v === 'off' || v === 'no');
  }
  return value !== null && value !== undefined ? Boolean(value) : true;
}

/** 归一化路径：绝对路径、正斜杠、小写、去掉结尾斜杠（Windows 大小写不敏感）。 */
export function normalizePath(input) {
  try {
    return resolve(input).replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
  } catch {
    return String(input ?? '').replace(/\\/g, '/').toLowerCase();
  }
}

/** 读取工作区配置；文件不存在或解析失败返回 undefined。 */
export function readWorkspaceConfig(root) {
  let file;
  try { file = join(String(root ?? ''), '.dsh', 'plugins.json'); } catch { return undefined; }
  try {
    const info = statSync(file);
    const hit = cache.get(file);
    if (hit !== undefined && hit.mtimeMs === info.mtimeMs) return hit.value;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (cache.size > CACHE_LIMIT) cache.clear();
    cache.set(file, { mtimeMs: info.mtimeMs, value });
    return value;
  } catch {
    return undefined;
  }
}

/** 从 profile 的 workspaces 映射里挑最长前缀匹配。 */
export function pickWorkspaceOverride(config, root) {
  const map = config?.workspaces;
  if (map === undefined || map === null || typeof map !== 'object') return undefined;
  const target = normalizePath(root);
  let best;
  let bestLength = -1;
  for (const key of Object.keys(map)) {
    const value = map[key];
    if (value === null || typeof value !== 'object') continue;
    const prefix = normalizePath(key);
    if (prefix.length === 0) continue;
    if (target === prefix || target.startsWith(`${prefix}/`)) {
      if (prefix.length > bestLength) {
        best = value;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/**
 * 计算某个插件在某个工作区的有效配置。
 * @param {string} root 项目根（找不到项目时为工作目录）
 * @param {object} config 插件在 profile 里的配置
 * @param {string} key 工作区文件里的键，如 trellis / gitnexus / codegraph
 * @returns {{enabled: boolean, autoInit: boolean, source: string, kind: string}}
 */
export function resolveScope(root, config, key) {
  const workspaceFile = readWorkspaceConfig(root);
  const project = workspaceFile !== undefined && workspaceFile !== null && typeof workspaceFile === 'object'
    ? (workspaceFile[key] ?? workspaceFile['*'])
    : undefined;
  const workspace = pickWorkspaceOverride(config, root);

  const merged = {
    ...(workspace ?? {}),
    ...(project ?? {}),
  };

  let source = 'profile';
  if (workspace !== undefined) source = 'profile.workspaces';
  if (project !== undefined) source = 'workspace';

  return {
    enabled: asBool(merged.enabled ?? config?.enabled ?? true),
    autoInit: asBool(merged.autoInit ?? config?.autoInit ?? true),
    source,
    kind: typeof merged.kind === 'string' ? merged.kind : '',
  };
}
