/**
 * 极简反向代理：给 Anthropic/OpenAI 兼容端点补上自定义请求头。
 *
 * 用途：某些聚合端点（例如 OpenCode Go）强制要求 `x-opencode-session`，
 * 而 ARTEX 的 LLM 客户端不会发。插件在本机起一个转发，把这几个头补上，
 * API key 仍然由 ARTEX 自己带在请求里，不经过磁盘。
 */

import http from 'node:http'
import https from 'node:https'

export function startLlmProxy({ upstream, headers = {}, port = 0 }) {
  const target = new URL(upstream)
  const prefix = target.pathname.replace(/\/$/, '')

  const server = http.createServer((req, res) => {
    let url
    try {
      url = new URL(`${target.origin}${prefix}${req.url}`)
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `bad upstream url: ${err?.message || err}` }))
      return
    }
    const mod = url.protocol === 'https:' ? https : http
    const forwarded = { ...req.headers, ...headers, host: url.host }
    const proxyReq = mod.request(
      url,
      { method: req.method, headers: forwarded },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      },
    )
    proxyReq.on('error', (err) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: `upstream: ${err?.message || err}` }))
    })
    req.pipe(proxyReq)
  })

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address()?.port || port
      resolvePromise({
        url: `http://127.0.0.1:${actual}`,
        port: actual,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}
