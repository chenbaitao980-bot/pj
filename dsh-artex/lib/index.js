/**
 * dsh-artex — host 半。
 *
 * 把 ARTEX（Go + Next.js 的 LLM 多智能体自主渗透测试系统）接进 DSH：
 * 注册一组模型可见工具，负责把它拉下来、编译、建本地库、启停、看日志、自检。
 *
 * 本插件不执行任何扫描/利用动作，只管理本机隔离环境的进程与构建产物；
 * 具体测试行为由 ARTEX 自己的 agent 在用户给定的范围内执行。
 *
 * @module dsh-artex
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createApi, saveCredentials } from './api.js'
import { createArtex, normalizeConfig, parseAddr } from './artex.js'

export const name = 'dsh-artex'

/** 工具注册是插件的存在理由；别的服务都按需注入。 */
export const inject = ['tools']

const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
}

function tool(name, description, parameters, run) {
  return {
    name,
    description,
    parameters,
    output: TEXT_OUTPUT,
    async execute(args) {
      const value = await run(args || {})
      return { text: String(value?.text ?? '') }
    },
  }
}

const COMMAND_HELP = [
  '/artex run <任务说明>       新建任务并让 ARTEX 的 agent 开跑',
  '/artex tasks               最近任务与状态',
  '/artex task <id>           任务详情',
  '/artex pause|resume <id>   暂停 / 恢复任务',
  '/artex status              安装/构建/运行/数据库状态',
  '/artex start|stop|restart  启停服务',
  '/artex logs [行数] [server|build|pg]',
  '/artex setup [clone|build|db|all]',
  '/artex login <密码>        更新本地管理员密码',
  '/artex doctor              依赖链自检',
].join('\n')

function idOf(task) {
  return String(task?.id ?? task?.ID ?? task?.exp_id ?? '')
}

function nameOf(task) {
  return String(task?.name || task?.description || task?.goal || '(未命名)')
}

function statusOf(task) {
  return String(task?.status || task?.state || '')
}

function taskLink(artex, id) {
  const { host, port } = parseAddr(artex.config.addr)
  return `http://${host}:${port}/function/tasks/detail?id=${encodeURIComponent(id)}`
}

function renderTaskList(tasks, artex) {
  if (!tasks.length) return '还没有任务。用 /artex run <任务说明> 建一个。'
  const lines = tasks.slice(0, 15).map((t) => {
    const id = idOf(t)
    const st = statusOf(t)
    return `#${id}  [${st || '-'}]  ${nameOf(t)}`
  })
  lines.push('', `详情页：http://${parseAddr(artex.config.addr).host}:${parseAddr(artex.config.addr).port}/function/tasks`)
  return lines.join('\n')
}

/** 起服务（没起就拉起来）→ 确认引擎有 LLM → 建任务。 */
async function runTask(artex, api, text, opts = {}) {
  const goal = String(text || '').trim()
  if (!goal) return { ok: false, text: '用法：/artex run <任务目标/说明>' }

  const st = await artex.status()
  if (!st.running) {
    const started = await artex.start({})
    if (!started.ok) return { ok: false, text: started.text }
  }

  const stats = await api.stats()
  if (!stats.ok) return { ok: false, text: `读取 ARTEX 状态失败：${stats.error}` }
  const body = stats.body || {}
  if (body.llm_configured === false) {
    return {
      ok: false,
      text: [
        'ARTEX 引擎还没有可用的 LLM，任务建了也不会开跑。',
        '插件默认会注入 OpenCode Go（llm.apiKeyFile 指向 .env）；没生效就：',
        '  1) 确认 profile 配置里 dsh-artex.llm.apiKeyFile / apiKey 指向有效的 key',
        '  2) /artex restart',
        '也可以直接在 http://127.0.0.1:8787 的设置 → LLM 里配。',
      ].join('\n'),
    }
  }

  const res = await api.createTask({
    name: opts.name || goal.slice(0, 40),
    description: goal,
    goal,
  })
  if (!res.ok) return { ok: false, text: `建任务失败：${res.error}` }
  const task = res.task || {}
  const id = idOf(task)
  return {
    ok: true,
    text: [
      `任务已创建#${id}：${nameOf(task) || goal.slice(0, 40)}`,
      'ARTEX 的 planner/worker 会自己拆目标、跑工具、把资产和漏洞记进图。',
      `看进度：${taskLink(artex, id)}`,
    ].join('\n'),
  }
}

/** 斜杠命令：/artex <子命令>，直接对宿主执行，不产生模型消息。 */
function commandSpec(artex, api) {
  return {
    name: 'artex',
    description: 'ARTEX 控制台：run | tasks | task | pause | resume | status | start | stop | logs | setup | login | help',
    input: {
      hint: 'run <任务说明> | tasks | task <id> | pause|resume <id> | status | start|stop|restart | logs [行数] [server|build|pg] | setup [all] | login <密码>',
    },
    async handler(invocation) {
      const raw = String(invocation?.rawInput ?? '').trim()
      const [sub, ...rest] = raw.split(/\s+/).filter(Boolean)
      const action = (sub || 'status').toLowerCase()
      const restText = raw.slice(sub ? sub.length : 0).trim()
      try {
        switch (action) {
          case 'help':
            return { kind: 'success', text: COMMAND_HELP }

          // —— 任务面：让 ARTEX 的 agent 真正开工 ——
          case 'run': {
            const res = await runTask(artex, api, restText)
            return { kind: res.ok ? 'success' : 'error', text: res.text }
          }
          case 'tasks': {
            const res = await api.listTasks()
            if (!res.ok) return { kind: 'error', text: `读取任务失败：${res.error}` }
            return { kind: 'success', text: renderTaskList(res.tasks, artex) }
          }
          case 'task': {
            const id = rest[0]
            if (!id) return { kind: 'error', text: '用法：/artex task <id>' }
            const res = await api.getTask(id)
            if (!res.ok) return { kind: 'error', text: `读取任务失败：${res.error}` }
            const t = res.task || {}
            return {
              kind: 'success',
              text: [
                `#${idOf(t)}  ${nameOf(t)}`,
                `状态：${statusOf(t) || '-'}`,
                `详情：${taskLink(artex, id)}`,
              ].join('\n'),
            }
          }
          case 'pause':
          case 'resume': {
            const id = rest[0]
            if (!id) return { kind: 'error', text: `用法：/artex ${action} <id>` }
            const res = await api.controlTask(id, action)
            return res.ok
              ? { kind: 'success', text: `任务 #${id} 已${action === 'pause' ? '暂停' : '恢复'}。` }
              : { kind: 'error', text: `${action} 失败：${res.error}` }
          }

          // —— 环境面 ——
          case 'status': {
            const st = await artex.status()
            return { kind: 'success', text: artex.renderStatus(st) }
          }
          case 'doctor': {
            const res = await artex.doctor()
            return { kind: res.ok ? 'success' : 'error', text: res.text }
          }
          case 'start': {
            const res = await artex.start({})
            return { kind: res.ok ? 'success' : 'error', text: res.text }
          }
          case 'stop': {
            const res = await artex.stop({})
            return { kind: res.ok ? 'success' : 'error', text: res.text }
          }
          case 'restart': {
            const stopped = await artex.stop({})
            const started = await artex.start({})
            return {
              kind: started.ok ? 'success' : 'error',
              text: `${stopped.text}\n${started.text}`,
            }
          }
          case 'logs': {
            const lines = Number(rest[0]) || 60
            const kind = ['server', 'build', 'pg'].includes(rest[1]) ? rest[1] : 'server'
            const res = artex.logs({ lines, kind })
            return { kind: 'success', text: res.text }
          }
          case 'setup': {
            const step = ['clone', 'build', 'db', 'all'].includes(rest[0]) ? rest[0] : 'all'
            const res = await artex.setup({ action: step })
            return { kind: res.ok ? 'success' : 'error', text: res.text }
          }
          case 'login': {
            const password = restText
            if (!password) return { kind: 'error', text: '用法：/artex login <管理员密码>' }
            saveCredentials(artex.paths.authFile, { password })
            const res = await api.login(true)
            return res.ok
              ? { kind: 'success', text: '已更新本地管理员密码并登录成功。' }
              : { kind: 'error', text: `登录失败：${res.error}` }
          }
          default:
            return { kind: 'error', text: `未知子命令：${action}\n\n${COMMAND_HELP}` }
        }
      } catch (err) {
        return { kind: 'error', text: `ARTEX 命令失败：${err?.message || err}` }
      }
    },
  }
}

/**
 * LLM 凭据指纹：key + provider + model + baseUrl。
 * 只存指纹不存明文，避免把密钥写进日志。
 */
function llmFingerprint(id) {
  const raw = [id?.key || '', id?.provider || '', id?.model || '', id?.baseUrl || ''].join('\u0000')
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

/**
 * LLM 凭据热更新：宿主里换了 key / 供应商，插件自动重启 ARTEX 让新凭据生效。
 *
 * 为什么必须重启：ARTEX 是独立进程，`ANTHROPIC_API_KEY` 在 spawn 时注入；
 * 只改 `.credentials.yaml` 不重启，跑着的进程还是旧 key。
 *
 * 开关：`llm.hotReload: false` 关闭；`llm.watchIntervalMs` 调轮询间隔（默认 15s，最小 5s）。
 *
 * @returns 清理函数（供 ctx.effect 注销）
 */
function startLlmKeyWatcher({ artex, cfg, logger }) {
  if (cfg?.llm?.hotReload === false) return () => {}
  const intervalMs = Math.max(5000, Number(cfg?.llm?.watchIntervalMs) || 15000)

  let last = ''
  try {
    last = llmFingerprint(artex.llmIdentity())
  } catch {
    last = ''
  }
  let busy = false
  let stopped = false

  const timer = setInterval(async () => {
    if (stopped || busy) return
    let id
    try {
      id = artex.llmIdentity()
    } catch {
      return
    }
    if (!id || !id.key) return
    const fp = llmFingerprint(id)
    if (fp === last) return

    busy = true
    const prev = last
    last = fp
    try {
      logger?.info?.(`[dsh-artex] LLM 凭据变更 ${prev || '(空)'} → ${fp}，重启 ARTEX 以加载新 key`)
      await artex.stop({})
      const res = await artex.start({})
      logger?.info?.(`[dsh-artex] 新凭据重启${res?.ok ? '成功' : '失败'}：${String(res?.text || '').split('\n')[0]}`)
    } catch (err) {
      logger?.warn?.(`[dsh-artex] 凭据热更新重启失败：${err?.message || err}`)
    } finally {
      busy = false
    }
  }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()

  logger?.info?.(`[dsh-artex] LLM 凭据监视已启动（${intervalMs}ms，指纹 ${last || '(空)'}）`)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

/**
 * @param ctx - host 插件上下文。
 * @param config - profile patch 里的配置行。
 */
export async function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  const artex = createArtex(cfg)
  const { host, port } = parseAddr(cfg.addr)
  const api = createApi({
    base: `http://${host}:${port}`,
    credentialsFile: artex.paths.authFile,
  })

  ctx.effect(() => () => artex.shutdown(), 'dsh-artex: runtime')
  /* 宿主里换 key / 换供应商后，自动重启 ARTEX 让新凭据生效（不再需要手动 stop+start）。 */
  ctx.effect(
    () => startLlmKeyWatcher({ artex, cfg, logger: ctx.logger }),
    'dsh-artex: llm-key-watcher',
  )

  const tools = [
    tool(
      'artex_status',
      '查看 ARTEX 在本机的安装/构建/运行状态：地址、PID、版本、数据库连通性，并给出下一步建议。',
      { type: 'object', additionalProperties: false, properties: {} },
      async () => {
        const st = await artex.status()
        return { text: artex.renderStatus(st) }
      },
    ),
    tool(
      'artex_doctor',
      '检查 ARTEX 依赖链：源码、构建产物、Go/Node/npm/Git、PostgreSQL 工具与数据库可达性、服务健康。',
      { type: 'object', additionalProperties: false, properties: {} },
      async () => artex.doctor(),
    ),
    tool(
      'artex_setup',
      '拉取并准备 ARTEX：action=clone 从镜像克隆源码，build 编译前端+Go 二进制，db 建本地 PostgreSQL 集群，all 全做。耗时较长。',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['clone', 'build', 'db', 'all'], description: '要执行的步骤' },
          force: { type: 'boolean', description: 'clone/build 是否强制重做' },
        },
        required: ['action'],
      },
      async (args) => artex.setup({ action: args.action || 'all', force: args.force === true }),
    ),
    tool(
      'artex_start',
      '启动 ARTEX 服务（Go 单二进制，前端已内嵌）。未配置数据库时会自动准备本地 PostgreSQL；启动后返回访问地址。',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          addr: { type: 'string', description: '监听地址，如 127.0.0.1:8787' },
          proxy: { type: 'string', description: '流量录制代理地址，空字符串关闭' },
          dsn: { type: 'string', description: 'PostgreSQL DSN，覆盖本地集群' },
          timeoutMs: { type: 'number', description: '等待健康检查的毫秒数' },
        },
      },
      async (args) => artex.start(args),
    ),
    tool(
      'artex_stop',
      '停止 ARTEX 服务进程（含子进程树）。',
      { type: 'object', additionalProperties: false, properties: {} },
      async () => artex.stop({}),
    ),
    tool(
      'artex_logs',
      '读取 ARTEX 运行日志（kind=server 服务日志、build 构建日志、pg 数据库日志）。',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          lines: { type: 'number', description: '返回末尾多少行，默认 200' },
          kind: { type: 'string', enum: ['server', 'build', 'pg'], description: '日志类别' },
        },
      },
      async (args) => artex.logs({ lines: args.lines || 200, kind: args.kind || 'server' }),
    ),
    tool(
      'artex_task',
      '在 ARTEX 上新建/查看/暂停/恢复自主测试任务。action=create 时把目标与范围写进 description/goal，ARTEX 的 planner/worker 会自己开工。',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'list', 'get', 'pause', 'resume'],
            description: 'create 建任务并开跑；list 列最近任务；get 看详情；pause/resume 需要 id',
          },
          description: { type: 'string', description: '任务说明：目标、允许的范围、限制（只填自己有权测试的资产）' },
          goal: { type: 'string', description: '任务目标，缺省同 description' },
          name: { type: 'string', description: '任务名，缺省取 description 前 40 字' },
          id: { type: 'string', description: 'pause/resume/get 用的任务 id' },
        },
        required: ['action'],
      },
      async (args) => {
        const action = String(args.action || 'list')
        if (action === 'create') {
          return runTask(artex, api, args.description || args.goal || '', { name: args.name })
        }
        if (action === 'list') {
          const res = await api.listTasks()
          return res.ok ? { text: renderTaskList(res.tasks, artex) } : { text: `读取任务失败：${res.error}` }
        }
        if (action === 'get') {
          if (!args.id) return { text: '缺少 id' }
          const res = await api.getTask(args.id)
          if (!res.ok) return { text: `读取任务失败：${res.error}` }
          const t = res.task || {}
          return { text: `#${idOf(t)}  ${nameOf(t)}\n状态：${statusOf(t) || '-'}\n详情：${taskLink(artex, args.id)}` }
        }
        if (action === 'pause' || action === 'resume') {
          if (!args.id) return { text: '缺少 id' }
          const res = await api.controlTask(args.id, action)
          return { text: res.ok ? `任务 #${args.id} 已${action === 'pause' ? '暂停' : '恢复'}。` : `${action} 失败：${res.error}` }
        }
        return { text: `未知 action：${action}` }
      },
    ),
  ]

  for (const def of tools) {
    ctx.effect(() => ctx.tools.register(def), `dsh-artex: tool ${def.name}`)
  }

  // 斜杠命令：/artex …。commands 服务是 UI 侧能力，缺它不影响工具。
  // 先走 ctx.get('commands')（与 dsh-purge 同一条路，桌面宿主里已验证可用），
  // 拿不到再退回 ctx.inject 等它挂上来。
  const commands = []
  const spec = commandSpec(artex, api)
  const tryRegister = (registry) => {
    for (const cmdName of [spec.name, `${spec.name}-cmd`]) {
      try {
        registry.register({ ...spec, name: cmdName })
        commands.push(cmdName)
        return true
      } catch (err) {
        if (!/already registered/i.test(String(err?.message || err))) {
          ctx.logger?.warn?.(`[dsh-artex] 注册 /${cmdName} 失败：${err?.message || err}`)
          return false
        }
      }
    }
    return false
  }
  const liveCommands = typeof ctx.get === 'function' ? ctx.get('commands') : undefined
  if (liveCommands?.register) {
    ctx.effect(() => {
      tryRegister(liveCommands)
      return () => {}
    }, 'dsh-artex: command /artex')
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['commands'], (commandsCtx) => {
      commandsCtx.effect(() => {
        tryRegister(commandsCtx.commands)
        return () => {}
      }, 'dsh-artex: command /artex')
    })
  }

  if (cfg.autoStart) {
    ctx.logger?.info?.('[dsh-artex] autoStart 开启，尝试拉起 ARTEX')
    artex.start({}).then(
      (res) => ctx.logger?.info?.(`[dsh-artex] ${res.text}`),
      (err) => ctx.logger?.warn?.(`[dsh-artex] 启动失败：${err?.message || err}`),
    )
  }

  // 落一份装载回执：宿主启动后可直接核对「插件被加载、工具已注册」，
  // 不依赖模型是否调用、也不依赖宿主日志级别。
  try {
    mkdirSync(artex.paths.stateDir, { recursive: true })
    writeFileSync(
      join(artex.paths.stateDir, 'plugin-loaded.json'),
      JSON.stringify(
        {
          plugin: name,
          loadedAt: new Date().toISOString(),
          pid: process.pid,
          tools: tools.map((t) => t.name),
          commands,
          root: artex.paths.root,
          addr: cfg.addr,
        },
        null,
        2,
      ),
      'utf8',
    )
  } catch (err) {
    ctx.logger?.warn?.(`[dsh-artex] 写装载回执失败：${err?.message || err}`)
  }

  ctx.logger?.info?.(
    `[dsh-artex] 已注册 ${tools.length} 个工具${commands.length ? ` + /${commands.join(' /')}` : ''}（root=${artex.paths.root}）`,
  )
}
