/**
 * dsh-artex 核心：把 ARTEX（Go + Next.js 自主渗透测试系统）的
 * 拉取 / 构建 / 数据库 / 启动 / 停止 / 日志 / 自检，收成一组可被 DSH 工具调用的函数。
 *
 * 设计约束：
 * - 只依赖 Node 标准库，插件本身不需要构建。
 * - 所有会失败的动作都返回 { ok, text, ... }，不向调用方抛异常（工具层直接透传）。
 * - 进程状态落在 <root>/.artex-runtime/：pid、日志、DSN、PostgreSQL 集群。
 * - 目标是「本机隔离环境自测」，不做任何外部目标操作。
 */

import { spawn } from 'node:child_process'
import { createServer, connect } from 'node:net'
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCredentials } from './api.js'
import { resolveDshLlm } from './inherit-llm.js'

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE_DIR = resolve(PLUGIN_DIR, '..')

/** 默认克隆源：上游已下线，按顺序回退到维护中的同源镜像。 */
export const DEFAULT_MIRRORS = [
  'https://github.com/jiwoochris/artex-global.git',
  'https://github.com/BaaRai/ARTEX.git',
  'https://github.com/Hinln/ARTEX.git',
  'https://github.com/RuoJi6/ARTEX.git',
  'https://github.com/Autumn-27/ARTEX.git',
]

export const DEFAULTS = {
  enabled: true,
  /** ARTEX 源码目录；空 = <工作区>/artex */
  root: '',
  /** 可执行文件；空 = <root>/artex(.exe) */
  binary: '',
  /** 运行时目录；空 = <root>/.artex-runtime */
  stateDir: '',
  /** 监听地址（前端 + API） */
  addr: '127.0.0.1:8787',
  /** 流量录制代理；空字符串 = 不启用 */
  proxy: '127.0.0.1:8788',
  /** 数据库连接串；空 = 用 .artex-runtime/dsn.txt 或本机自建集群 */
  dsn: '',
  /** PostgreSQL bin 目录；空 = 自动探测 */
  pgBin: '',
  /** 自建集群的端口；0 = 自动挑空闲端口 */
  pgPort: 0,
  /** 自检/启动时等待健康检查的毫秒数 */
  healthTimeoutMs: 90000,
  /** 构建超时（毫秒） */
  buildTimeoutMs: 1800000,
  /** 插件启动时自动拉起 ARTEX（默认关，避免拖慢宿主启动） */
  autoStart: false,
  /** 克隆源顺序 */
  mirrors: DEFAULT_MIRRORS,
  /** 管理员凭据：password 空 = 自动生成并写入 .artex-runtime/auth.json */
  auth: {
    username: 'ARTEX',
    password: '',
  },
  /**
   * LLM：启动时通过环境变量注入，省掉在 UI 里手填。
   * headers 非空时插件会先起一个本机转发，把缺的头补上。
   */
  llm: {
    enabled: true,
    /**
     * 继承 DSH 当前默认模型路由（provider / model / baseURL / apiKeyEnv）。
     * 只读 profile 的 cordis.patch.yml，不联网；插件自己显式写过的字段优先。
     * 关掉：llm.inherit: false，退回到下面这组硬默认值。
     */
    inherit: true,
    /**
     * 凭据热更新：宿主里换了 key / 供应商后，插件自动重启 ARTEX 让新凭据生效。
     * 关掉：llm.hotReload: false；调间隔：llm.watchIntervalMs（默认 15000，最小 5000）。
     */
    hotReload: true,
    watchIntervalMs: 15000,
    provider: 'anthropic',
    model: 'deepseek-v4.1-flash',
    baseUrl: 'https://opencode.ai/zen/go',
    apiKey: '',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
    apiKeyName: 'OPENCODE_GO_API_KEY',
    apiKeyFile: '',
    headers: {
      'x-opencode-session': 'artex',
    },
  },
}

const isWindows = process.platform === 'win32'

export function normalizeConfig(raw) {
  const cfg = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  for (const key of ['enabled', 'autoStart']) {
    if (typeof cfg[key] === 'string') cfg[key] = !/^(false|0|no|off)$/i.test(cfg[key].trim())
  }
  if (!Array.isArray(cfg.mirrors) || cfg.mirrors.length === 0) cfg.mirrors = DEFAULT_MIRRORS
  cfg.addr = String(cfg.addr || DEFAULTS.addr)
  cfg.proxy = cfg.proxy === null || cfg.proxy === undefined ? DEFAULTS.proxy : String(cfg.proxy)
  cfg.healthTimeoutMs = Number(cfg.healthTimeoutMs) || DEFAULTS.healthTimeoutMs
  cfg.buildTimeoutMs = Number(cfg.buildTimeoutMs) || DEFAULTS.buildTimeoutMs
  cfg.pgPort = Number(cfg.pgPort) || 0
  // 嵌套配置按字段合并，profile 里只写一项不会把默认值整块覆盖掉。
  cfg.auth = { ...DEFAULTS.auth, ...(cfg.auth && typeof cfg.auth === 'object' ? cfg.auth : {}) }
  cfg.llm = { ...DEFAULTS.llm, ...(cfg.llm && typeof cfg.llm === 'object' ? cfg.llm : {}) }
  /* 记住用户/配置里显式写过的字段：继承 DSH 路由时这些优先，不被覆盖。 */
  cfg.llm.explicitKeys = raw && raw.llm && typeof raw.llm === 'object' ? Object.keys(raw.llm) : []
  cfg.llm.headers =
    cfg.llm.headers && typeof cfg.llm.headers === 'object' ? { ...cfg.llm.headers } : {}
  return cfg
}

// ─────────────────────────────────────────────────────────── 基础工具

function abs(p) {
  if (!p) return ''
  return isAbsolute(p) ? p : resolve(WORKSPACE_DIR, p)
}

function exists(p) {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}

function listDir(p) {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

function tailFile(file, lines = 200) {
  try {
    const text = readFileSync(file, 'utf8')
    const all = text.split(/\r?\n/)
    return all.slice(Math.max(0, all.length - lines)).join('\n').trim()
  } catch {
    return ''
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 跑一个子进程，收集输出；不抛异常，用 exitCode 表达结果。 */
export function exec(cmd, args, opts = {}) {
  const {
    cwd,
    env,
    timeoutMs = 600000,
    input,
    capture = true,
  } = opts
  return new Promise((resolvePromise) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...(env || {}) },
        windowsHide: true,
        shell: false,
        // 守护型命令（pg_ctl start）会把 stdio 句柄交给自己拉起的 postgres：
        // 继续用管道会让 'close' 永远等不到 EOF，所以这类命令直接丢弃输出、只等退出码。
        stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'ignore', 'ignore'],
      })
    } catch (err) {
      resolvePromise({ ok: false, code: -1, stdout, stderr: String(err?.message || err) })
      return
    }
    let timer = null
    let timedOut = false
    const finish = (code) => {
      if (timer) clearTimeout(timer)
      resolvePromise({ ok: code === 0 && !timedOut, code, timedOut, stdout, stderr })
    }
    timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {}
      if (isWindows) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      }
    }, timeoutMs)
    child.stdout?.on('data', (b) => {
      stdout += b.toString()
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000)
    })
    child.stderr?.on('data', (b) => {
      stderr += b.toString()
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000)
    })
    child.on('error', (err) => {
      stderr += String(err?.message || err)
      finish(-1)
    })
    child.on('close', (code) => finish(code ?? -1))
    if (input !== undefined) {
      try {
        child.stdin?.end(input)
      } catch {}
    } else {
      try {
        child.stdin?.end()
      } catch {}
    }
  })
}

/** PATH 里找可执行文件（Windows 走 where，其余走 which）。 */
export async function which(name, extraDirs = []) {
  for (const dir of extraDirs.filter(Boolean)) {
    const candidate = join(dir, isWindows ? `${name}.exe` : name)
    if (exists(candidate)) return candidate
  }
  const res = await exec(isWindows ? 'where.exe' : 'which', [name], { timeoutMs: 8000 })
  if (res.ok) {
    const first = res.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (first) return first
  }
  return ''
}

export function portFree(port, host = '127.0.0.1') {
  return new Promise((resolvePromise) => {
    const srv = createServer()
    srv.once('error', () => resolvePromise(false))
    srv.once('listening', () => srv.close(() => resolvePromise(true)))
    srv.listen(port, host)
  })
}

function portOpen(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolvePromise) => {
    const sock = connect({ port, host })
    const done = (ok) => {
      sock.destroy()
      resolvePromise(ok)
    }
    sock.setTimeout(timeoutMs, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
  })
}

export function parseAddr(addr) {
  const text = String(addr || '').trim()
  const idx = text.lastIndexOf(':')
  if (idx < 0) return { host: '127.0.0.1', port: 8787 }
  const host = text.slice(0, idx) || '127.0.0.1'
  const port = Number(text.slice(idx + 1)) || 8787
  return { host: host === '0.0.0.0' ? '127.0.0.1' : host, port }
}

/** GET /api/health；ARTEX 的健康接口免登录。 */
export function probeHealth(addr, timeoutMs = 1500) {
  const { host, port } = parseAddr(addr)
  return new Promise((resolvePromise) => {
    const req = fetch(`http://${host}:${port}/api/health`, {
      signal: AbortSignal.timeout(Math.max(500, timeoutMs)),
    })
      .then(async (res) => {
        const body = await res.text()
        let json = null
        try {
          json = JSON.parse(body)
        } catch {}
        resolvePromise({ up: res.ok && json?.ok === true, status: res.status, body: json ?? body })
      })
      .catch(() => resolvePromise({ up: false, status: 0, body: null }))
    void req
  })
}

function pidFromNetstat(port) {
  return new Promise((resolvePromise) => {
    const cmd = isWindows ? 'netstat.exe' : 'lsof'
    const args = isWindows ? ['-ano'] : ['-ti', `tcp:${port}`, '-sTCP:LISTEN']
    exec(cmd, args, { timeoutMs: 8000 }).then((res) => {
      if (!res.ok) return resolvePromise(0)
      const line = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => isWindows ? l.includes(`:${port}`) && /LISTEN/i.test(l) : /^\d+$/.test(l))
      if (!line) return resolvePromise(0)
      const pid = isWindows ? Number(line.split(/\s+/).pop()) : Number(line)
      resolvePromise(Number.isFinite(pid) ? pid : 0)
    })
  })
}

async function killProcess(pid) {
  if (!pid) return { ok: false, text: 'no pid' }
  if (isWindows) {
    const res = await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 15000 })
    return { ok: res.ok, text: (res.stdout + res.stderr).trim() || `taskkill exit=${res.code}` }
  }
  const res = await exec('kill', ['-TERM', String(pid)], { timeoutMs: 10000 })
  return { ok: res.ok, text: (res.stdout + res.stderr).trim() || `kill exit=${res.code}` }
}

// ─────────────────────────────────────────────────────────── 实例

export function createArtex(rawConfig = {}) {
  const cfg = normalizeConfig(rawConfig)
  const root = abs(cfg.root) || join(WORKSPACE_DIR, 'artex')
  const binary = abs(cfg.binary) || join(root, isWindows ? 'artex.exe' : 'artex')
  const stateDir = abs(cfg.stateDir) || join(root, '.artex-runtime')
  const paths = {
    root,
    workspace: WORKSPACE_DIR,
    pluginDir: PLUGIN_DIR,
    binary,
    stateDir,
    logFile: join(stateDir, 'artex.log'),
    pidFile: join(stateDir, 'artex.pid'),
    llmProxyPidFile: join(stateDir, 'llm-proxy.pid'),
    llmProxyPortFile: join(stateDir, 'llm-proxy.port'),
    llmProxyLog: join(stateDir, 'llm-proxy.log'),
    dsnFile: join(stateDir, 'dsn.txt'),
    configFile: join(stateDir, 'config.json'),
    webOut: join(root, 'web', 'out'),
    webDist: join(root, 'server', 'webui', 'dist'),
    pgData: join(stateDir, 'pg', 'data'),
    pgLog: join(stateDir, 'pg', 'postgres.log'),
    buildLog: join(stateDir, 'build.log'),
    authFile: join(stateDir, 'auth.json'),
  }

  function ensureStateDir() {
    mkdirSync(paths.stateDir, { recursive: true })
  }

  // 只记「本进程亲手拉起的」pid：宿主退出时清理它自己的子进程，
  // 但不能把用户在命令行/别的宿主里起的 ARTEX 一起带走。
  let ownPid = 0
  let llmProxy = null

  /** 从 .env 或 DSH 的 .credentials.yaml 里取某个键（两种格式都按 key: value / key=value 匹配）。 */
  function readKeyFromFile(file, name) {
    if (!file || !name) return ''
    try {
      const text = readFileSync(file, 'utf8')
      const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*[:=]\\s*"?([^"\\r\\n]+)"?`, 'm').exec(text)
      return m ? m[1].trim() : ''
    } catch {
      return ''
    }
  }

  /**
   * 生效的 LLM 配置：插件显式字段 > DSH 当前默认路由 > 插件硬默认值。
   * 每次调用现读 profile 补丁层，所以「在 DSH 里换了供应商 → 重启 ARTEX 就跟着换」，
   * 不需要重启宿主。解析不出来时原样用插件配置，不阻断启动。
   */
  function effectiveLlm() {
    const base = cfg.llm || {}
    if (base.inherit === false || base.enabled === false) return base
    let inherited = null
    try {
      inherited = resolveDshLlm({ env: process.env })
    } catch {
      inherited = null
    }
    if (!inherited || inherited.ok !== true) {
      return { ...base, inheritReason: inherited && inherited.reason ? inherited.reason : 'inherit-failed' }
    }
    const explicit = new Set(Array.isArray(base.explicitKeys) ? base.explicitKeys : [])
    const next = { ...base }
    if (!explicit.has('provider') && inherited.provider) next.provider = inherited.provider
    if (!explicit.has('model') && inherited.model) next.model = inherited.model
    if (!explicit.has('baseUrl') && inherited.baseUrl) next.baseUrl = inherited.baseUrl
    if (!explicit.has('apiKeyEnv') && inherited.apiKeyEnv) {
      next.apiKeyEnv = inherited.apiKeyEnv
      next.apiKeyName = inherited.apiKeyEnv
    }
    next.inheritedFrom = inherited.source
    next.inheritedRoute = inherited.route
    return next
  }

  /**
   * 当前生效的 LLM 身份：key + provider + model + baseUrl。
   * 供热更新用——宿主里换了 key，插件据此判断要不要重启 ARTEX 让新 key 生效。
   */
  function llmIdentity() {
    const llm = effectiveLlm()
    return {
      key: resolveApiKey(),
      provider: String(llm.provider || ''),
      model: String(llm.model || ''),
      baseUrl: String(llm.baseUrl || ''),
      inheritedFrom: llm.inheritedFrom || '',
    }
  }

  /**
   * 找 LLM key。优先级（重要）：
   *   显式 apiKey > apiKeyFile > **当前 DSH_HOME 的 .credentials.yaml / .env**
   *   > 进程环境变量 > 工作区遗留 .env > ~/.dsh
   *
   * 为什么 DSH_HOME 要排在环境变量和工作区 .env 之前：
   * 用户在 DSH 里换 key 时写的是 `$DSH_HOME/.credentials.yaml`；而后台进程的 env、
   * 或项目里遗留的 `deepseek-harness/.dsh/.env` 可能还留着旧 key。
   * 旧逻辑让这两个先命中，就会出现「换了 key 但 ARTEX 还在用旧 key → 402 余额不足」。
   */
  function resolveApiKey() {
    const llm = effectiveLlm()
    if (!llm || llm.enabled === false) return ''
    if (llm.apiKey) return String(llm.apiKey).trim()

    const name = llm.apiKeyName || llm.apiKeyEnv
    const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')

    /* 第一优先级：当前 profile 的凭据文件（DSH 界面写的就是这里）。 */
    const primary = []
    if (llm.apiKeyFile) primary.push(abs(llm.apiKeyFile))
    if (home) primary.push(join(home, '.credentials.yaml'), join(home, '.env'))
    for (const file of primary) {
      const value = readKeyFromFile(file, name)
      if (value) return value
    }

    /* 第二优先级：进程环境变量。 */
    if (llm.apiKeyEnv && process.env[llm.apiKeyEnv]) return String(process.env[llm.apiKeyEnv]).trim()

    /* 第三优先级：工作区/用户目录的遗留位置。 */
    const legacy = [join(WORKSPACE_DIR, 'deepseek-harness', '.dsh', '.env')]
    const userHome = process.env.USERPROFILE || process.env.HOME || ''
    if (userHome) legacy.push(join(userHome, '.dsh', '.env'), join(userHome, '.dsh', '.credentials.yaml'))
    for (const file of legacy) {
      const value = readKeyFromFile(file, name)
      if (value) return value
    }
    return ''
  }

  /** 起一个本机转发（独立子进程，宿主退出不会带走它），把端点要求的自定义头补上。 */
  async function ensureLlmProxy() {
    const llm = effectiveLlm()
    if (!llm?.enabled || !llm.baseUrl) return ''
    const headers = llm.headers || {}
    if (Object.keys(headers).length === 0) return ''
    if (llmProxy) return llmProxy.url

    // 复用上一次留下的转发进程（宿主重启过也还在）。
    try {
      const pid = Number(readFileSync(paths.llmProxyPidFile, 'utf8').trim())
      const port = Number(readFileSync(paths.llmProxyPortFile, 'utf8').trim())
      if (pid && port && (await portOpen(port))) {
        llmProxy = { pid, port, url: `http://127.0.0.1:${port}` }
        return llmProxy.url
      }
    } catch {}

    let port = Number(llm.proxyPort) || 0
    if (!port) {
      port = 56251
      while (!(await portFree(port))) port += 1
    }

    const script = join(PLUGIN_DIR, 'bin', 'llm-proxy.mjs')
    const args = [script, '--upstream', String(llm.baseUrl), '--port', String(port)]
    for (const [k, v] of Object.entries(headers)) args.push('--header', `${k}=${v}`)
    const logFd = openSync(paths.llmProxyLog, 'a')
    let child
    try {
      child = spawn(process.execPath, args, {
        cwd: PLUGIN_DIR,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', logFd, logFd],
      })
      child.unref()
    } catch (err) {
      console.warn(`[dsh-artex] LLM 转发启动失败：${err?.message || err}`)
      return ''
    } finally {
      try {
        closeSync(logFd)
      } catch {}
    }
    for (let i = 0; i < 40; i += 1) {
      await sleep(200)
      if (await portOpen(port)) break
    }
    if (!(await portOpen(port))) {
      console.warn('[dsh-artex] LLM 转发没有监听成功，退回直连端点')
      return ''
    }
    writeFileSync(paths.llmProxyPidFile, String(child.pid), 'utf8')
    writeFileSync(paths.llmProxyPortFile, String(port), 'utf8')
    llmProxy = { pid: child.pid, port, url: `http://127.0.0.1:${port}` }
    return llmProxy.url
  }

  async function closeLlmProxy() {
    if (!llmProxy) return
    const p = llmProxy
    llmProxy = null
    if (p.pid) await killProcess(p.pid)
    try {
      rmSync(paths.llmProxyPidFile, { force: true })
      rmSync(paths.llmProxyPortFile, { force: true })
    } catch {}
  }

  function readDsn() {
    if (cfg.dsn) return String(cfg.dsn)
    if (process.env.ARTEX_PG_DSN) return process.env.ARTEX_PG_DSN
    try {
      return readFileSync(paths.dsnFile, 'utf8').trim()
    } catch {
      return ''
    }
  }

  function readPid() {
    try {
      const pid = Number(readFileSync(paths.pidFile, 'utf8').trim())
      return Number.isFinite(pid) && pid > 0 ? pid : 0
    } catch {
      return 0
    }
  }

  function pidAlive(pid) {
    if (!pid) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  function version() {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      if (pkg?.version) return String(pkg.version)
    } catch {}
    return ''
  }

  async function gitVersion() {
    if (!exists(join(root, '.git'))) return ''
    const res = await exec('git', ['-C', root, 'describe', '--tags', '--always'], { timeoutMs: 15000 })
    return res.ok ? res.stdout.trim() : ''
  }

  function isInstalled() {
    return exists(join(root, 'go.mod')) && exists(join(root, 'web')) && exists(join(root, 'cmd'))
  }

  function isBuilt() {
    if (!exists(paths.binary)) return false
    return listDir(paths.webDist).length > 0
  }

  async function status() {
    const health = await probeHealth(cfg.addr)
    const pid = readPid()
    const dsn = readDsn()
    const pg = parseAddr(cfg.addr)
    const dbPort = (() => {
      const m = /@[^/]*:(\d+)\//.exec(dsn || '')
      return m ? Number(m[1]) : 0
    })()
    return {
      ok: true,
      installed: isInstalled(),
      built: isBuilt(),
      running: health.up,
      url: `http://${pg.host}:${pg.port}`,
      pid: pidAlive(pid) ? pid : 0,
      version: (await gitVersion()) || version(),
      health: health.body,
      database: { dsn: maskDsn(dsn), reachable: dbPort ? await portOpen(dbPort) : false },
      paths,
    }
  }

  function renderStatus(st) {
    const lines = [
      `ARTEX 状态：${st.running ? '运行中' : '未运行'}`,
      `地址：${st.url}${st.running ? '' : '（未监听）'}`,
      `源码：${st.installed ? '已就位' : '缺失'}  ${st.paths.root}`,
      `构建：${st.built ? '已完成' : '未完成'}  ${st.paths.binary}`,
      `版本：${st.version || '未知'}`,
      `PID：${st.pid || '-'}`,
      `数据库：${st.database.dsn || '未配置'}（${st.database.reachable ? '可达' : '不可达'}）`,
    ]
    if (st.health && typeof st.health === 'object') {
      lines.push(`健康接口：ok=${st.health.ok} service=${st.health.service || '-'} version=${st.health.version || '-'}`)
    }
    if (!st.installed) lines.push('下一步：artex_setup(action="clone")')
    else if (!st.built) lines.push('下一步：artex_setup(action="build")')
    else if (!st.running) lines.push('下一步：artex_start')
    return lines.join('\n')
  }

  // ── 依赖探测 ───────────────────────────────────────────

  async function discoverPgBin() {
    const dirs = []
    if (cfg.pgBin) dirs.push(abs(cfg.pgBin))
    const initdb = await which('initdb')
    if (initdb) return dirname(initdb)
    const pgctl = await which('pg_ctl')
    if (pgctl) return dirname(pgctl)
    for (const base of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
      if (!exists(base)) continue
      const versions = listDir(base).sort((a, b) => Number(b) - Number(a))
      for (const v of versions) {
        const bin = join(base, v, 'bin')
        if (exists(join(bin, 'initdb.exe'))) dirs.push(bin)
      }
    }
    for (const dir of dirs) {
      if (exists(join(dir, isWindows ? 'initdb.exe' : 'initdb'))) return dir
    }
    return ''
  }

  async function doctor() {
    const checks = []
    const add = (name, ok, detail) => checks.push({ name, ok, detail })
    add('ARTEX 源码', isInstalled(), paths.root)
    add('ARTEX 构建产物', isBuilt(), paths.binary)

    const go = await which('go')
    const goVer = go ? (await exec(go, ['version'], { timeoutMs: 15000 })).stdout.trim() : ''
    add('Go 工具链', Boolean(go), go ? `${go} ${goVer}` : '未找到 go')

    const node = await which('node')
    add('Node.js', Boolean(node), node ? `${node} ${process.version}` : '未找到 node')

    const npm = await which(isWindows ? 'npm.cmd' : 'npm')
    add('npm', Boolean(npm), npm || '未找到 npm')

    const git = await which('git')
    add('Git', Boolean(git), git || '未找到 git')

    const pgBin = await discoverPgBin()
    const initdb = pgBin ? join(pgBin, isWindows ? 'initdb.exe' : 'initdb') : ''
    const pgCtl = pgBin ? join(pgBin, isWindows ? 'pg_ctl.exe' : 'pg_ctl') : ''
    add('PostgreSQL 工具', Boolean(pgBin), pgBin || '未找到 initdb/pg_ctl（可用 ARTEX_PG_DSN 指向现成库）')

    const dsn = readDsn()
    const m = /@[^/]*:(\d+)\//.exec(dsn || '')
    const dbOk = m ? await portOpen(Number(m[1])) : false
    add('数据库可达', dbOk, dsn ? maskDsn(dsn) : 'DSN 未配置')

    const health = await probeHealth(cfg.addr)
    add('ARTEX 服务', health.up, health.up ? `${cfg.addr} ok` : `${cfg.addr} 无响应`)

    const lines = [
      `ARTEX 自检（${isWindows ? 'Windows' : process.platform}，Node ${process.version}）`,
      ...checks.map((c) => `${c.ok ? '[OK]  ' : '[--]  '}${c.name}：${c.detail}`),
    ]
    const missing = checks.filter((c) => !c.ok).map((c) => c.name)
    lines.push(
      missing.length
        ? `待处理：${missing.join('、')}`
        : '全部就绪：artex_start 可直接启动。',
    )
    return { ok: missing.length === 0, checks, text: lines.join('\n') }
  }

  // ── 拉取 / 构建 / 数据库 ───────────────────────────────

  async function clone({ force = false } = {}) {
    if (isInstalled() && !force) {
      return { ok: true, text: `ARTEX 源码已存在：${paths.root}（已跳过克隆）` }
    }
    ensureStateDir()
    if (force && exists(paths.root)) {
      rmSync(paths.root, { recursive: true, force: true })
    }
    mkdirSync(dirname(paths.root), { recursive: true })
    const tried = []
    for (const url of cfg.mirrors) {
      tried.push(url)
      const res = await exec('git', ['clone', '--depth', '1', url, paths.root], {
        cwd: dirname(paths.root),
        timeoutMs: 900000,
      })
      if (res.ok && isInstalled()) {
        return { ok: true, text: `已从 ${url} 克隆到 ${paths.root}`, source: url, tried }
      }
      if (exists(paths.root)) rmSync(paths.root, { recursive: true, force: true })
    }
    return {
      ok: false,
      text: `全部源都失败：\n${tried.join('\n')}\n可改用同能力工具（DITING / Antifox / CodeScan-Artex），或手动放置源码到 ${paths.root}。`,
      tried,
    }
  }

  async function build({ force = false } = {}) {
    if (!isInstalled()) {
      return { ok: false, text: `源码不完整：${paths.root}。先跑 artex_setup(action="clone")。` }
    }
    ensureStateDir()
    writeFileSync(paths.buildLog, '', 'utf8')
    const log = (line) => appendFileSync(paths.buildLog, `${line}\n`, 'utf8')
    const steps = []

    const npm = (await which(isWindows ? 'npm.cmd' : 'npm')) || (await which('npm'))
    if (!npm) return { ok: false, text: '未找到 npm，无法构建前端。' }

    const webDir = join(root, 'web')
    if (!exists(join(webDir, 'node_modules')) || force) {
      log('[build] npm ci')
      const ci = await exec(npm, ['ci', '--include=dev', '--no-audit', '--no-fund'], {
        cwd: webDir,
        timeoutMs: cfg.buildTimeoutMs,
      })
      log(ci.stdout + ci.stderr)
      steps.push(`npm ci exit=${ci.code}`)
      if (!ci.ok) return { ok: false, text: `npm ci 失败：\n${tailFile(paths.buildLog, 60)}`, steps }
    } else {
      steps.push('npm ci 已就绪（跳过）')
    }

    // `npm run build:static` 的脚本体是 POSIX 写法（NEXT_EXPORT=1 next build），
    // Windows cmd 下不认；这里直接调 next 的可执行入口，跨平台一致。
    const nextBin = join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next')
    log('[build] next build (NEXT_EXPORT=1)')
    const webBuild = await exec(process.execPath, [nextBin, 'build'], {
      cwd: webDir,
      env: { NEXT_EXPORT: '1', NODE_ENV: 'production' },
      timeoutMs: cfg.buildTimeoutMs,
    })
    log(webBuild.stdout + webBuild.stderr)
    steps.push(`web build exit=${webBuild.code}`)
    if (!webBuild.ok || !exists(paths.webOut)) {
      return { ok: false, text: `前端构建失败：\n${tailFile(paths.buildLog, 80)}`, steps }
    }

    // 同步静态产物到 Go 的 embed 目录（先清空，避免嵌套 dist/dist）
    rmSync(paths.webDist, { recursive: true, force: true })
    mkdirSync(paths.webDist, { recursive: true })
    cpSync(paths.webOut, paths.webDist, { recursive: true })
    steps.push(`已同步前端产物 → ${paths.webDist}`)

    const go = await which('go')
    if (!go) return { ok: false, text: '未找到 go，跳过 Go 编译。', steps }
    const tag = (await gitVersion()) || 'v0.0.0-dsh'
    log(`[build] go build ${tag}`)
    const goBuild = await exec(
      go,
      ['build', '-tags', 'embedui', '-ldflags', `-X main.version=${tag}`, '-o', paths.binary, './cmd/artex'],
      { cwd: root, env: { CGO_ENABLED: '0' }, timeoutMs: cfg.buildTimeoutMs },
    )
    log(goBuild.stdout + goBuild.stderr)
    steps.push(`go build exit=${goBuild.code}`)
    if (!goBuild.ok || !exists(paths.binary)) {
      return { ok: false, text: `Go 编译失败：\n${tailFile(paths.buildLog, 80)}`, steps }
    }
    return {
      ok: true,
      text: [`构建完成：${paths.binary}`, ...steps, `日志：${paths.buildLog}`].join('\n'),
      steps,
    }
  }

  async function ensureDatabase({ port } = {}) {
    const existing = readDsn()
    if (existing) {
      const m = /@[^/]*:(\d+)\//.exec(existing)
      if (m && (await portOpen(Number(m[1])))) {
        return { ok: true, dsn: existing, text: `复用已有数据库：${maskDsn(existing)}` }
      }
    }
    const pgBin = await discoverPgBin()
    if (!pgBin) {
      return { ok: false, text: '未找到 PostgreSQL 工具链。安装 PostgreSQL，或用 artex_start(dsn="...") 指定现成库。' }
    }
    ensureStateDir()
    const initdb = join(pgBin, isWindows ? 'initdb.exe' : 'initdb')
    const pgCtl = join(pgBin, isWindows ? 'pg_ctl.exe' : 'pg_ctl')
    const createdb = join(pgBin, isWindows ? 'createdb.exe' : 'createdb')
    const user = 'artex'
    const dbname = 'artex'

    if (!exists(join(paths.pgData, 'PG_VERSION'))) {
      mkdirSync(dirname(paths.pgData), { recursive: true })
      const res = await exec(initdb, ['-D', paths.pgData, '-U', user, '--auth=trust', '--encoding=UTF8', '--locale=C'], {
        timeoutMs: 300000,
      })
      if (!res.ok) return { ok: false, text: `initdb 失败：\n${(res.stderr || res.stdout).slice(-2000)}` }
    }

    let chosen = Number(port) || cfg.pgPort || 0
    // 已经有一个本插件管着的集群在跑：直接复用它的端口，别去抢端口再重复启动。
    const pidFile = join(paths.pgData, 'postmaster.pid')
    if (exists(pidFile)) {
      const lines = readFileSync(pidFile, 'utf8').split(/\r?\n/)
      const runningPort = Number(lines[3])
      if (runningPort && (await portOpen(runningPort))) {
        const dsn = `postgres://${user}@127.0.0.1:${runningPort}/${dbname}?sslmode=disable`
        writeFileSync(paths.dsnFile, dsn, 'utf8')
        return { ok: true, dsn, port: runningPort, text: `复用已运行的本地 PostgreSQL：${dsn}` }
      }
    }
    if (!chosen) {
      chosen = 55460
      while (!(await portFree(chosen))) chosen += 1
    }
    const conf = join(paths.pgData, 'postgresql.conf')
    const marker = '# dsh-artex managed'
    let confText = exists(conf) ? readFileSync(conf, 'utf8') : ''
    const strip = confText
      .split(/\r?\n/)
      .filter((l) => !/^\s*(port|listen_addresses)\s*=/.test(l) && l !== marker)
      .join('\n')
    confText = `${strip}\n${marker}\nport = ${chosen}\nlisten_addresses = '127.0.0.1'\n`
    writeFileSync(conf, confText, 'utf8')

    if (!(await portOpen(chosen))) {
      const start = await exec(pgCtl, ['-D', paths.pgData, '-l', paths.pgLog, '-w', 'start'], {
        timeoutMs: 120000,
        capture: false,
      })
      if (!start.ok) {
        return { ok: false, text: `pg_ctl start 失败：exit=${start.code}\n${tailFile(paths.pgLog, 30)}` }
      }
    }
    const dsn = `postgres://${user}@127.0.0.1:${chosen}/${dbname}?sslmode=disable`
    await exec(createdb, ['-h', '127.0.0.1', '-p', String(chosen), '-U', user, dbname], { timeoutMs: 30000 })
    writeFileSync(paths.dsnFile, dsn, 'utf8')
    return { ok: true, dsn, port: chosen, text: `本地 PostgreSQL 就绪：${dsn}` }
  }

  async function setup({ action = 'all', force = false } = {}) {
    const steps = []
    if (action === 'clone' || action === 'all') {
      const c = await clone({ force })
      steps.push(c.text)
      if (!c.ok) return { ok: false, text: steps.join('\n') }
    }
    if (action === 'build' || action === 'all') {
      const b = await build({ force })
      steps.push(b.text)
      if (!b.ok) return { ok: false, text: steps.join('\n') }
    }
    if (action === 'db' || action === 'all') {
      const d = await ensureDatabase({})
      steps.push(d.text)
      if (!d.ok) return { ok: false, text: steps.join('\n') }
    }
    return { ok: true, text: steps.join('\n') }
  }

  // ── 启动 / 停止 / 日志 ─────────────────────────────────

  async function start({ addr, proxy, dsn, timeoutMs } = {}) {
    const useAddr = String(addr || cfg.addr)
    const useProxy = proxy === undefined ? cfg.proxy : String(proxy)
    const health = await probeHealth(useAddr)
    if (health.up) {
      return { ok: true, text: `ARTEX 已在运行：http://${parseAddr(useAddr).host}:${parseAddr(useAddr).port}` }
    }
    if (!isBuilt()) {
      return { ok: false, text: `构建产物缺失：${paths.binary}。先跑 artex_setup(action="build")。` }
    }
    // DSN 有值不代表库还活着：集群可能被结束进程树带走过。
    // 连不上就重新准备（ensureDatabase 会复用已有数据目录并重启集群）。
    const knownDsn = String(dsn || readDsn() || '')
    let useDsn = ''
    if (knownDsn) {
      const m = /@[^/]*:(\d+)\//.exec(knownDsn)
      if (m && (await portOpen(Number(m[1])))) useDsn = knownDsn
    }
    if (!useDsn) {
      const db = await ensureDatabase({})
      if (!db.ok) return { ok: false, text: `数据库未就绪：${db.text}` }
      useDsn = db.dsn
    }
    ensureStateDir()
    const dataDir = join(paths.stateDir, 'data')
    mkdirSync(dataDir, { recursive: true })

    const cfgJson = {
      database: useDsn ? { dsn: useDsn } : undefined,
      skill_dir: join(root, 'skills'),
      language: 'zh',
    }
    writeFileSync(paths.configFile, JSON.stringify(cfgJson, null, 2), 'utf8')

    const logFd = openSync(paths.logFile, 'a')
    const args = ['-addr', useAddr, '-data', dataDir]
    if (useProxy) args.push('-proxy', useProxy)

    // 管理员凭据：首次启动由 ARTEX_ADMIN_PASSWORD 直接初始化，省掉 /setup 手填；
    // setup token 固定下来，用户随时能在 auth.json 里查到。
    const creds = loadCredentials(paths.authFile)
    const llmEff = effectiveLlm()
    const llmKey = resolveApiKey()
    const proxiedBase = llmKey ? (await ensureLlmProxy()) || '' : ''
    const childEnv = {
      ...process.env,
      ARTEX_CONFIG: paths.configFile,
      ARTEX_PG_DSN: useDsn,
      ARTEX_SKILL_DIR: join(root, 'skills'),
      ARTEX_LANG: 'zh',
      ARTEX_ADMIN_PASSWORD: String(cfg.auth.password || creds.password),
      ARTEX_SETUP_TOKEN: String(creds.setupToken),
    }
    if (llmKey) {
      childEnv.ARTEX_LLM_PROVIDER = String(llmEff.provider || 'anthropic')
      childEnv.ARTEX_LLM_MODEL = String(llmEff.model || '')
      childEnv.ARTEX_LLM_BASE_URL = proxiedBase || String(llmEff.baseUrl || '')
      if (llmEff.provider === 'openai') childEnv.OPENAI_API_KEY = llmKey
      else childEnv.ANTHROPIC_API_KEY = llmKey
    }

    const child = spawn(paths.binary, args, {
      cwd: root,
      env: childEnv,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
    })
    child.unref()
    ownPid = child.pid
    try {
      closeSync(logFd)
    } catch {}
    writeFileSync(paths.pidFile, String(child.pid), 'utf8')

    const deadline = Date.now() + (Number(timeoutMs) || cfg.healthTimeoutMs)
    while (Date.now() < deadline) {
      await sleep(700)
      const h = await probeHealth(useAddr)
      if (h.up) {
        return {
          ok: true,
          text: [
            `ARTEX 已启动：http://${parseAddr(useAddr).host}:${parseAddr(useAddr).port}`,
            `PID：${child.pid}`,
            `管理员：ARTEX（密码在 ${paths.authFile}）`,
            `LLM：${llmKey ? `${llmEff.provider}/${llmEff.model}${proxiedBase ? `（经本机转发 ${proxiedBase}）` : ''}${llmEff.inheritedFrom ? `［继承 ${llmEff.inheritedFrom}］` : ''}` : '未配置（引擎会空闲）'}`,
            `日志：${paths.logFile}`,
          ].join('\n'),
        }
      }
      if (!pidAlive(child.pid)) break
    }
    const alive = pidAlive(child.pid)
    return {
      ok: false,
      text: [
        alive ? '进程在跑但健康检查未通过。' : '进程已退出。',
        `日志尾部：`,
        tailFile(paths.logFile, 40) || '(空)',
      ].join('\n'),
    }
  }

  async function stop({ port } = {}) {
    const pid = readPid() || (await pidFromNetstat(parseAddr(cfg.addr).port))
    if (!pid) {
      try {
        rmSync(paths.pidFile, { force: true })
      } catch {}
      return { ok: true, text: '没有找到运行中的 ARTEX 进程。' }
    }
    const res = await killProcess(pid)
    await sleep(800)
    try {
      rmSync(paths.pidFile, { force: true })
    } catch {}
    const health = await probeHealth(cfg.addr)
    await closeLlmProxy()
    return {
      ok: !health.up,
      text: health.up ? `停止失败，${cfg.addr} 仍有响应。${res.text}` : `已停止 ARTEX（pid=${pid}）。`,
    }
  }

  function logs({ lines = 200, kind = 'server' } = {}) {
    const file = kind === 'build' ? paths.buildLog : kind === 'pg' ? paths.pgLog : paths.logFile
    const text = tailFile(file, Number(lines) || 200)
    return { ok: true, text: text || `(日志为空或不存在：${file})`, file }
  }

  async function shutdown() {
    // 只清理本实例拉起的进程；别把 CLI 或另一个宿主起的 ARTEX 带走。
    const wasOurs = ownPid !== 0
    if (ownPid && pidAlive(ownPid)) {
      await killProcess(ownPid)
      if (readPid() === ownPid) {
        try {
          rmSync(paths.pidFile, { force: true })
        } catch {}
      }
    }
    ownPid = 0
    if (wasOurs) await closeLlmProxy()
  }

  return {
    config: cfg,
    paths,
    status,
    renderStatus,
    doctor,
    clone,
    build,
    setup,
    ensureDatabase,
    start,
    stop,
    logs,
    llmIdentity,
    shutdown,
    probe: () => probeHealth(cfg.addr),
  }
}

function maskDsn(dsn) {
  return String(dsn || '').replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1***@')
}
