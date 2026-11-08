/**
 * Trellis SessionStart context for DeepSeek Harness.
 *
 * Claude Code / Cursor / CodeBuddy 等宿主在会话开始时运行
 * `.claude/hooks/session-start.py`，把 Trellis 的紧凑上下文注入模型历史，
 * 于是模型第一句就会回「Trellis SessionStart 上下文已加载」。
 *
 * DSH 没有 Claude 式 hooks（官方 Trellis 0.6.17 的 dsh 模板也明确写
 * "dsh has no session-start hook"），本模块补上这一段：
 *
 *   1. 会话第一步（`agent/pre-step`，step === 1）解析工作目录，向上找 `.trellis/`；
 *   2. 找到就渲染 Trellis 上下文：
 *        - 优先执行项目里已有的 hook 脚本（与 Claude Code 完全同一份脚本、同一份输出），
 *        - 没有 Python / 没有脚本时退回内置 JS 渲染器（不依赖任何外部进程）；
 *   3. 以带来源的 user 消息注入本步，模型第一眼就能看到任务状态；
 *   4. 同一会话只注入一次（恢复会话、压缩后按可见历史去重）。
 *
 * 设计约束：
 * - 只用 node: 内置模块，不 import 任何 @deepseek-ai/*（第三方插件目录解析不到）；
 * - 任何异常都吞掉并降级，绝不阻断会话；
 * - 关闭开关：TRELLIS_HOOKS=0 / TRELLIS_DISABLE_HOOKS=1 / DSH_TRELLIS_HOOKS=0。
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { resolveScope } from './scope.js';

/** 注入消息的来源标记；恢复会话时用它判断「本会话已经注入过」。 */
export const SOURCE_KIND = 'trellis-session-start';

/** 候选 hook 脚本（相对项目根，按优先级）。 */
const SCRIPT_CANDIDATES = [
  '.claude/hooks/session-start.py',
  '.trellis/hooks/session-start.py',
  '.trellis/scripts/hooks/session-start.py',
  '.codex/hooks/session-start.py',
];

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_CHARS = 60000;
const MAX_WALK_UP = 16;

/** 内置渲染器附带的「首次回复确认」提示，与官方 session-start.py 保持一致。 */
const FIRST_REPLY_NOTICE = `<first-reply-notice>
On the first visible assistant reply in this session, briefly acknowledge that Trellis SessionStart context loaded.
Choose the acknowledgment language in this order:
1. Use the language of the user's current request (the user message that triggered this reply).
2. If that request has no clear natural language, use an explicitly established project communication language.
3. If neither provides a language, output the language-neutral fallback exactly: \`Trellis SessionStart ✓\`.
Continue directly with the user's request after the acknowledgment.
The acknowledgment must not alter the language used for the remainder of the response.
This notice is one-shot: do not repeat it after the first visible assistant reply in this session.
</first-reply-notice>`;

/* ────────────────────────── 基础工具 ────────────────────────── */

/** 深冻结（与 dsh-llm 的 deepFreeze 等价），保证注入消息不可变。 */
function deepFreeze(value) {
	if (value === null || typeof value !== 'object') return value;
	for (const key of Object.keys(value)) deepFreeze(value[key]);
	return Object.freeze(value);
}

/**
 * 构造一条带来源的 user 消息：与 dsh-llm `createUserMessage` 结构一致，
 * 但不用 import 宿主包（第三方插件目录解析不到 @deepseek-ai/*）。
 */
export function createContextMessage(text) {
	const content = [{ type: 'text', text }];
	return deepFreeze(structuredClone({
		id: randomUUID(),
		role: 'user',
		content,
		source: {
			kind: SOURCE_KIND,
			form: 'snapshot',
			sections: [{ name: SOURCE_KIND, text }],
		},
	}));
}

function readText(path, fallback = '') {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return fallback;
	}
}

function isDir(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function clampText(text, maxChars) {
	if (typeof text !== 'string') return '';
	const body = text.trim();
	if (body.length <= maxChars) return body;
	const marker = `\n\n…（上下文超过 ${maxChars} 字符上限，已截断；完整内容见 .trellis/workflow.md 与 .trellis/tasks/）`;
	return `${body.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
}

/** 把内容里的 `</system-reminder>` 转义掉，避免仓库文本关闭框架。 */
function escapeReminder(text) {
	return text.replaceAll('</system-reminder>', '<\\/system-reminder>');
}

/* ────────────────────────── 项目发现 ────────────────────────── */

/**
 * 判断某个目录是不是「项目级」Trellis 根。
 *
 * 只认 `trellis init` 写出来的那套结构（workflow.md / config.yaml / .version），
 * 并显式排除用户主目录下的 `~/.trellis`——那是 Trellis 的用户级目录，
 * 不是项目工作区，误判会让所有项目都注入一份无关上下文。
 */
function isTrellisProjectRoot(dir) {
	if (dir === process.env.USERPROFILE || dir === process.env.HOME) return false;
	const trellisDir = join(dir, '.trellis');
	if (!isDir(trellisDir)) return false;
	return isFile(join(trellisDir, 'workflow.md'))
		|| isFile(join(trellisDir, 'config.yaml'))
		|| isFile(join(trellisDir, '.version'));
}

/**
 * 从 cwd 向上找带项目级 `.trellis/` 的目录；遇到 git 仓库根即停止上溯。
 * @param {string} cwd - 会话工作目录。
 * @returns {{root: string, trellisDir: string} | undefined}
 */
export function findTrellisProject(cwd) {
	let current;
	try {
		current = resolve(cwd);
	} catch {
		return undefined;
	}
	for (let depth = 0; depth < MAX_WALK_UP && current; depth += 1) {
		if (isTrellisProjectRoot(current)) return { root: current, trellisDir: join(current, '.trellis') };
		const parent = resolve(current, '..');
		if (parent === current) break;
		if (existsSync(join(current, '.git'))) break;
		current = parent;
	}
	return undefined;
}

/* ────────────────────────── 内置渲染器 ────────────────────────── */

function readDeveloper(root) {
	const raw = readText(join(root, '.trellis', '.developer')).trim();
	const match = /^name\s*=\s*(.+)$/mu.exec(raw);
	return (match?.[1] ?? raw).trim() || '(not initialized)';
}

function runGit(root, args) {
	return new Promise((resolvePromise) => {
		let child;
		try {
			child = spawn('git', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
		} catch {
			resolvePromise('');
			return;
		}
		let out = '';
		const timer = setTimeout(() => {
			try { child.kill(); } catch { /* ignore */ }
			resolvePromise('');
		}, 2000);
		child.stdout?.on('data', (chunk) => { out += String(chunk); });
		child.on('error', () => { clearTimeout(timer); resolvePromise(''); });
		child.on('close', (code) => {
			clearTimeout(timer);
			resolvePromise(code === 0 ? out.trim() : '');
		});
	});
}

async function renderGitState(root) {
	const branch = (await runGit(root, ['branch', '--show-current'])) || '(detached)';
	const status = await runGit(root, ['status', '--porcelain']);
	const dirty = status.split('\n').filter((line) => line.trim().length > 0).length;
	return `Git: branch ${branch}; ${dirty === 0 ? 'clean' : `dirty ${dirty} paths`}.`;
}

function readTaskJson(taskDir) {
	try {
		const data = JSON.parse(readText(join(taskDir, 'task.json'), '{}'));
		return data && typeof data === 'object' ? data : {};
	} catch {
		return {};
	}
}

/** 列出未归档任务（不含 archive/）。 */
export function listActiveTasks(trellisDir) {
	const tasksDir = join(trellisDir, 'tasks');
	if (!isDir(tasksDir)) return [];
	const tasks = [];
	for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name === 'archive' || entry.name.startsWith('.')) continue;
		const dir = join(tasksDir, entry.name);
		const data = readTaskJson(dir);
		const artifacts = ['prd.md', 'design.md', 'implement.md', 'implement.jsonl', 'check.jsonl']
			.filter((file) => isFile(join(dir, file)));
		tasks.push({
			dir: entry.name,
			title: String(data.title ?? data.name ?? entry.name),
			status: String(data.status ?? 'unknown'),
			package: typeof data.package === 'string' ? data.package : undefined,
			branch: typeof data.branch === 'string' ? data.branch : undefined,
			artifacts,
		});
	}
	return tasks.sort((left, right) => left.dir.localeCompare(right.dir));
}

/** 解析 `.trellis/.runtime/sessions/*.json` 里的当前任务指针（只读，取最新一条有效）。 */
function readCurrentTaskPointer(trellisDir, sessionId) {
	const dir = join(trellisDir, '.runtime', 'sessions');
	if (!isDir(dir)) return undefined;
	let files;
	try {
		files = readdirSync(dir).filter((name) => name.endsWith('.json'));
	} catch {
		return undefined;
	}
	const wanted = `dsh:${sessionId}`;
	const ordered = files.sort((left, right) => {
		const score = (name) => (name.includes(wanted) ? 1 : 0);
		return score(right) - score(left);
	});
	for (const name of ordered) {
		try {
			const data = JSON.parse(readText(join(dir, name), '{}'));
			const task = data?.current_task ?? data?.task ?? data?.task_path;
			if (typeof task === 'string' && task.trim().length > 0) return task.trim();
		} catch {
			/* ignore malformed pointer */
		}
	}
	return undefined;
}

function collectSpecIndexes(trellisDir) {
	const specDir = join(trellisDir, 'spec');
	if (!isDir(specDir)) return [];
	const indexes = [];
	const push = (relative) => indexes.push(`.trellis/${relative}`);
	if (isFile(join(specDir, 'guides', 'index.md'))) push('spec/guides/index.md');
	for (const entry of readdirSync(specDir, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'guides') continue;
		const dir = join(specDir, entry.name);
		if (isFile(join(dir, 'index.md'))) {
			push(`spec/${entry.name}/index.md`);
			continue;
		}
		for (const nested of readdirSync(dir, { withFileTypes: true })) {
			if (!nested.isDirectory()) continue;
			if (isFile(join(dir, nested.name, 'index.md'))) push(`spec/${entry.name}/${nested.name}/index.md`);
		}
	}
	return indexes.sort();
}

function readJournalState(root, developer) {
	const workspace = join(root, '.trellis', 'workspace', developer);
	if (!isDir(workspace)) return undefined;
	let journals;
	try {
		journals = readdirSync(workspace).filter((name) => /^journal-\d+\.md$/u.test(name));
	} catch {
		return undefined;
	}
	if (journals.length === 0) return undefined;
	journals.sort((left, right) => {
		const n = (name) => Number.parseInt(name.replace(/\D+/gu, ''), 10) || 0;
		return n(left) - n(right);
	});
	const latest = journals[journals.length - 1];
	const text = readText(join(workspace, latest));
	const lines = text.length === 0 ? 0 : text.split('\n').length;
	return `.trellis/workspace/${developer}/${latest}（${lines} / 2000 行）`;
}

/** 抽取 workflow.md 的 `## Phase Index` 段落（到 `## Phase 1` 之前）。 */
function extractPhaseIndex(workflowText) {
	const lines = workflowText.split('\n');
	let start = -1;
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i].trim() === '## Phase Index') {
			start = i;
			break;
		}
	}
	if (start < 0) return '';
	const collected = [];
	for (let i = start; i < lines.length; i += 1) {
		if (i > start && /^##\s+Phase 1/u.test(lines[i].trim())) break;
		collected.push(lines[i]);
	}
	return collected
		.join('\n')
		.replace(/\[workflow-state:[A-Za-z0-9_-]+\][\s\S]*?\[\/workflow-state:[A-Za-z0-9_-]+\]/gu, '')
		.replace(/<!--[\s\S]*?-->/gu, '')
		.replace(/\n{3,}/gu, '\n\n')
		.trim();
}

function renderNextAction(tasks, current) {
	if (!current) {
		return 'Status: NO ACTIVE TASK\n'
			+ 'Next-Action: Classify the current turn before creating any Trellis task. '
			+ '简单对话/小任务只问「这一轮是否需要建 Trellis 任务」；复杂任务问「是否允许建任务并进入规划」。';
	}
	const match = tasks.find((task) => current.includes(task.dir));
	if (!match) {
		return `Status: STALE POINTER\nTask: ${current}\n`
			+ 'Next-Action: 指针已失效，运行 `python ./.trellis/scripts/task.py finish` 清掉过期指针，再确认下一步做什么。';
	}
	const present = match.artifacts.length > 0 ? match.artifacts.join(', ') : '(none)';
	const base = `Status: ${match.status.toUpperCase()}\nTask: ${match.title}\nPresent: ${present}`;
	if (match.status === 'completed') {
		return `${base}\nNext-Action: 运行 trellis-finish-work（/trellis:finish-work）收尾；工作区脏则先回到 Phase 3.4。`;
	}
	if (match.status === 'planning') {
		return `${base}\nNext-Action: 补齐 prd.md（复杂任务还要 design.md + implement.md），征得确认后再执行 \`task.py start\`。`;
	}
	return `${base}\nNext-Action: 按 workflow 的对应阶段推进；实现/检查上下文顺序 jsonl → prd.md → design.md(若有) → implement.md(若有)。`;
}

/**
 * 内置渲染器：不依赖 Python，直接从 `.trellis/` 读状态。
 * @param {{root: string, trellisDir: string, sessionId?: string}} project
 * @returns {Promise<string>} 注入文本（不含 system-reminder 外壳）。
 */
export async function buildBuiltinContext({ root, trellisDir, sessionId = '' }) {
	const developer = readDeveloper(root);
	const tasks = listActiveTasks(trellisDir);
	const current = readCurrentTaskPointer(trellisDir, sessionId);
	const workflow = readText(join(trellisDir, 'workflow.md'));
	const specIndexes = collectSpecIndexes(trellisDir);
	const journal = readJournalState(root, developer);
	const gitState = await renderGitState(root);

	const state = [
		`Developer: ${developer}`,
		gitState,
		current ? `Current task: ${current}` : 'Current task: none.',
		`Active tasks: ${tasks.length} total${tasks.length > 0 ? `（${tasks.map((task) => `${task.dir}:${task.status}`).join('; ')}）` : ''}。必要时用 \`python ./.trellis/scripts/task.py list --mine\`。`,
	];
	if (journal) state.push(`Journal: ${journal}`);
	if (specIndexes.length > 0) state.push(`Spec indexes: ${specIndexes.length} available.`);

	const phaseIndex = extractPhaseIndex(workflow);
	const version = readText(join(trellisDir, '.version')).trim();

	const parts = [
		'<session-context>',
		`Trellis compact SessionStart context（由 dsh-skill-trellis 插件自动注入）。Trellis 版本：${version || 'unknown'}。用它定位会话；细节按需再读。`,
		'</session-context>',
		'',
		FIRST_REPLY_NOTICE,
		'',
		'<current-state>',
		...state,
		'</current-state>',
		'',
		'<trellis-workflow>',
		'# Development Workflow - Session Summary',
		'Full guide: .trellis/workflow.md。步骤细节：`python ./.trellis/scripts/get_context.py --mode phase --step <X.Y>`。',
		'',
		phaseIndex || '（workflow.md 中没有 `## Phase Index` 段落）',
		'</trellis-workflow>',
		'',
		'<guidelines>',
		'实现/检查上下文顺序：jsonl → `prd.md` → `design.md`(若有) → `implement.md`(若有)。轻量任务缺可选产物时跳过。',
		'',
	];
	if (specIndexes.length > 0) {
		parts.push('## Available indexes (read on demand)', ...specIndexes.map((item) => `- ${item}`), '');
	}
	parts.push('更多：`python ./.trellis/scripts/get_context.py --mode packages`', '</guidelines>', '');
	parts.push('<task-status>', renderNextAction(tasks, current), '</task-status>', '');
	parts.push('<ready>', 'Context loaded. Follow <task-status>. 只在需要时加载 workflow/spec/task 细节。', '</ready>');

	return parts.join('\n');
}

/* ────────────────────────── 外部 hook 脚本 ────────────────────────── */

/**
 * 找到项目里第一个存在的 hook 脚本。
 * 显式配置了 `hookScript` 时以配置为准（不存在就不跑脚本，交给内置渲染器），
 * 未配置时按候选列表探测。
 */
export function pickHookScript(root, configured) {
	if (typeof configured === 'string' && configured.trim().length > 0) {
		const absolute = resolve(root, configured.trim());
		return isFile(absolute) ? absolute : undefined;
	}
	for (const candidate of SCRIPT_CANDIDATES) {
		const absolute = join(root, candidate);
		if (isFile(absolute)) return absolute;
	}
	return undefined;
}

/** 解析 hook 脚本 stdout：JSON 信封或裸文本。 */
export function parseHookOutput(raw) {
	const text = String(raw ?? '').trim();
	if (text.length === 0) return '';
	if (text.startsWith('{')) {
		try {
			const data = JSON.parse(text);
			const nested = data?.hookSpecificOutput?.additionalContext;
			const flat = data?.additionalContext ?? data?.additional_context;
			const picked = [nested, flat].find((value) => typeof value === 'string' && value.trim().length > 0);
			if (typeof picked === 'string') return picked.trim();
		} catch {
			/* 非 JSON：按裸文本处理 */
		}
	}
	return text;
}

function pythonCandidates(config) {
	const explicit = [config?.python, process.env.TRELLIS_PYTHON, process.env.PYTHON].filter(
		(value) => typeof value === 'string' && value.trim().length > 0,
	);
	return [...new Set([...explicit, 'python', 'python3', 'py'])];
}

function spawnCollect(command, args, options) {
	return new Promise((resolvePromise) => {
		let child;
		try {
			child = spawn(command, args, { ...options, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
		} catch (error) {
			resolvePromise({ ok: false, stdout: '', stderr: String(error?.message ?? error) });
			return;
		}
		let stdout = '';
		let stderr = '';
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolvePromise(result);
		};
		const timer = setTimeout(() => {
			try { child.kill(); } catch { /* ignore */ }
			finish({ ok: false, stdout, stderr: 'timeout' });
		}, options.timeoutMs);
		child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
		child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
		child.on('error', (error) => finish({ ok: false, stdout, stderr: String(error?.message ?? error) }));
		child.on('close', (code) => finish({ ok: code === 0, stdout, stderr }));
		try {
			child.stdin?.end(JSON.stringify(options.stdinPayload));
		} catch {
			/* ignore stdin failures */
		}
	});
}

/**
 * 执行项目自带的 session-start 脚本，返回注入文本。
 * 失败（没有 Python、脚本报错、超时）返回空串，由调用方降级到内置渲染器。
 */
export async function runHookScript(scriptPath, { root, sessionId, timeoutMs, config }) {
	const payload = {
		cwd: root,
		hook_event_name: 'SessionStart',
		source: 'startup',
		session_id: sessionId,
	};
	const env = {
		...process.env,
		PYTHONIOENCODING: 'utf-8',
		PYTHONUTF8: '1',
		CLAUDE_PROJECT_DIR: root,
		TRELLIS_CONTEXT_ID: `dsh:${sessionId}`,
		TRELLIS_PLATFORM: 'dsh',
	};
	const isPython = scriptPath.endsWith('.py');
	const attempts = isPython
		? pythonCandidates(config).map((exe) => ({
			command: exe,
			args: basename(exe).toLowerCase().startsWith('py') && !basename(exe).toLowerCase().startsWith('python')
				? ['-3', scriptPath]
				: ['-W', 'ignore', scriptPath],
		}))
		: [{ command: scriptPath, args: [] }];

	for (const attempt of attempts) {
		const result = await spawnCollect(attempt.command, attempt.args, {
			cwd: root,
			env,
			timeoutMs,
			stdinPayload: payload,
		});
		if (result.ok) {
			const parsed = parseHookOutput(result.stdout);
			if (parsed.length > 0) return parsed;
			continue;
		}
		// ENOENT（没有这个解释器）继续试下一个；其它错误也继续，最后统一降级。
	}
	return '';
}

/* ────────────────────────── 自动初始化 ────────────────────────── */

/** 项目根的标志：有这些之一就认为 cwd 是一个真实项目（没有 .git 时的兜底）。 */
const PROJECT_MARKERS = [
	'package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml',
	'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'CMakeLists.txt', 'Makefile', '.sln',
];

/** 本进程内已经尝试过（成功或失败）的根目录，避免每个会话反复拉起 trellis init。 */
const initAttempted = new Map();

function autoInitDisabled(config) {
	return config.autoInit === false
		|| ['0', 'false'].includes((process.env.DSH_TRELLIS_AUTO_INIT ?? '').toLowerCase())
		|| ['0', 'false'].includes((process.env.TRELLIS_AUTO_INIT ?? '').toLowerCase());
}

/** 是不是盘符根 / 用户主目录 / 系统目录：这些地方绝不自动初始化。 */
function isForbiddenInitRoot(dir) {
	const normalized = resolve(dir);
	if (resolve(normalized, '..') === normalized) return true;
	const home = process.env.USERPROFILE ?? process.env.HOME;
	if (home !== undefined && resolve(home) === normalized) return true;
	const lower = normalized.toLowerCase();
	return ['\\windows', '\\program files', '\\program files (x86)', '\\programdata', '/usr', '/etc', '/bin']
		.some((frag) => lower.includes(frag));
}

/**
 * 找到应该初始化 Trellis 的项目根：向上找 `.git`，找不到就看 cwd 是否有项目清单文件。
 * 返回 undefined 表示「这不是项目目录」（例如随手开的空文件夹、主目录），不动它。
 */
export function findInitCandidate(cwd) {
	let current;
	try {
		current = resolve(cwd);
	} catch {
		return undefined;
	}
	if (!isDir(current)) return undefined;
	for (let depth = 0; depth < MAX_WALK_UP && current; depth += 1) {
		if (isForbiddenInitRoot(current)) return undefined;
		if (existsSync(join(current, '.git'))) return current;
		const parent = resolve(current, '..');
		if (parent === current) break;
		current = parent;
	}
	const start = resolve(cwd);
	if (isForbiddenInitRoot(start)) return undefined;
	let entries = [];
	try {
		entries = readdirSync(start);
	} catch {
		return undefined;
	}
	const hit = entries.some((entry) => PROJECT_MARKERS.some((marker) => (marker.startsWith('.') ? entry.endsWith(marker) : entry === marker)));
	return hit ? start : undefined;
}

function currentUserName() {
	const raw = process.env.USERNAME ?? process.env.USER ?? 'dsh-user';
	return raw.replace(/[^\w.\-]/gu, '_') || 'dsh-user';
}

/**
 * 在项目里静默执行 `trellis init -y --dsh -u <user>`。
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function runTrellisInit(root, config = {}) {
	const timeoutMs = Number.isFinite(config.initTimeoutMs) ? Number(config.initTimeoutMs) : 120000;
	const candidates = process.platform === 'win32' ? ['trellis.cmd', 'trellis'] : ['trellis'];
	let last = 'trellis not found';
	for (const command of candidates) {
		const result = await spawnCollect(command, ['init', '-y', '--dsh', '-u', currentUserName()], {
			cwd: root,
			env: { ...process.env, CI: '1', NO_COLOR: '1' },
			timeoutMs,
			stdinPayload: '',
			shell: process.platform === 'win32',
		});
		if (result.ok && isTrellisProjectRoot(root)) return { ok: true, detail: '' };
		last = (result.stderr || result.stdout || 'trellis init failed').trim().slice(-400);
	}
	return { ok: false, detail: last };
}

/**
 * 没有 `.trellis/` 的项目：自动初始化一次。
 * @returns {Promise<{project?: {root: string, trellisDir: string}, notice: string}>}
 */
async function ensureTrellisProject(cwd, config) {
	if (autoInitDisabled(config)) return { notice: '' };
	const root = findInitCandidate(cwd);
	if (root === undefined) return { notice: '' };
	const key = root.toLowerCase();
	if (initAttempted.has(key)) return { notice: initAttempted.get(key).failure ?? '' };
	const outcome = await runTrellisInit(root, config);
	if (outcome.ok) {
		initAttempted.set(key, {});
		const project = findTrellisProject(root);
		return {
			project,
			notice: `Trellis 已自动为本项目初始化（trellis init -y --dsh，根目录 ${root}）。首次回复请顺带告知用户这一点，并建议用 /skill trellis-start 开始工作流。`,
		};
	}
	const failure = `Trellis 自动初始化失败（${outcome.detail}）。请提示用户在项目根目录手动执行 \`trellis init -y --dsh\`（需要 trellis 在 PATH 中）。`;
	initAttempted.set(key, { failure });
	return { notice: failure };
}

/* ────────────────────────── 官方版本检查 ────────────────────────── */

/** 检查结果缓存 24 小时，避免每次开会话都打一次 npm。 */
const UPSTREAM_TTL_MS = 24 * 3600 * 1000;
const UPSTREAM_URL = 'https://registry.npmjs.org/@mindfoldhq%2Ftrellis/latest';

function upstreamCachePath() {
  return join(tmpdir(), 'dsh-trellis-upstream.json');
}

function readUpstreamCache() {
  try {
    return JSON.parse(readFileSync(upstreamCachePath(), 'utf8'));
  } catch {
    return undefined;
  }
}

function localTrellisVersion(root) {
  for (const rel of ['.trellis/.version', '.trellis/config.yaml']) {
    const text = readText(join(root, rel));
    const hit = /version\s*:\s*["']?([0-9]+\.[0-9]+\.[0-9]+)/u.exec(text);
    if (hit) return hit[1];
  }
  const raw = readText(join(root, '.trellis', '.version')).trim();
  return /^[0-9]+\.[0-9]+\.[0-9]+$/u.test(raw) ? raw : '';
}

/**
 * 查官方最新版本（带 24h 缓存 + 3s 超时 + 静默降级）。
 * @returns {Promise<string>} 最新版本号，查不到返回空串
 */
async function latestTrellisVersion() {
  if (String(process.env.DSH_TRELLIS_CHECK_UPDATE ?? '') === '0') return '';
  const cached = readUpstreamCache();
  const now = Date.now();
  if (cached?.checkedAt && now - cached.checkedAt < UPSTREAM_TTL_MS && typeof cached.latest === 'string') {
    return cached.latest;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(UPSTREAM_URL, { signal: controller.signal, headers: { accept: 'application/json' } });
    clearTimeout(timer);
    if (!response.ok) return '';
    const meta = await response.json();
    const latest = typeof meta?.version === 'string' ? meta.version : '';
    if (latest.length > 0) {
      try { writeFileSync(upstreamCachePath(), JSON.stringify({ checkedAt: now, latest }), 'utf8'); } catch { /* ignore */ }
    }
    return latest;
  } catch {
    return '';
  }
}

/** 版本比较：a > b 返回 true（只处理 x.y.z）。 */
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/* ────────────────────────── 注入装配 ────────────────────────── */

/** 给注入内容加上 harness 框架，模型与 UI 都能识别这是系统上下文。 */
export function frameContext(body) {
	return `<system-reminder>\nTrellis SessionStart context（dsh-skill-trellis 自动加载；不是用户消息）。\n\n${escapeReminder(body)}\n</system-reminder>`;
}

/** 本会话可见历史里是否已经有 Trellis 注入。 */
function visibleInjection(session) {
	try {
		const nodes = session?.surface?.nodes;
		if (nodes === undefined || typeof session?.eventAt !== 'function') return undefined;
		const list = typeof nodes.toReversed === 'function' ? nodes.toReversed() : [...nodes].reverse();
		for (const seq of list) {
			const event = session.eventAt(seq);
			if (event?.type !== 'user/message') continue;
			const source = event.data?.source;
			if (source?.kind === SOURCE_KIND) {
				const section = Array.isArray(source.sections) ? source.sections[0] : undefined;
				return typeof section?.text === 'string' ? section.text : '';
			}
		}
	} catch {
		/* 结构变化时降级到内存去重 */
	}
	return undefined;
}

function hooksDisabled() {
	const off = ['0'];
	return (
		off.includes(process.env.TRELLIS_HOOKS ?? '') ||
		process.env.TRELLIS_DISABLE_HOOKS === '1' ||
		off.includes(process.env.DSH_TRELLIS_HOOKS ?? '')
	);
}

async function resolveCwd(ctx, agent, signal) {
	try {
		const workingDirectory = ctx.get?.('workingDirectory');
		if (workingDirectory !== undefined) {
			const cwd = await workingDirectory.ensure(agent, signal);
			if (typeof cwd === 'string' && cwd.length > 0) return cwd;
		}
	} catch {
		/* 服务不可用时退回进程 cwd */
	}
	try {
		const workspace = ctx.get?.('workspace');
		const cwd = workspace?.cwd;
		if (typeof cwd === 'string' && cwd.length > 0) return cwd;
	} catch {
		/* ignore */
	}
	return process.cwd();
}

function sessionIdOf(agent) {
	try {
		const id = agent?.session?.header?.id ?? agent?.id;
		if (typeof id === 'string' && id.length > 0) return id;
	} catch {
		/* ignore */
	}
	return 'dsh-session';
}

/** 子 agent（subagent）不重复注入：父会话已经带过上下文。 */
function isSubagent(agent) {
	try {
		const meta = agent?.session?.meta ?? agent?.meta;
		if (meta === undefined || meta === null) return false;
		return meta.origin === 'subagent' || typeof meta.parentSession === 'string';
	} catch {
		return false;
	}
}

/**
 * 安装 SessionStart 注入。
 * @param ctx - Cordis 插件上下文。
 * @param config - 插件配置（enabled / hookScript / python / timeoutMs / maxChars / gitStatus）。
 */
export function installSessionContext(ctx, config = {}) {
	if (config.enabled === false) return;
	const maxChars = Number.isFinite(config.maxChars) ? Number(config.maxChars) : DEFAULT_MAX_CHARS;
	const timeoutMs = Number.isFinite(config.timeoutMs) ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS;
	/** 会话级去重：签名一致就不再重复注入。 */
	const injected = new WeakMap();

	ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
		const decision = await next();
		try {
			if (decision?.kind === 'reject' || signal?.aborted === true) return decision;
			if (hooksDisabled()) return decision;
			if (step !== 1) return decision;
			if (agent === undefined) return decision;
			if (config.skipSubagents !== false && isSubagent(agent)) return decision;

			const existing = visibleInjection(agent.session);
			if (existing !== undefined) return decision;

			const cwd = await resolveCwd(ctx, agent, signal);

			// 按工作区决定是否启用：<项目根>/.dsh/plugins.json > profile.workspaces > 全局
			const scopeRoot = findTrellisProject(cwd)?.root ?? findInitCandidate(cwd) ?? cwd;
			const scope = resolveScope(scopeRoot, config, 'trellis');
			if (scope.enabled === false) return decision;

			let project = findTrellisProject(cwd);
			let initNotice = '';
			if (project === undefined) {
				const ensured = scope.autoInit === false ? { notice: '' } : await ensureTrellisProject(cwd, config);
				project = ensured.project;
				initNotice = ensured.notice;
				if (project === undefined) {
					if (initNotice.length === 0) return decision;
					const notice = createContextMessage(frameContext(initNotice));
					return { ...decision, messages: [...(decision.messages ?? []), notice] };
				}
			}

			const sessionId = sessionIdOf(agent);
			const scriptPath = config.useHookScript === false ? undefined : pickHookScript(project.root, config.hookScript);
			let body = '';
			if (scriptPath !== undefined) {
				body = await runHookScript(scriptPath, { root: project.root, sessionId, timeoutMs, config });
			}
			if (body.length === 0) {
				body = await buildBuiltinContext({ ...project, sessionId });
			}
			const scopeLine = `作用域：本工作区已启用（来源 ${scope.source}${scope.autoInit === false ? '，autoInit=off' : ''}）。`;
			body = body.length > 0 ? `${scopeLine}\n\n${body}` : scopeLine;

			// 每次进会话顺带看一眼官方有没有新版（24h 缓存 + 3s 超时，失败静默）
			let updateNotice = '';
			if (config.checkUpstream !== false) {
				try {
					const local = localTrellisVersion(project.root);
					const latest = await latestTrellisVersion();
					if (local.length > 0 && latest.length > 0 && isNewer(latest, local)) {
						updateNotice = `Trellis 官方有新版：项目 ${local} → 官方 ${latest}。运行 \`Update-Trellis.ps1\` 做增量升级（先备份 vendor\\trellis，模板/文档类冲突保留本地）。`;
					}
				} catch { /* 版本检查永不阻断会话 */ }
			}
			if (updateNotice.length > 0) body = `${updateNotice}\n\n${body}`;

			if (initNotice.length > 0) body = `${initNotice}\n\n${body}`;
			body = clampText(body, maxChars);
			if (body.length === 0) return decision;

			const signature = `${scriptPath ?? 'builtin'}:${body.length}:${body.slice(-160)}`;
			const previous = injected.get(agent.session);
			if (previous === signature) return decision;
			injected.set(agent.session, signature);

			const message = createContextMessage(frameContext(body));
			return { ...decision, messages: [...(decision.messages ?? []), message] };
		} catch (error) {
			try {
				ctx.logger?.warn?.('trellis session-start injection failed: %o', error);
			} catch {
				/* ignore logger failures */
			}
			return decision;
		}
	}, { prepend: true });
}

export const internals = {
	SCRIPT_CANDIDATES,
	FIRST_REPLY_NOTICE,
	extractPhaseIndex,
	renderNextAction,
};
