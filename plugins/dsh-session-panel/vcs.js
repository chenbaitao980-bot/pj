/**
 * Version-control providers for the session panel's "更改" section.
 *
 * Each provider answers one question for a directory: how far is the local
 * working copy from its remote? Git: uncommitted changes (+/− lines per file),
 * commits not pushed (ahead) and not pulled (behind), and the working tree's
 * total distance from the upstream branch. SVN: local modifications (+/−
 * lines), and how many revisions the server is ahead of the working copy.
 *
 * Every command is a fixed argv run with a timeout and without a shell; paths
 * come in as arguments, never interpolated.
 */
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

const LIST_MAX = 60
const COMMITS_MAX = 20
const DIFF_BYTES_MAX = 4 * 1024 * 1024

/** Run one command; resolves { ok, stdout, stderr, code } and never rejects. */
export const run = (command, args, options) => new Promise((done) => {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LANG: 'C', LC_ALL: 'C' }
  try {
    execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 8000,
      maxBuffer: options.maxBuffer ?? DIFF_BYTES_MAX,
      windowsHide: true,
      encoding: 'utf8',
      env,
    }, (error, stdout, stderr) => {
      done({
        ok: error === null,
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
        code: error === null ? 0 : (typeof error.code === 'number' ? error.code : String(error.code ?? 'error')),
        timedOut: error !== null && error.killed === true,
      })
    })
  } catch (error) {
    done({ ok: false, stdout: '', stderr: String(error && error.message ? error.message : error), code: 'spawn', timedOut: false })
  }
})

const firstLine = (text) => String(text).split(/\r?\n/u).map((line) => line.trim()).find((line) => line !== '') ?? ''

/** Nearest ancestor (inclusive) holding `marker`, or undefined. */
const findUp = (start, marker) => {
  let dir = resolve(start)
  for (let depth = 0; depth < 64; depth += 1) {
    if (existsSync(join(dir, marker))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

// ---------------------------------------------------------------------- git

const parseNumstatZ = (text) => {
  // -z numstat: "add\tdel\tpath\0" or "add\tdel\t\0old\0new\0" for renames.
  const out = new Map()
  const parts = text.split('\0')
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === '') continue
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/su.exec(part)
    if (match === null) continue
    let path = match[3]
    if (path === '') {
      index += 2
      path = parts[index] ?? ''
    }
    out.set(path, { add: match[1] === '-' ? null : Number(match[1]), del: match[2] === '-' ? null : Number(match[2]) })
  }
  return out
}

const parseStatusV2 = (text) => {
  const branch = { oid: null, head: null, upstream: null, ahead: 0, behind: 0 }
  const files = []
  const parts = text.split('\0')
  for (let index = 0; index < parts.length; index += 1) {
    const line = parts[index]
    if (line === '') continue
    if (line.startsWith('# ')) {
      const [, key, ...rest] = line.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') branch.oid = value === '(initial)' ? null : value
      else if (key === 'branch.head') branch.head = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') branch.upstream = value
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/u.exec(value)
        if (match !== null) { branch.ahead = Number(match[1]); branch.behind = Number(match[2]) }
      }
      continue
    }
    const kind = line[0]
    if (kind === '1') {
      const fields = line.split(' ')
      files.push({ xy: fields[1], path: fields.slice(8).join(' ') })
    } else if (kind === '2') {
      const fields = line.split(' ')
      files.push({ xy: fields[1], path: fields.slice(9).join(' '), from: parts[index + 1] })
      index += 1
    } else if (kind === 'u') {
      const fields = line.split(' ')
      files.push({ xy: 'UU', path: fields.slice(10).join(' '), conflict: true })
    } else if (kind === '?') {
      files.push({ xy: '??', path: line.slice(2), untracked: true })
    }
  }
  return { branch, files }
}

/** Single-letter state the panel shows for one porcelain XY pair. */
const gitState = (entry) => {
  if (entry.untracked) return 'U'
  if (entry.conflict) return 'C'
  const xy = entry.xy ?? '..'
  for (const letter of ['D', 'A', 'R', 'M', 'T', 'C']) if (xy.includes(letter)) return letter === 'T' ? 'M' : letter === 'C' ? 'R' : letter
  return 'M'
}

const parseLog = (text) => text.split('\n').filter((line) => line.trim() !== '').map((line) => {
  const [hash, at, ...subject] = line.split('\t')
  return { hash, at: Number(at) * 1000 || null, subject: subject.join('\t') }
})

const shortstat = (text) => {
  const files = /(\d+) files? changed/u.exec(text)
  const add = /(\d+) insertions?\(\+\)/u.exec(text)
  const del = /(\d+) deletions?\(-\)/u.exec(text)
  return { files: files ? Number(files[1]) : 0, add: add ? Number(add[1]) : 0, del: del ? Number(del[1]) : 0 }
}

export async function gitStatus(dir, options = {}) {
  const git = options.git ?? 'git'
  const top = await run(git, ['rev-parse', '--show-toplevel', '--git-dir'], { cwd: dir, timeoutMs: 5000 })
  if (!top.ok) return undefined
  const [rootLine, gitDirLine] = top.stdout.split(/\r?\n/u)
  const root = normalize(rootLine.trim())
  const gitDir = resolve(dir, gitDirLine.trim())
  if (options.fetch === true) {
    const fetched = await run(git, ['fetch', '--quiet', '--no-tags', '--prune'], { cwd: root, timeoutMs: 30000 })
    if (!fetched.ok) options.fetchError = firstLine(fetched.stderr) || 'git fetch 失败'
  }
  const status = await run(git, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'], { cwd: root, timeoutMs: 10000 })
  if (!status.ok) return { kind: 'git', root, error: firstLine(status.stderr) || 'git status 失败' }
  const { branch, files } = parseStatusV2(status.stdout)
  const hasHead = branch.oid !== null
  // Compare against the upstream; without one, against the remote's copy of
  // this branch or its default branch, so "how far from the remote" still has
  // an answer (marked as not the configured upstream).
  let compareRef = branch.upstream
  let remote = null
  if (branch.upstream !== null) {
    const configured = await run(git, ['config', '--get', `branch.${branch.head}.remote`], { cwd: root, timeoutMs: 3000 })
    remote = configured.ok ? firstLine(configured.stdout) : branch.upstream.split('/')[0]
  } else if (hasHead) {
    const remotes = await run(git, ['remote'], { cwd: root, timeoutMs: 3000 })
    const names = remotes.ok ? remotes.stdout.split(/\r?\n/u).map((name) => name.trim()).filter((name) => name !== '') : []
    remote = names.includes('origin') ? 'origin' : names[0] ?? null
    if (remote !== null) {
      const symbolic = await run(git, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], { cwd: root, timeoutMs: 3000 })
      const candidates = [
        ...(branch.head !== null ? [`${remote}/${branch.head}`] : []),
        ...(symbolic.ok ? [firstLine(symbolic.stdout)] : []),
        `${remote}/main`,
        `${remote}/master`,
      ]
      for (const candidate of candidates) {
        const verified = await run(git, ['rev-parse', '--verify', '--quiet', `refs/remotes/${candidate}`], { cwd: root, timeoutMs: 3000 })
        if (verified.ok) { compareRef = candidate; break }
      }
      if (compareRef !== null) {
        const counted = await run(git, ['rev-list', '--left-right', '--count', `HEAD...${compareRef}`], { cwd: root, timeoutMs: 5000 })
        const match = counted.ok ? /^(\d+)\s+(\d+)/u.exec(counted.stdout.trim()) : null
        if (match !== null) { branch.ahead = Number(match[1]); branch.behind = Number(match[2]) }
      }
    }
  }
  const against = compareRef ?? ''
  const none = Promise.resolve({ ok: false, stdout: '' })
  const [numstat, unpushed, unpulled, vsRemote, lastCommit] = await Promise.all([
    hasHead ? run(git, ['diff', '--numstat', '-z', 'HEAD'], { cwd: root, timeoutMs: 10000 }) : none,
    compareRef !== null && branch.ahead > 0 ? run(git, ['log', '--format=%h%x09%ct%x09%s', `-n${COMMITS_MAX}`, `${against}..HEAD`], { cwd: root, timeoutMs: 5000 }) : none,
    compareRef !== null && branch.behind > 0 ? run(git, ['log', '--format=%h%x09%ct%x09%s', `-n${COMMITS_MAX}`, `HEAD..${against}`], { cwd: root, timeoutMs: 5000 }) : none,
    compareRef !== null ? run(git, ['diff', '--shortstat', against], { cwd: root, timeoutMs: 10000 }) : none,
    hasHead ? run(git, ['log', '-1', '--format=%h%x09%ct%x09%s'], { cwd: root, timeoutMs: 3000 }) : none,
  ])
  const counts = numstat.ok ? parseNumstatZ(numstat.stdout) : new Map()
  let add = 0
  let del = 0
  const list = files.map((entry) => {
    const stat = counts.get(entry.path)
    if (stat !== undefined) { add += stat.add ?? 0; del += stat.del ?? 0 }
    return {
      path: entry.path,
      state: gitState(entry),
      staged: !entry.untracked && !entry.conflict && entry.xy[0] !== '.',
      add: stat === undefined ? null : stat.add,
      del: stat === undefined ? null : stat.del,
    }
  })
  const remoteUrl = remote !== null ? await run(git, ['remote', 'get-url', remote], { cwd: root, timeoutMs: 3000 }) : { ok: false }
  let lastFetchAt = null
  try { lastFetchAt = statSync(join(gitDir, 'FETCH_HEAD')).mtimeMs } catch {}
  const head = lastCommit.ok ? parseLog(lastCommit.stdout)[0] ?? null : null
  return {
    kind: 'git',
    root,
    branch: branch.head,
    detached: branch.head === null,
    upstream: branch.upstream,
    compareRef,
    remote,
    remoteUrl: remoteUrl.ok ? scrubUrl(firstLine(remoteUrl.stdout)) : null,
    ahead: branch.ahead,
    behind: branch.behind,
    lastFetchAt,
    head,
    changes: {
      files: files.length,
      staged: list.filter((item) => item.staged).length,
      untracked: files.filter((entry) => entry.untracked).length,
      conflicted: files.filter((entry) => entry.conflict).length,
      add,
      del,
      list: list.slice(0, LIST_MAX),
      truncated: list.length > LIST_MAX,
    },
    unpushed: unpushed.ok ? parseLog(unpushed.stdout) : [],
    unpulled: unpulled.ok ? parseLog(unpulled.stdout) : [],
    vsRemote: vsRemote.ok ? shortstat(vsRemote.stdout) : null,
    fetchError: options.fetchError ?? null,
  }
}

/** Drop credentials embedded in a remote URL before it reaches the browser. */
const scrubUrl = (url) => String(url).replace(/^(\w+:\/\/)[^@/]+@/u, '$1')

// ---------------------------------------------------------------------- svn

const xmlAttr = (tag, name) => {
  const match = new RegExp('\\s' + name + '="([^"]*)"', 'u').exec(tag)
  return match === null ? null : decodeXml(match[1])
}
const xmlText = (xml, name) => {
  const match = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>', 'u').exec(xml)
  return match === null ? null : decodeXml(match[1].trim())
}
const decodeXml = (text) => text.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, '&')

const SVN_STATE = { modified: 'M', added: 'A', deleted: 'D', replaced: 'R', conflicted: 'C', unversioned: 'U', missing: '!', obstructed: '~' }

/** Count +/− lines per file from a unified `svn diff`. */
const svnDiffCounts = (text) => {
  const counts = new Map()
  let current = null
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith('Index: ')) { current = { add: 0, del: 0 }; counts.set(line.slice(7).trim(), current); continue }
    if (current === null || line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) current.add += 1
    else if (line.startsWith('-')) current.del += 1
  }
  return counts
}

export async function svnStatus(dir, options = {}) {
  const svn = options.svn ?? 'svn'
  const base = findUp(dir, '.svn')
  if (base === undefined) return undefined
  const info = await run(svn, ['info', '--xml', '--non-interactive', base], { cwd: base, timeoutMs: 6000 })
  if (!info.ok) return { kind: 'svn', root: base, error: firstLine(info.stderr) || 'svn info 失败' }
  const root = normalize(xmlText(info.stdout, 'wcroot-abspath') ?? base)
  const url = xmlText(info.stdout, 'url')
  const entryTag = /<entry\b[^>]*>/u.exec(info.stdout)
  const revision = entryTag === null ? null : Number(xmlAttr(entryTag[0], 'revision'))
  const args = ['status', '--xml', '--non-interactive', ...(options.fetch === true ? ['-u'] : []), root]
  const [status, diff, remoteInfo] = await Promise.all([
    run(svn, args, { cwd: root, timeoutMs: options.fetch === true ? 30000 : 10000 }),
    run(svn, ['diff', '--non-interactive', root], { cwd: root, timeoutMs: 15000 }),
    url === null ? Promise.resolve({ ok: false }) : run(svn, ['info', '--xml', '--non-interactive', '-r', 'HEAD', url], { cwd: root, timeoutMs: options.fetch === true ? 15000 : 6000 }),
  ])
  if (!status.ok) return { kind: 'svn', root, url: scrubUrl(url ?? ''), error: firstLine(status.stderr) || 'svn status 失败' }
  const counts = diff.ok ? svnDiffCounts(diff.stdout) : new Map()
  const list = []
  let outdated = 0
  let add = 0
  let del = 0
  for (const match of status.stdout.matchAll(/<entry\s[^>]*path="([^"]*)"[^>]*>([\s\S]*?)<\/entry>/gu)) {
    const path = decodeXml(match[1])
    const body = match[2]
    const wc = /<wc-status\b[^>]*>/u.exec(body)
    const repos = /<repos-status\b[^>]*>/u.exec(body)
    if (repos !== null && xmlAttr(repos[0], 'item') !== 'none') outdated += 1
    const item = wc === null ? 'normal' : xmlAttr(wc[0], 'item')
    if (item === null || item === 'normal' || item === 'external' || item === 'ignored' || item === 'none') continue
    const rel = relative(root, resolve(root, path)).split(sep).join('/')
    const stat = counts.get(path) ?? counts.get(rel)
    if (stat !== undefined) { add += stat.add; del += stat.del }
    list.push({ path: rel === '' ? '.' : rel, state: SVN_STATE[item] ?? 'M', staged: false, add: stat === undefined ? null : stat.add, del: stat === undefined ? null : stat.del })
  }
  let headRevision = null
  if (remoteInfo.ok) {
    const tag = /<entry\b[^>]*>/u.exec(remoteInfo.stdout)
    headRevision = tag === null ? null : Number(xmlAttr(tag[0], 'revision'))
  }
  return {
    kind: 'svn',
    root,
    url: url === null ? null : scrubUrl(url),
    revision: Number.isFinite(revision) ? revision : null,
    headRevision: Number.isFinite(headRevision) ? headRevision : null,
    behind: Number.isFinite(headRevision) && Number.isFinite(revision) ? Math.max(0, headRevision - revision) : null,
    outdated: options.fetch === true ? outdated : null,
    remoteError: remoteInfo.ok ? null : firstLine(remoteInfo.stderr ?? '') || null,
    changes: {
      files: list.length,
      staged: 0,
      untracked: list.filter((item) => item.state === 'U').length,
      conflicted: list.filter((item) => item.state === 'C').length,
      add,
      del,
      list: list.slice(0, LIST_MAX),
      truncated: list.length > LIST_MAX,
    },
  }
}

// ------------------------------------------------------------------ dispatch

export const PROVIDERS = [
  { kind: 'git', label: 'Git', read: gitStatus },
  { kind: 'svn', label: 'SVN', read: svnStatus },
]

/** True for an absolute path naming an existing directory. */
export const usableDir = (value) => {
  if (typeof value !== 'string' || value === '' || !isAbsolute(value)) return false
  try {
    return statSync(value).isDirectory()
  } catch {
    return false
  }
}

/**
 * Every provider that recognizes `dir`, read in parallel.
 * @returns array of provider reports (possibly empty).
 */
export async function readAll(dir, options = {}) {
  const only = typeof options.kind === 'string' ? options.kind : undefined
  const reports = await Promise.all(PROVIDERS.filter((provider) => only === undefined || provider.kind === only).map(async (provider) => {
    try {
      return await provider.read(dir, { fetch: options.fetch === true })
    } catch (error) {
      return { kind: provider.kind, root: dir, error: String(error && error.message ? error.message : error) }
    }
  }))
  return reports.filter((report) => report !== undefined)
}
