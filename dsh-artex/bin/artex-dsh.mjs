#!/usr/bin/env node
/**
 * dsh-artex 命令行：不经过 DSH 也能自测插件内核。
 *
 *   node bin/artex-dsh.mjs status
 *   node bin/artex-dsh.mjs doctor
 *   node bin/artex-dsh.mjs setup [clone|build|db|all]
 *   node bin/artex-dsh.mjs start|stop|logs [--lines 100] [--kind server]
 *   node bin/artex-dsh.mjs tools   # 打印插件注册的工具清单
 */

import { createArtex } from '../lib/artex.js'
import { apply } from '../lib/index.js'

const argv = process.argv.slice(2)
const cmd = (argv.shift() || 'status').toLowerCase()
const flags = {}
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token.startsWith('--')) {
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = true
    }
  }
}

const artex = createArtex({})

function print(result) {
  if (result && typeof result === 'object' && 'text' in result) {
    console.log(result.text)
    process.exitCode = result.ok === false ? 1 : 0
  } else {
    console.log(result)
  }
}

switch (cmd) {
  case 'status':
    print(artex.renderStatus(await artex.status()))
    break
  case 'doctor':
    print(await artex.doctor())
    break
  case 'setup':
    print(await artex.setup({ action: flags.action || argv[0] || 'all', force: flags.force === true }))
    break
  case 'start':
    print(await artex.start({ addr: flags.addr, dsn: flags.dsn }))
    break
  case 'stop':
    print(await artex.stop({}))
    break
  case 'logs':
    print(artex.logs({ lines: Number(flags.lines) || 200, kind: flags.kind || 'server' }))
    break
  case 'tools': {
    const registered = []
    const fakeCtx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      // 只取注册结果，不跑 disposer（否则会触发 shutdown 把服务停掉）
      effect: (fn) => {
        fn()
      },
      tools: { register: (def) => registered.push(def) },
    }
    await apply(fakeCtx, {})
    for (const def of registered) {
      console.log(`${def.name} — ${def.description}`)
    }
    break
  }
  default:
    console.error(`未知命令：${cmd}`)
    process.exitCode = 2
}
