#!/usr/bin/env node
/**
 * 自测：不依赖 DSH 宿主，验证插件内核与工具契约。
 *
 *   node test/smoke.mjs            # 状态 + 自检 + 工具注册
 *   node test/smoke.mjs --with-build   # 额外跑构建（很慢）
 */

import assert from 'node:assert/strict'
import { createArtex } from '../lib/artex.js'
import { apply } from '../lib/index.js'

const withBuild = process.argv.includes('--with-build')
const artex = createArtex({})
const results = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// 1) 内核状态
const st = await artex.status()
record('status: 源码已就位', st.installed === true, st.paths.root)
record('status: 路径解析', st.paths.root.endsWith('artex'), st.paths.root)

// 2) 工具注册 + 工具执行
const registered = []
const registeredCommands = []
const fakeCtx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  // 不执行 disposer：apply() 里挂了 shutdown 清理，自测不该顺手把正在跑的服务停掉。
  effect: (fn) => {
    fn()
  },
  tools: { register: (def) => registered.push(def) },
  inject: (names, cb) => {
    if (!names.includes('commands')) return
    cb({
      effect: (fn) => {
        fn()
      },
      commands: { register: (spec) => registeredCommands.push(spec) },
    })
  },
}
await apply(fakeCtx, {})
const names = registered.map((d) => d.name).sort()
const expected = [
  'artex_doctor',
  'artex_logs',
  'artex_setup',
  'artex_start',
  'artex_status',
  'artex_stop',
  'artex_task',
]
record('注册 7 个工具', JSON.stringify(names) === JSON.stringify(expected), names.join(', '))

const artexCmd = registeredCommands.find((c) => c.name === 'artex')
record('注册斜杠命令 /artex', Boolean(artexCmd))
if (artexCmd) {
  const helpOut = await artexCmd.handler({ rawInput: 'help' })
  record('/artex help 有输出', helpOut.kind === 'success' && helpOut.text.includes('status'))
  const cmdStatus = await artexCmd.handler({ rawInput: 'status' })
  record('/artex status 可执行', cmdStatus.text.includes('ARTEX 状态'), cmdStatus.text.split('\n')[0])
  const runEmpty = await artexCmd.handler({ rawInput: 'run' })
  record('/artex run 缺参数时报用法', runEmpty.kind === 'error' && runEmpty.text.includes('用法'))

  // 服务在跑时，顺带验证任务面命令真的能打通 API（只列任务，不建）。
  const health = await artex.probe()
  if (health.up) {
    const listOut = await artexCmd.handler({ rawInput: 'tasks' })
    record('/artex tasks 可执行', listOut.kind === 'success', listOut.text.split('\n')[0])
  }
}

const statusTool = registered.find((d) => d.name === 'artex_status')
const statusOut = await statusTool.execute({})
record('artex_status 可执行', typeof statusOut.text === 'string' && statusOut.text.includes('ARTEX 状态'), statusOut.text.split('\n')[0])

const doctorTool = registered.find((d) => d.name === 'artex_doctor')
const doctorOut = await doctorTool.execute({})
record('artex_doctor 可执行', doctorOut.text.includes('ARTEX 自检'))

const logsTool = registered.find((d) => d.name === 'artex_logs')
const logsOut = await logsTool.execute({ lines: 5 })
record('artex_logs 可执行', typeof logsOut.text === 'string')

// 3) 输出契约：只返回 { text }。只跑只读工具——artex_start/stop 会真的动服务，
//    默认自测不该把正在跑的 ARTEX 停掉。
const readonly = registered.filter((d) => ['artex_status', 'artex_doctor', 'artex_logs'].includes(d.name))
for (const def of readonly) {
  const out = await def.execute(def.name === 'artex_logs' ? { lines: 5 } : {})
  assert.deepEqual(Object.keys(out), ['text'], `${def.name} 的输出必须是 { text }`)
}
record('只读工具输出契约一致（仅 text）', true)

const lifecycle = process.argv.includes('--with-lifecycle')
if (lifecycle) {
  const start = await registered.find((d) => d.name === 'artex_start').execute({})
  record('artex_start 可执行', start.text.includes('已启动') || start.text.includes('已在运行'), start.text.split('\n')[0])
  const stop = await registered.find((d) => d.name === 'artex_stop').execute({})
  record('artex_stop 可执行', stop.text.includes('已停止') || stop.text.includes('没有找到'), stop.text.split('\n')[0])
}

// 4) 可选的耗时验证
if (withBuild) {
  const build = await registered.find((d) => d.name === 'artex_setup').execute({ action: 'build' })
  record('构建可执行', build.text.includes('构建完成') || build.text.includes('失败'), build.text.split('\n')[0])
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exitCode = failed.length ? 1 : 0
