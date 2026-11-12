/**
 * Host half of `@local/dsh-session-panel`.
 *
 * - `sessionPanelOutputs` projection: files this Session wrote or edited
 *   (from its own tool calls), newest first — the panel's 「输出内容」.
 * - Authenticated routes (inside Connection's owner fence, same origin as the
 *   app, so the phone client works too):
 *     GET  /api/sessionPanel.vcs?root=<abs>[&root=<abs>…]
 *          every version-control provider that recognizes each root and how
 *          far the local working copy is from its remote;
 *     POST /api/sessionPanel.vcsFetch?root=<abs>&kind=git|svn
 *          same, after asking the remote (git fetch / svn status -u).
 *   Nothing here writes to the Session log.
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'
import { readAll, usableDir } from './vcs.js'

/** One line per Host apply, so a hot reload is verifiable from disk. */
const LOG_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'session-panel.log')

export const name = 'dsh-session-panel'
export const inject = ['connection', 'sessionProjections', 'tools']

const VCS_PATH = '/api/sessionPanel.vcs'
const VCS_FETCH_PATH = '/api/sessionPanel.vcsFetch'
/** GET: every MCP server row with its live state (no client API exposes this). */
const MCP_PATH = '/api/sessionPanel.mcp'
const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'
const MCP_TOOLS_LISTED = 40
const ROOTS_MAX = 8
const CACHE_MS = 4000
const OUTPUTS_MAX = 120

const WRITE_TOOLS = new Set(['write', 'write_file', 'create_file'])
const EDIT_TOOLS = new Set(['edit', 'multi_edit', 'apply_patch', 'str_replace', 'notebook_edit', 'edit_file'])

const pathFromArgs = (raw) => {
  if (raw !== null && typeof raw === 'object') {
    const value = raw.file_path ?? raw.path ?? raw.notebook_path
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  if (typeof raw !== 'string' || raw === '') return undefined
  if (raw.length <= 20000) {
    try {
      return pathFromArgs(JSON.parse(raw))
    } catch {}
  }
  const match = /"(?:file_path|path|notebook_path)"\s*:\s*"((?:[^"\\]|\\.){1,1000})"/u.exec(raw)
  if (match === null) return undefined
  try { return JSON.parse('"' + match[1] + '"') } catch { return match[1] }
}

const OUTPUTS_INIT = Object.freeze({ files: Object.freeze([]) })

/** Lenient schema: cached rows are re-normalized, never rejected. */
const outputsSchema = {
  parse(value) {
    if (value === null || typeof value !== 'object' || !Array.isArray(value.files)) return OUTPUTS_INIT
    const files = []
    for (const item of value.files) {
      if (item === null || typeof item !== 'object' || typeof item.path !== 'string') continue
      files.push({
        path: item.path,
        writes: Number.isFinite(item.writes) ? item.writes : 0,
        edits: Number.isFinite(item.edits) ? item.edits : 0,
        turn: Number.isFinite(item.turn) ? item.turn : null,
        at: Number.isFinite(item.at) ? item.at : null,
      })
      if (files.length >= OUTPUTS_MAX) break
    }
    return { files }
  },
}

/** Fold one event: a write/edit tool call moves its file to the front. */
const foldOutputs = (state, event) => {
  if (event === null || typeof event !== 'object' || event.type !== 'tool/call') return state
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
  const tool = typeof data.name === 'string' ? data.name : ''
  const isWrite = WRITE_TOOLS.has(tool)
  if (!isWrite && !EDIT_TOOLS.has(tool)) return state
  const path = pathFromArgs(data.arguments)
  if (path === undefined) return state
  const key = normalize(path)
  const previous = state.files.find((item) => normalize(item.path) === key)
  const next = {
    path,
    writes: (previous?.writes ?? 0) + (isWrite ? 1 : 0),
    edits: (previous?.edits ?? 0) + (isWrite ? 0 : 1),
    turn: Number.isFinite(data.turn) ? data.turn : previous?.turn ?? null,
    at: typeof event.time === 'number' ? event.time : previous?.at ?? null,
  }
  return { files: [next, ...state.files.filter((item) => normalize(item.path) !== key)].slice(0, OUTPUTS_MAX) }
}

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

export function apply(ctx) {
  try {
    writeFileSync(LOG_FILE, `[${new Date().toISOString()}] applied (session panel)\n`)
  } catch {}
  try {
    const registration = ctx.sessionProjections.register({
      key: 'sessionPanelOutputs',
      stateSchema: outputsSchema,
      init: () => OUTPUTS_INIT,
      apply: foldOutputs,
      wire: { viewSchema: outputsSchema, view: (state) => state, summary: false },
      stateVersion: 1,
    })
    if (registration !== undefined && typeof registration.catch === 'function') {
      registration.catch((error) => ctx.logger?.warn?.('session-panel: outputs projection failed: %o', error))
    }
  } catch (error) {
    ctx.logger?.warn?.('session-panel: outputs projection threw: %o', error)
  }

  /** Short cache + in-flight coalescing per (root, mode). */
  const cache = new Map()
  const readRoot = (root, fetchRemote, kind) => {
    const key = (fetchRemote ? 'fetch:' : '') + (kind ?? '*') + ':' + root
    const hit = cache.get(key)
    if (hit !== undefined && (hit.pending || Date.now() - hit.at < CACHE_MS) && !fetchRemote) return hit.promise
    const promise = readAll(root, { fetch: fetchRemote, kind }).then((providers) => ({ root, providers }))
    const entry = { at: Date.now(), pending: true, promise }
    cache.set(key, entry)
    promise.finally(() => {
      entry.pending = false
      entry.at = Date.now()
      if (fetchRemote) cache.delete(key)
    })
    if (cache.size > 64) {
      for (const [stale, value] of cache) if (!value.pending && Date.now() - value.at > CACHE_MS) cache.delete(stale)
    }
    return promise
  }

  const rootsOf = (request) => {
    const url = new URL(request.url)
    const roots = []
    for (const value of url.searchParams.getAll('root')) {
      const root = normalize(value)
      if (usableDir(root) && !roots.includes(root)) roots.push(root)
      if (roots.length >= ROOTS_MAX) break
    }
    return { roots, kind: url.searchParams.get('kind') ?? undefined }
  }

  ctx.connection.fetch.register({
    path: VCS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const { roots } = rootsOf(request)
      if (roots.length === 0) return json({ roots: [] })
      const results = await Promise.all(roots.map((root) => readRoot(root, false, undefined)))
      return json({ roots: results, at: Date.now() })
    },
  })

  /**
   * MCP health from what the Host can see: the loader row (disabled / failed /
   * active) and the server's registered `mcp__<server>__*` tools. An active row
   * with no tools is still connecting or retrying; the client offers reconnect
   * (plugin disable → enable) through the plugin manager with `entryId`.
   */
  const mcpServers = () => {
    let entries = []
    try {
      entries = [...ctx.loader.entries()]
    } catch {
      return []
    }
    let toolNames = []
    try {
      toolNames = ctx.tools.definitions().map((definition) => definition.name).filter((toolName) => typeof toolName === 'string')
    } catch {}
    const servers = []
    for (const entry of entries) {
      if (entry === null || entry === undefined || entry.options === undefined || entry.options.name !== MCP_MODULE) continue
      const config = entry.options.config !== null && typeof entry.options.config === 'object' ? entry.options.config : {}
      const serverName = typeof config.serverName === 'string' ? config.serverName : String(entry.id)
      const prefix = 'mcp__' + serverName + '__'
      const tools = toolNames.filter((toolName) => toolName.startsWith(prefix)).map((toolName) => toolName.slice(prefix.length))
      let fiberState
      try { fiberState = entry.fiber === undefined ? undefined : entry.fiber.state } catch {}
      const disabled = entry.disabled === true || entry.options.disabled === true
      const state = disabled
        ? 'disabled'
        : entry.fiber === undefined
          ? 'failed'
          // cordis fiber states: 0 pending, 1 loading, 2 active, 3 failed, 4 disposed, 5 unloading
          : fiberState === 3 || fiberState === 4
            ? 'failed'
            : fiberState !== 2
              ? 'starting'
              : tools.length > 0 ? 'connected' : 'retrying'
      servers.push({
        entryId: String(entry.id),
        serverName,
        transport: typeof config.transport === 'string' ? config.transport : null,
        target: typeof config.url === 'string' ? config.url : typeof config.command === 'string' ? [config.command, ...(Array.isArray(config.args) ? config.args : [])].join(' ').slice(0, 160) : null,
        state,
        toolCount: tools.length,
        tools: tools.slice(0, MCP_TOOLS_LISTED),
      })
    }
    servers.sort((a, b) => a.serverName.localeCompare(b.serverName))
    return servers
  }

  ctx.connection.fetch.register({
    path: MCP_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => Promise.resolve(json({ servers: mcpServers(), at: Date.now() })),
  })

  ctx.connection.fetch.register({
    path: VCS_FETCH_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const { roots, kind } = rootsOf(request)
      if (roots.length !== 1 || (kind !== 'git' && kind !== 'svn')) return json({ error: 'need exactly one root and kind=git|svn' }, 400)
      const result = await readRoot(roots[0], true, kind)
      for (const key of [...cache.keys()]) if (key.endsWith(':' + roots[0])) cache.delete(key)
      return json({ roots: [result], at: Date.now() })
    },
  })
}
