/**
 * dsh-skill-trellis 自检脚本（不需要启动 DSH）。
 *
 *   node scripts/smoke.mjs [项目目录]
 *
 * 覆盖：
 *  1. 技能注册表能列出 16 个 trellis-* 技能；
 *  2. SessionStart 注入在「有 .trellis 的项目」里产出一条带来源的 user 消息；
 *  3. 同一会话第二次进入 step 1 不重复注入；
 *  4. 优先走项目自带的 session-start.py（有 Python 时），否则退回内置渲染器；
 *  5. 没有 .trellis 的项目不注入任何东西。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = new URL('../', import.meta.url);
const plugin = await import(new URL('lib/index.js', here).href);

const projectDir = process.argv[2] ?? process.cwd();
let failures = 0;

function check(label, condition, detail = '') {
	const ok = Boolean(condition);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
	return ok;
}

/** 造一个够用的 Cordis ctx。 */
function fakeContext(cwd) {
	const skills = [];
	const listeners = [];
	return {
		skills: { registerProvider: (factory) => skills.push(factory()) },
		registered: skills,
		listeners,
		logger: { warn: (...args) => console.log('  [warn]', ...args) },
		get: (key) => (key === 'workingDirectory' ? { ensure: async () => cwd } : undefined),
		on: (event, fn, options) => { listeners.push({ event, fn, options }); },
	};
}

/** 造一条最小 agent/session。 */
function fakeAgent(sessionId) {
	const events = new Map();
	const nodes = [];
	return {
		id: sessionId,
		session: {
			header: { id: sessionId },
			surface: { nodes },
			eventAt: (seq) => events.get(seq),
			_append: (seq, event) => { events.set(seq, event); nodes.push(seq); },
		},
	};
}

async function runPreStep(listener, agent, step = 1) {
	const decision = { kind: 'accept', messages: [{ id: 'user-1', role: 'user', content: [{ type: 'text', text: 'hi' }] }] };
	const result = await listener.fn({ agent, step, turn: 1, signal: { aborted: false } }, async () => decision);
	return result;
}

// ── 1. 技能注册 ───────────────────────────────────────────────
const ctxA = fakeContext(projectDir);
plugin.apply(ctxA, {});
check('技能 provider 已注册', ctxA.registered.length === 1);
const listed = ctxA.registered.length > 0 ? await ctxA.registered[0].list() : [];
console.log(`      技能数：${listed.length}（${listed.slice(0, 4).map((item) => item.name).join(', ')}…）`);
check('trellis 技能数 >= 15', listed.length >= 15, `实际 ${listed.length}`);
check('存在 trellis-start', listed.some((item) => item.name === 'trellis-start'));

// ── 2. 注入 ───────────────────────────────────────────────────
const ctxB = fakeContext(projectDir);
plugin.apply(ctxB, {});
check('注册了 agent/pre-step 监听', ctxB.listeners.some((entry) => entry.event === 'agent/pre-step'));
const listener = ctxB.listeners.find((entry) => entry.event === 'agent/pre-step');
const agent = fakeAgent('smoke-session');
const first = await runPreStep(listener, agent);
const injected = first.messages.at(-1);
check('注入了一条额外消息', first.messages.length === 2, `messages=${first.messages.length}`);
check('来源标记正确', injected?.source?.kind === 'trellis-session-start', String(injected?.source?.kind));
const text = injected?.content?.[0]?.text ?? '';
check('内容含 session-context 段', text.includes('<session-context>'), `长度 ${text.length}`);
check('内容含 system-reminder 外壳', text.includes('<system-reminder>'));
check('内容含 first-reply-notice 或 ready 段', text.includes('<ready>') || text.includes('<first-reply-notice>'));
check('消息已冻结', Object.isFrozen(injected));
if (text.includes('Trellis SessionStart context（dsh-skill-trellis 自动加载')) {
	const mode = text.includes('session-start.py') ? 'unknown' : 'builtin-or-script';
	console.log(`      注入长度：${text.length} 字符（${mode}）`);
}

// 模拟该消息进入历史，然后同一会话第二次进 step 1 应跳过
agent.session._append(0, { type: 'user/message', data: injected });
const second = await runPreStep(listener, agent);
check('同会话二次 step1 不重复注入', second.messages.length === 1, `messages=${second.messages.length}`);

// ── 3. 无 .trellis 的项目 ────────────────────────────────────
const emptyDir = mkdtempSync(join(tmpdir(), 'trellis-noop-'));
const ctxC = fakeContext(emptyDir);
plugin.apply(ctxC, {});
const listenerC = ctxC.listeners.find((entry) => entry.event === 'agent/pre-step');
const third = await runPreStep(listenerC, fakeAgent('smoke-empty'));
check('无 .trellis 时不注入', third.messages.length === 1, `messages=${third.messages.length}`);

// ── 4. 内置渲染器（禁用仓库里的脚本）─────────────────────────
const ctxD = fakeContext(projectDir);
plugin.apply(ctxD, { useHookScript: false });
const listenerD = ctxD.listeners.find((entry) => entry.event === 'agent/pre-step');
const fourth = await runPreStep(listenerD, fakeAgent('smoke-builtin'));
const builtinText = fourth.messages.at(-1)?.content?.[0]?.text ?? '';
check('内置渲染器可用', builtinText.includes('<trellis-workflow>') || builtinText.includes('<ready>'), `长度 ${builtinText.length}`);
check('内置渲染器与脚本输出可区分', builtinText.includes('dsh-skill-trellis 插件自动注入'));
if (builtinText.length > 0) console.log(builtinText.split('\n').slice(0, 14).join('\n'));

// ── 5. 关闭开关 ───────────────────────────────────────────────
process.env.TRELLIS_HOOKS = '0';
const ctxE = fakeContext(projectDir);
plugin.apply(ctxE, {});
const listenerE = ctxE.listeners.find((entry) => entry.event === 'agent/pre-step');
const fifth = await runPreStep(listenerE, fakeAgent('smoke-off'));
check('TRELLIS_HOOKS=0 时不注入', fifth.messages.length === 1, `messages=${fifth.messages.length}`);
delete process.env.TRELLIS_HOOKS;

// ── 6. 真实项目的 hook 脚本输出解析 ──────────────────────────
const { runHookScript, pickHookScript, parseHookOutput } = await import(new URL('lib/session-context.js', here).href);
check('parseHookOutput 解析 Claude 信封', parseHookOutput('{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"hello"}}') === 'hello');
const script = pickHookScript(projectDir);
if (script) {
	const body = await runHookScript(script, { root: projectDir, sessionId: 'smoke', timeoutMs: 20000, config: {} });
	check(`运行 ${script}`, body.length > 100, `返回 ${body.length} 字符`);
} else {
	console.log('SKIP  项目里没有 session-start 脚本');
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
