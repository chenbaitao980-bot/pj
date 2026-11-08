#!/usr/bin/env node
/**
 * 独立运行的本机 LLM 转发进程（由 dsh-artex 以 detached 方式拉起）。
 *
 *   node bin/llm-proxy.mjs --upstream https://host/base --port 56251 \
 *        --header "x-opencode-session=artex"
 *
 * 只做一件事：把请求转发到 upstream，并补上给定的请求头。
 */

import { startLlmProxy } from '../lib/llm-proxy.js'

const argv = process.argv.slice(2)
const opts = { upstream: '', port: 0, headers: {} }
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--upstream') opts.upstream = argv[++i]
  else if (token === '--port') opts.port = Number(argv[++i]) || 0
  else if (token === '--header') {
    const raw = String(argv[++i] || '')
    const idx = raw.indexOf('=')
    if (idx > 0) opts.headers[raw.slice(0, idx)] = raw.slice(idx + 1)
  }
}

if (!opts.upstream) {
  console.error('[llm-proxy] missing --upstream')
  process.exit(2)
}

try {
  const server = await startLlmProxy(opts)
  // 让父进程知道实际端口（父进程读这行）
  console.log(`[llm-proxy] listening ${server.url} -> ${opts.upstream}`)
  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} catch (err) {
  console.error(`[llm-proxy] failed: ${err?.message || err}`)
  process.exit(1)
}
