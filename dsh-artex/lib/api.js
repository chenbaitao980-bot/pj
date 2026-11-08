/**
 * ARTEX HTTP API 客户端（插件侧）。
 *
 * 只覆盖 DSH 里用得上的几个面：登录、任务增查、任务暂停/恢复、运行时就绪状态。
 * token 不落盘到日志；密码与 setup token 由 .artex-runtime/auth.json 管理。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'

const USERNAME = 'ARTEX'

function nowIso() {
  return new Date().toISOString()
}

/** 读取/初始化本地凭据：管理员密码 + 固定 setup token。 */
export function loadCredentials(file) {
  let data = {}
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      data = {}
    }
  }
  let changed = false
  if (!data.username) {
    data.username = USERNAME
    changed = true
  }
  if (!data.password || String(data.password).length < 8) {
    data.password = randomBytes(12).toString('base64url')
    changed = true
  }
  if (!data.setupToken || String(data.setupToken).length !== 32) {
    data.setupToken = randomBytes(16).toString('hex')
    changed = true
  }
  if (!data.createdAt) {
    data.createdAt = nowIso()
    changed = true
  }
  if (changed) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  }
  return data
}

export function saveCredentials(file, patch) {
  const current = loadCredentials(file)
  const next = { ...current, ...patch }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}

async function request(base, path, { method = 'GET', token, body, timeoutMs = 20000 } = {}) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
    })
  } catch (err) {
    return { ok: false, status: 0, error: `连不上 ARTEX（${base}）：${err?.message || err}` }
  }
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const message = json?.error || json?.message || text.slice(0, 300) || `HTTP ${res.status}`
    return { ok: false, status: res.status, error: message, body: json }
  }
  return { ok: true, status: res.status, body: json ?? text }
}

export function createApi({ base, credentialsFile }) {
  let token = ''
  let tokenAt = 0

  function baseUrl() {
    return String(base).replace(/\/$/, '')
  }

  async function authStatus() {
    return request(baseUrl(), '/api/auth/status')
  }

  async function login(force = false) {
    const fresh = token && Date.now() - tokenAt < 30 * 60 * 1000
    if (fresh && !force) return { ok: true, token }
    const creds = loadCredentials(credentialsFile)
    const res = await request(baseUrl(), '/api/auth/login', {
      method: 'POST',
      body: { username: creds.username, password: creds.password },
    })
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 403
            ? 'ARTEX 还没初始化管理员密码：先 /artex restart 让插件注入一次，再试'
            : res.status === 401
              ? '管理员密码不匹配。若你在 UI 里改过密码，用 /artex login <新密码> 更新本地凭据'
              : res.error,
      }
    }
    token = res.body?.token || ''
    tokenAt = Date.now()
    return { ok: true, token }
  }

  async function authed(path, options = {}) {
    let login1 = await login()
    if (!login1.ok) return login1
    let res = await request(baseUrl(), path, { ...options, token })
    if (res.status === 401) {
      const again = await login(true)
      if (!again.ok) return again
      res = await request(baseUrl(), path, { ...options, token })
    }
    return res
  }

  async function stats() {
    const res = await authed('/api/stats')
    return res.ok ? res : res
  }

  async function listTasks() {
    const res = await authed('/api/tasks')
    if (!res.ok) return res
    const list = Array.isArray(res.body) ? res.body : res.body?.tasks || []
    return { ok: true, tasks: list }
  }

  async function createTask({ name, description, goal, seedFirstIntent = true }) {
    const body = {
      name: name || '',
      description: description || goal || '未命名任务',
      goal: goal || description || '',
    }
    if (seedFirstIntent) body.seed_first_intent = true
    const res = await authed('/api/tasks', { method: 'POST', body })
    if (!res.ok) return res
    const task = res.body?.task || res.body
    return { ok: true, task }
  }

  async function getTask(id) {
    const res = await authed(`/api/tasks/${encodeURIComponent(id)}`)
    return res.ok ? { ok: true, task: res.body?.task || res.body } : res
  }

  async function controlTask(id, action) {
    const res = await authed(`/api/tasks/${encodeURIComponent(id)}/control`, {
      method: 'POST',
      body: { action },
    })
    return res
  }

  return { base: baseUrl, authStatus, login, stats, listTasks, createTask, getTask, controlTask, credentialsFile: () => join(credentialsFile) }
}
