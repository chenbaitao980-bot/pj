/**
 * 从 DSH 的 profile 补丁里解析「当前默认模型路由」，供 ARTEX 继承。
 *
 * 只读本机文件，不联网、不发请求。解析失败返回 { ok: false, reason }，
 * 调用方应原样退回插件自己的 llm 配置（不抛异常、不阻断启动）。
 *
 * 解析对象：
 *   $DSH_HOME/profiles/<profile>/cordis.patch.yml
 *     - id: agent-default-model   → provider / model
 *     - id: llm-pi-ai             → providers.<provider> → api / baseURL / apiKeyEnv
 *     - id: llm-deepseek          → baseURL（原生路由兜底）
 *
 * 不依赖第三方 YAML 库：只认这份补丁层的固定形状（顶层 `- id:` 块 + 缩进键值），
 * 换行符、BOM、行内注释、引号都能处理；`!!js` 表达式原样跳过。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 已知 pi-ai 路由的端点（DSH 内置目录里没写进补丁层时兜底）。 */
const KNOWN_BASE_URLS = {
  'opencode-go': 'https://opencode.ai/zen/go',
}

/** pi-ai 的 api 类型 → ARTEX 认的 provider。 */
function mapProvider(api) {
  const v = String(api || '').toLowerCase()
  if (!v) return ''
  if (v.startsWith('openai')) return 'openai'
  if (v.startsWith('anthropic')) return 'anthropic'
  return ''
}

function stripValue(raw) {
  let v = String(raw || '').trim()
  if (v === '' || v === '~' || v === 'null') return ''
  if (v.startsWith('!!js')) return ''
  const hash = v.search(/\s+#/)
  if (hash > 0) v = v.slice(0, hash).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  return v.trim()
}

/**
 * 把补丁层切成块：顶层（缩进 0）的 `- id: xxx` 开新块，块内按缩进还原 key 路径。
 * @returns {Array<{id: string, values: Record<string,string>}>}
 */
export function parsePatch(text) {
  const blocks = []
  let cur = null
  const stack = [] // [{ key, indent }]
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)

  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const indent = line.length - line.replace(/^\s*/, '').length

    const top = /^-\s+id:\s*(.+)$/.exec(line)
    if (top && indent === 0) {
      cur = { id: stripValue(top[1]), values: {} }
      blocks.push(cur)
      stack.length = 0
      continue
    }
    if (!cur) continue

    const kv = /^\s*([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]
    const value = stripValue(kv[2])

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()

    if (value === '') {
      stack.push({ key, indent })
      continue
    }
    const path = stack.map((s) => s.key).concat(key).join('.')
    cur.values[path] = value
  }
  return blocks
}

function mergeBlocks(blocks) {
  const merged = {}
  for (const b of blocks) {
    if (!b.id) continue
    merged[b.id] = Object.assign(merged[b.id] || {}, b.values)
  }
  return merged
}

export function dshHomeOf(env = process.env) {
  return env.DSH_HOME || join(env.USERPROFILE || env.HOME || homedir(), '.dsh')
}

/** 选 profile：显式 DSH_PROFILE > desktop > web > headless > 第一个有补丁层的。 */
export function pickProfile(home, env = process.env) {
  const root = join(home, 'profiles')
  const has = (n) => existsSync(join(root, n, 'cordis.patch.yml'))
  const explicit = String(env.DSH_PROFILE || '').trim()
  if (explicit && has(explicit)) return explicit
  for (const n of ['desktop', 'web', 'headless', 'tui']) if (has(n)) return n
  try {
    for (const n of readdirSync(root)) if (has(n)) return n
  } catch {}
  return null
}

/**
 * 解析出 DSH 当前默认模型路由。
 * @returns {{ok:boolean, provider?:string, model?:string, baseUrl?:string, apiKeyEnv?:string, source?:string, reason?:string}}
 */
export function resolveDshLlm(options = {}) {
  const env = options.env || process.env
  const home = options.home || dshHomeOf(env)
  const profile = options.profile || pickProfile(home, env)
  if (!profile) return { ok: false, reason: 'no-profile' }
  const file = join(home, 'profiles', profile, 'cordis.patch.yml')
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    return { ok: false, reason: `read-failed: ${err?.message || err}` }
  }

  const blocks = mergeBlocks(parsePatch(text))
  const def = blocks['agent-default-model'] || {}
  const pi = blocks['llm-pi-ai'] || {}
  const ds = blocks['llm-deepseek'] || {}

  /* 补丁层的值通常挂在 config 下，也允许直接写在块顶（两种都认）。 */
  const pick = (block, key) => String(block[`config.${key}`] ?? block[key] ?? '').trim()

  const route = pick(def, 'provider')
  const model = pick(def, 'model')
  if (!route) return { ok: false, reason: 'no-agent-default-model' }

  const readProvider = (key) =>
    String(pi[`config.providers.${route}.${key}`] ?? pi[`providers.${route}.${key}`] ?? '').trim()
  const baseUrl = readProvider('baseURL')
  const api = readProvider('api')
  const apiKeyEnv = readProvider('apiKeyEnv')

  let url = baseUrl
  if (!url) url = KNOWN_BASE_URLS[route] || ''
  /* 原生 deepseek 路由：补丁层里 llm-deepseek 的 baseURL 就是它的端点。 */
  if (!url && /deepseek/i.test(route)) url = pick(ds, 'baseURL')

  return {
    ok: true,
    provider: mapProvider(api) || 'anthropic',
    model,
    baseUrl: url,
    apiKeyEnv,
    route,
    api,
    source: `dsh:${profile}`,
    file,
  }
}

export default { resolveDshLlm, parsePatch, pickProfile, dshHomeOf }
