/**
 * Client half of `@local/dsh-task-board`.
 *
 * Owns the composer task dock (the upstream registration is disabled by
 * `patch-task-board.js`) and renders one board over every agent that currently
 * has a todo list:
 *   - the on-screen Session's live `todos` projection,
 *   - each direct Subagent child whose own `todos` projection is non-empty —
 *     children without a list are not listed at all, so the board follows the
 *     actual work instead of every dispatched helper;
 *   - a dropdown switcher once more than one agent has a list (the tab strip
 *     overflowed with many Subagents), with the Subagent's catalog label as its
 *     name and the prompt title as the tooltip;
 *   - a stop control per agent and one for the whole Session, wired to the
 *     controller's own cancel paths;
 *   - "已暂停" with a static dot for `in_progress` items while the Session is
 *     not running, instead of a spinner that never stops.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-task-board',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'taskBoard';
    const zh = {
      'title': '任务',
      'tab.main': '当前会话',
      'agent.default': '子智能体 {n}',
      'empty': '暂无任务',
      'empty.running': '运行中 · 等待任务清单…',
      'status.completed': '已完成',
      'status.running': '进行中',
      'status.paused': '已暂停',
      'status.pending': '待处理',
      'status.open': '未完成',
      'status.waiting': '待确认',
      'status.resume': '待继续',
      'status.auditing': '审计中…',
      'progress.done': '{done} 已完成',
      'progress.active': '{active} 进行中',
      'progress.paused': '{paused} 已暂停',
      'progress.pending': '{pending} 待处理',
      'progress.open': '{pending} 未完成',
      'progress.waiting': '{pending} 待确认',
      'progress.resume': '{pending} 待继续',
      'progress.auditing': '审计中…',
      'activity': '正在：{text}',
      'guard.tracking': '任务守护 · 跟踪中',
      'guard.audited': '任务守护 · 已按实际进度校正 {n} 次',
      'guard.auditing': '任务守护 · 正在审计本轮…',
      'guard.final': '任务守护 · 本轮审计：{parts}',
      'guard.final.done': '完成 {n} 项',
      'guard.final.open': '{n} 项未完成',
      'guard.final.dropped': '移除 {n} 条预想任务',
      'guard.final.waiting': '等你确认',
      'guard.final.continued': '已要求继续（第 {n} 次）',
      'guard.final.deferred': '等你回复后继续：{items}',
      'guard.final.unfinished': '未完成：{items}',
      'guard.final.unfinishedAfter': '未完成：{items}（已追问 {n} 次）',
      'guard.final.fallback': '（审计模型未响应，按规则收口）',
      'count': '{done}/{total}',
      'collapse': '收起任务',
      'expand': '展开任务',
      'switch': '切换智能体',
      'stop': '停止',
      'stop.agent': '停止这个智能体',
      'stop.all': '停止整个会话',
      'stop.failed': '停止失败：{message}',
      'note.add': '添加备注',
      'note.placeholder': '给这条任务加备注，回车即时推送给模型',
      'note.push': '推送',
      'note.noted': '备注：{note}',
      'note.message': '任务「{task}」的备注：{note}',
      'note.failed': '备注推送失败：{message}',
      'note.offline': '模型通道未就绪，备注已保存，稍后可再次推送',
    };
    const en = {
      'title': 'Tasks',
      'tab.main': 'Current session',
      'agent.default': 'Subagent {n}',
      'empty': 'No tasks',
      'empty.running': 'Running · waiting for the task list…',
      'status.completed': 'Completed',
      'status.running': 'In progress',
      'status.paused': 'Paused',
      'status.pending': 'Pending',
      'status.open': 'Not done',
      'status.waiting': 'Needs you',
      'status.resume': 'Resuming',
      'status.auditing': 'Auditing…',
      'progress.done': '{done} completed',
      'progress.active': '{active} in progress',
      'progress.paused': '{paused} paused',
      'progress.pending': '{pending} pending',
      'progress.open': '{pending} not done',
      'progress.waiting': '{pending} need you',
      'progress.resume': '{pending} resuming',
      'progress.auditing': 'Auditing…',
      'activity': 'Now: {text}',
      'guard.tracking': 'Task guardian · tracking',
      'guard.audited': 'Task guardian · corrected from real progress {n}×',
      'guard.auditing': 'Task guardian · auditing this turn…',
      'guard.final': 'Task guardian · turn audit: {parts}',
      'guard.final.done': '{n} done',
      'guard.final.open': '{n} not done',
      'guard.final.dropped': '{n} speculative removed',
      'guard.final.waiting': 'waiting on you',
      'guard.final.continued': 'asked to continue (#{n})',
      'guard.final.deferred': 'After your reply: {items}',
      'guard.final.unfinished': 'Not done: {items}',
      'guard.final.unfinishedAfter': 'Not done: {items} (asked {n}×)',
      'guard.final.fallback': '(audit model silent; closed by rule)',
      'count': '{done}/{total}',
      'collapse': 'Collapse tasks',
      'expand': 'Expand tasks',
      'switch': 'Switch agent',
      'stop': 'Stop',
      'stop.agent': 'Stop this agent',
      'stop.all': 'Stop the whole session',
      'stop.failed': 'Stop failed: {message}',
      'note.add': 'Add note',
      'note.placeholder': 'Note for this task — Enter pushes it to the model',
      'note.push': 'Push',
      'note.noted': 'Note: {note}',
      'note.message': 'Note on task "{task}": {note}',
      'note.failed': 'Could not push the note: {message}',
      'note.offline': 'Model channel not ready; the note is saved and can be pushed again later',
    };

    const styles = {
      root: {
        position: 'relative',
        flex: 'none',
        boxSizing: 'border-box',
        width: 'calc(100% - var(--dsh-composer-side-clearance) * 2 - var(--dsh-composer-dock-inset) * 4)',
        maxWidth: 'calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) * 4)',
        margin: '0 auto',
        borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-specific-menu)',
        backdropFilter: 'var(--dsw-menu-backdrop-filter)',
        boxShadow: 'var(--dsw-elevation-panel)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      body: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '6px 12px',
      },
      header: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px',
        rowGap: '4px',
        width: '100%',
        minWidth: 0,
      },
      headerMain: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flex: 'auto',
        minWidth: 0,
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
      },
      lead: {
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      title: {
        flex: 'none',
        fontSize: 'var(--dsh-content-font-size, 13px)',
        fontWeight: 500,
        lineHeight: '24px',
      },
      progress: {
        flex: 'auto',
        minWidth: 0,
        fontSize: 'var(--dsh-content-font-size, 13px)',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-tertiary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      switchButton: {
        flex: '0 1 auto',
        minWidth: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        maxWidth: '60%',
        height: '26px',
        padding: '0 8px',
        borderRadius: 'var(--dsw-radius-sm)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '11px',
        lineHeight: '16px',
      },
      switchLabel: {
        minWidth: 0,
        flex: '0 1 auto',
        maxWidth: '170px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      iconButton: {
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        padding: 0,
        borderRadius: 'var(--dsw-radius-sm)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        font: 'inherit',
      },
      chevron: {
        flex: 'none',
        width: '28px',
        height: '28px',
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        cursor: 'pointer',
        fontSize: '10px',
        lineHeight: '16px',
      },
      menu: {
        position: 'absolute',
        left: '8px',
        right: '8px',
        bottom: 'calc(100% + 6px)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        maxHeight: 'min(260px, 45dvh)',
        padding: '6px',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-specific-menu)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        boxShadow: 'var(--dsw-elevation-prominent)',
      },
      menuRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: 0,
      },
      menuName: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flex: 'auto',
        minWidth: 0,
        height: '30px',
        padding: '0 8px',
        borderRadius: 'var(--dsw-radius-sm)',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        textAlign: 'left',
      },
      menuNameActive: {
        background: 'var(--dsw-alias-interactive-bg-hover)',
      },
      menuLabel: {
        flex: 'auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      menuCount: {
        flex: 'none',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: '10px',
      },
      stopAll: {
        marginTop: '4px',
        height: '28px',
        borderRadius: 'var(--dsw-radius-sm)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '11px',
      },
      list: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxHeight: '180px',
        margin: 0,
        padding: 0,
        listStyle: 'none',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      },
      item: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: 0,
      },
      itemRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        minWidth: 0,
        fontSize: 'var(--dsh-content-font-size, 13px)',
        lineHeight: '20px',
      },
      noteButton: {
        flex: 'none',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        cursor: 'pointer',
        padding: '0 2px',
        fontSize: '12px',
        lineHeight: '16px',
      },
      activity: {
        paddingLeft: '20px',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-state-business-primary)',
      },
      guardWarn: {
        margin: 0,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-error-primary))',
      },
      guard: {
        margin: 0,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      noteText: {
        paddingLeft: '20px',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      noteEditor: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        paddingLeft: '20px',
        minWidth: 0,
      },
      noteInput: {
        flex: 'auto',
        minWidth: 0,
        height: '24px',
        padding: '0 8px',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-sm)',
        background: 'var(--dsw-specific-menu)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '12px',
      },
      notePush: {
        flex: 'none',
        height: '24px',
        padding: '0 10px',
        border: 'none',
        borderRadius: 'var(--dsw-radius-sm)',
        background: 'var(--dsw-alias-state-business-primary)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '12px',
      },
      dot: {
        flex: 'none',
        boxSizing: 'border-box',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
      },
      content: {
        flex: 'auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      status: {
        flex: 'none',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      error: {
        margin: 0,
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-state-error-primary)',
      },
    };

    /** Minimal external store, used to hold the stop remotes once they mount. */
    function createSignal(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        get() { return value; },
        set(next) { value = next; for (const listener of [...listeners]) listener(); },
        subscribe(listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
      };
    }

    const stopSignal = createSignal(null);

    const isTodoList = (value) => Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object');

    const projectionTodosOf = function (row) {
      return row && row.projectionValues ? row.projectionValues.todos : undefined;
    };

    /**
     * Last non-null todo list seen per agent id. The Host resets the `todos`
     * projection to null on every `turn/start` (the agent rewrites the list for
     * the new turn), so a queued instruction in the main Session or a side chat
     * starting its own turn would blank the board until the next `todo_write`.
     * Keeping the last list until a new one arrives means adjustments show up
     * as they land instead of flickering out; an explicit empty list still
     * clears it.
     */
    const lastTodos = new Map();

    const stickyTodos = function (id, value) {
      if (isTodoList(value)) {
        if (value.length > 0) lastTodos.set(id, value);
        else lastTodos.delete(id);
        return value;
      }
      const kept = lastTodos.get(id);
      return kept === undefined ? [] : kept;
    };

    /** Persisted per-agent task notes: { [agentSessionId]: { [taskContent]: note } }. */
    const NOTES_KEY = 'dsh-task-board:notes:v1';

    const readNotes = function () {
      let raw;
      try {
        raw = globalThis.localStorage === undefined ? undefined : globalThis.localStorage.getItem(NOTES_KEY);
      } catch (_storageUnavailable) {
        return {};
      }
      if (raw === undefined || raw === null) return {};
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_invalidJson) {
        return {};
      }
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    };

    const writeNotes = function (notes) {
      try {
        if (globalThis.localStorage !== undefined) globalThis.localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
      } catch (_storageUnavailable) {}
    };

    const noteKeyOf = function (agentId, content) {
      return agentId + '\u0000' + content;
    };

    /**
     * Persisted fold preference, per Session: `{ [sessionId]: true }` when the
     * user folded the board on purpose. Component state alone cannot carry it
     * across a Session switch or a plugin hot-reload (dispose → apply clears
     * memory), so the intent lives in localStorage. Nothing overrides it at
     * render time: a running task never re-opens a board the user folded.
     */
    const COLLAPSED_KEY = 'dsh-task-board:collapsed:v1';

    const readCollapsedMap = function () {
      let raw;
      try {
        raw = globalThis.localStorage === undefined ? undefined : globalThis.localStorage.getItem(COLLAPSED_KEY);
      } catch (_storageUnavailable) {
        return {};
      }
      if (raw === undefined || raw === null) return {};
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_invalidJson) {
        return {};
      }
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    };

    const readCollapsedFlag = function (sessionId) {
      return readCollapsedMap()[sessionId] === true;
    };

    const writeCollapsedFlag = function (sessionId, folded) {
      const next = readCollapsedMap();
      if (folded) next[sessionId] = true;
      else delete next[sessionId];
      try {
        if (globalThis.localStorage !== undefined) globalThis.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch (_storageUnavailable) {}
    };

    const countsOf = function (todos) {
      let done = 0;
      let active = 0;
      let pending = 0;
      for (const item of todos) {
        if (item.status === 'completed') done += 1;
        else if (item.status === 'in_progress') active += 1;
        else pending += 1;
      }
      return { done, active, pending, total: todos.length };
    };

    /** How long after a completed turn the board waits for the guardian's verdict. */
    const FINAL_PENDING_MS = 30000;

    const guardOf = function (value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
    };

    /**
     * What an idle agent's unfinished rows mean, from the guardian view:
     * 'auditing' right after a completed turn, then the verdict ('waiting',
     * 'resume', 'open'); without a guardian an idle pending row is 'open' —
     * nothing is working on it, so "待处理" would overpromise.
     */
    const idleKindOf = function (agent, now) {
      if (agent.running) return null;
      const guard = agent.guard;
      if (guard === null) return 'open';
      const final = guardOf(guard.final);
      if (final === null && guard.endReason === 'completed' && typeof guard.endedAt === 'number' && now - guard.endedAt < FINAL_PENDING_MS) return 'auditing';
      if (final !== null && final.continued === true) return 'resume';
      if (final !== null && final.waitingUser === true) return 'waiting';
      return 'open';
    };

    const progressText = function (t, agent, now) {
      const { done, active, pending } = countsOf(agent.todos);
      const idle = idleKindOf(agent, now);
      if (idle === 'auditing' && active + pending > 0) {
        return [...done > 0 ? [t('progress.done', { done })] : [], t('progress.auditing')].join(' · ');
      }
      const paused = agent.running ? 0 : active;
      const running = agent.running ? active : 0;
      const pendingKey = idle === null ? 'progress.pending' : 'progress.' + idle;
      return [
        ...done > 0 ? [t('progress.done', { done })] : [],
        ...running > 0 ? [t('progress.active', { active: running })] : [],
        ...paused > 0 ? [t('progress.paused', { paused })] : [],
        ...pending > 0 ? [t(pendingKey, { pending })] : [],
      ].join(' · ');
    };

    const statusOf = function (item, agent, now) {
      if (item.status === 'completed') return { key: 'done', label: 'status.completed' };
      const idle = idleKindOf(agent, now);
      if (idle === 'auditing') return { key: 'pending', label: 'status.auditing' };
      if (item.status === 'in_progress') return agent.running ? { key: 'active', label: 'status.running' } : { key: 'paused', label: 'status.paused' };
      return { key: 'pending', label: idle === null ? 'status.pending' : 'status.' + idle };
    };

    /** One footer line saying what the guardian did for this agent, or null. */
    const guardText = function (t, agent, now) {
      const guard = agent.guard;
      if (guard === null) return null;
      if (agent.running) {
        const audits = typeof guard.audits === 'number' ? guard.audits : 0;
        return audits > 0 ? t('guard.audited', { n: audits }) : t('guard.tracking');
      }
      if (idleKindOf(agent, now) === 'auditing' && agent.todos.some(function (item) { return item.status !== 'completed'; })) return t('guard.auditing');
      const final = guardOf(guard.final);
      if (final === null) return null;
      const continuedCount = typeof final.continuedCount === 'number' && final.continuedCount > 0 ? final.continuedCount : 1;
      const deferred = Array.isArray(final.deferred) ? final.deferred : [];
      const parts = [
        ...final.done > 0 ? [t('guard.final.done', { n: final.done })] : [],
        ...final.open > 0 ? [t('guard.final.open', { n: final.open })] : [],
        ...final.dropped > 0 ? [t('guard.final.dropped', { n: final.dropped })] : [],
        ...final.waitingUser === true && deferred.length === 0 ? [t('guard.final.waiting')] : [],
        ...final.continued === true ? [t('guard.final.continued', { n: continuedCount })] : [],
      ];
      const text = t('guard.final', { parts: parts.join(' · ') });
      return final.fallback === true ? text + ' ' + t('guard.final.fallback') : text;
    };

    /** Rows the final audit took off the board, as footer lines: [{ text, warn }]. */
    const settledLines = function (t, agent) {
      if (agent.running || agent.guard === null) return [];
      const final = guardOf(agent.guard.final);
      if (final === null) return [];
      const lines = [];
      const deferred = Array.isArray(final.deferred) ? final.deferred : [];
      const unfinished = Array.isArray(final.unfinished) ? final.unfinished : [];
      if (deferred.length > 0) lines.push({ text: t('guard.final.deferred', { items: deferred.join('、') }), warn: false });
      if (unfinished.length > 0) {
        const asked = typeof final.continuedCount === 'number' ? final.continuedCount : 0;
        lines.push({
          text: asked > 0 ? t('guard.final.unfinishedAfter', { items: unfinished.join('、'), n: asked }) : t('guard.final.unfinished', { items: unfinished.join('、') }),
          warn: true,
        });
      }
      return lines;
    };

    /** The agent's live action while it runs ("运行命令 · 列出工作目录"). */
    const activityOf = function (agent) {
      if (!agent.running || agent.guard === null) return null;
      const text = typeof agent.guard.activity === 'string' && agent.guard.activity !== ''
        ? agent.guard.activity
        : typeof agent.guard.say === 'string' && agent.guard.say !== '' ? agent.guard.say : null;
      return text;
    };

    const dotStyle = function (kind, size) {
      const base = size ? { ...styles.dot, width: size, height: size } : styles.dot;
      if (kind === 'done') return { ...base, background: 'var(--dsw-alias-state-success-primary)' };
      if (kind === 'active') return { ...base, background: 'var(--dsw-alias-state-business-primary)' };
      return { ...base, background: 'transparent', border: '1.5px solid var(--dsw-alias-label-tertiary)' };
    };

    const contentStyle = function (kind) {
      if (kind === 'done') return { ...styles.content, color: 'var(--dsw-alias-label-tertiary)', textDecoration: 'line-through' };
      if (kind === 'active') return { ...styles.content, color: 'var(--dsw-alias-label-primary)', fontWeight: 500 };
      return styles.content;
    };

    /** The board; mounted in `conversation.input.dock`. */
    function TaskBoard(props) {
      const { t, sessionId, sessions, stopStore } = props;
      const remote = React.useSyncExternalStore(stopStore.subscribe, stopStore.get);
      const list = sessions.list;
      const snapshot = React.useSyncExternalStore(
        React.useCallback(function (listener) { return list.subscribe(listener); }, [list]),
        React.useCallback(function () { return list.getSnapshot(); }, [list]),
      );
      const projected = props.useProjection('todos');
      const catalog = props.useProjection('subagentCatalog');
      const selfGuard = guardOf(props.useProjection('taskGuardian'));
      const [now, setNow] = React.useState(function () { return Date.now(); });

      const [picked, setPicked] = React.useState(sessionId);
      const [userCollapsed, setUserCollapsed] = React.useState(function () { return readCollapsedFlag(sessionId); });
      const [menuOpen, setMenuOpen] = React.useState(false);
      const [busyId, setBusyId] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [notes, setNotes] = React.useState(readNotes);
      const [editing, setEditing] = React.useState(null);
      const [draft, setDraft] = React.useState('');

      const rows = (snapshot && snapshot.byId) || {};
      const self = rows[sessionId];
      const owner = props.session;
      const selfRunning = owner && typeof owner.running === 'boolean' ? owner.running : Boolean(self && self.running);
      const selfTodos = stickyTodos(sessionId, isTodoList(projected) || projected === null ? projected : projectionTodosOf(self));
      const agents = [];
      // A running Session always gets a board, even before its first todo
      // write: the panel is where the run state and the stop controls live.
      const selfFinal = selfGuard === null ? null : guardOf(selfGuard.final);
      const selfSettled = selfFinal !== null && ((Array.isArray(selfFinal.deferred) && selfFinal.deferred.length > 0) || (Array.isArray(selfFinal.unfinished) && selfFinal.unfinished.length > 0));
      if (selfTodos.length > 0 || selfRunning || selfSettled) {
        agents.push({ id: sessionId, title: t('tab.main'), todos: selfTodos, running: selfRunning, parent: undefined, guard: selfGuard });
      }
      const labels = new Map();
      if (Array.isArray(catalog)) {
        for (const entry of catalog) {
          if (entry && typeof entry.id === 'string' && typeof entry.label === 'string' && entry.label !== '') labels.set(entry.id, entry.label);
        }
      }
      const children = [];
      for (const row of Object.values(rows)) {
        if (!row || row.parentId !== sessionId) continue;
        const todos = stickyTodos(row.id, projectionTodosOf(row));
        if (todos.length === 0) continue;
        children.push({ row: row, todos: todos });
      }
      children.sort(function (a, b) {
        const left = typeof a.row.updatedAt === 'number' ? a.row.updatedAt : 0;
        const right = typeof b.row.updatedAt === 'number' ? b.row.updatedAt : 0;
        return left - right || String(a.row.id).localeCompare(String(b.row.id));
      });
      children.forEach(function (entry, index) {
        const child = entry.row;
        agents.push({
          id: child.id,
          title: labels.get(child.id) || t('agent.default', { n: index + 1 }),
          prompt: child.displayTitle || child.title || '',
          todos: entry.todos,
          running: Boolean(child.running),
          parent: sessionId,
          guard: guardOf(child.projectionValues ? child.projectionValues.taskGuardian : undefined),
        });
      });

      // Re-render when a pending "审计中" window closes, so a silent guardian
      // never leaves the label stuck.
      const auditDeadline = agents.reduce(function (soonest, agent) {
        const guard = agent.guard;
        if (agent.running || guard === null || guardOf(guard.final) !== null || guard.endReason !== 'completed' || typeof guard.endedAt !== 'number') return soonest;
        const at = guard.endedAt + FINAL_PENDING_MS;
        return at > Date.now() && (soonest === null || at < soonest) ? at : soonest;
      }, null);
      React.useEffect(function () {
        setNow(Date.now());
        if (auditDeadline === null) return undefined;
        const timer = setTimeout(function () { setNow(Date.now()); }, Math.max(0, auditDeadline - Date.now()) + 50);
        return function () { clearTimeout(timer); };
      }, [auditDeadline]);

      // Fold intent is per Session and lives in localStorage: a Session switch
      // may reuse this component and a hot-reload wipes its state, so re-read.
      // The user's choice wins even while tasks are running - a folded board
      // keeps its header counts live but never re-opens on its own.
      React.useEffect(function () {
        setUserCollapsed(readCollapsedFlag(sessionId));
      }, [sessionId]);

      const collapsed = userCollapsed;

      const toggleCollapsed = function () {
        const next = !userCollapsed;
        setUserCollapsed(next);
        writeCollapsedFlag(sessionId, next);
      };

      const agentKey = agents.map(function (agent) { return agent.id; }).join('|');
      React.useEffect(function () {
        if (!agents.some(function (agent) { return agent.id === picked; })) setPicked(sessionId);
        if (agents.length < 2) setMenuOpen(false);
      }, [agentKey]);

      const rootRef = React.useRef(null);

      React.useEffect(function () {
        if (!menuOpen) return undefined;
        const onDown = function (event) {
          const root = rootRef.current;
          if (root !== null && !root.contains(event.target)) setMenuOpen(false);
        };
        const onKey = function (event) {
          if (event.key === 'Escape') setMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey, true);
        return function () {
          document.removeEventListener('mousedown', onDown, true);
          document.removeEventListener('keydown', onKey, true);
        };
      }, [menuOpen]);

      if (agents.length === 0) return null;

      const selectedId = agents.some(function (agent) { return agent.id === picked; }) ? picked : agents[0].id;
      const selected = agents.find(function (agent) { return agent.id === selectedId; }) || agents[0];
      const anyRunning = agents.some(function (agent) { return agent.running; });

      const cancelOne = function (id, parentId) {
        // A session that is itself a subagent must go through its parent address;
        // `session.cancel` refuses agent-owned children.
        const address = parentId !== undefined
          ? { childSessionId: id, parentSessionId: parentId }
          : (typeof sessions.subagentAddress === 'function' ? sessions.subagentAddress(id) : undefined);
        if (address !== undefined && address.parentSessionId !== undefined) {
          return remote.subagents.interruptByParent(address.childSessionId, address.parentSessionId, 'continuable');
        }
        return remote.session.cancel({ sessionId: id });
      };

      const stopAgent = function (agent) {
        if (busyId !== null || remote === null) return;
        setBusyId(agent.id);
        setError(null);
        Promise.resolve(cancelOne(agent.id, agent.parent)).then(function (result) {
          if (result && result.ok === false) {
            setError(t('stop.failed', { message: result.error && result.error.message ? result.error.message : String(result.error && result.error.code ? result.error.code : 'error') }));
          }
        }).catch(function (reason) {
          setError(t('stop.failed', { message: reason instanceof Error ? reason.message : String(reason) }));
        }).finally(function () { setBusyId(null); });
      };

      const stopAll = function () {
        if (busyId !== null || remote === null) return;
        setBusyId('all');
        setError(null);
        const calls = [];
        if (selfRunning) calls.push(cancelOne(sessionId));
        for (const row of Object.values(rows)) {
          if (!row || row.parentId !== sessionId || !row.running) continue;
          calls.push(cancelOne(row.id, row.parentId));
        }
        Promise.allSettled(calls).then(function (results) {
          const bad = results.find(function (r) { return r.status === 'rejected' || (r.value && r.value.ok === false); });
          if (bad === undefined) return;
          const message = bad.status === 'rejected'
            ? (bad.reason instanceof Error ? bad.reason.message : String(bad.reason))
            : String(bad.value && bad.value.error && bad.value.error.message ? bad.value.error.message : bad.value && bad.value.error && bad.value.error.code ? bad.value.error.code : 'error');
          setError(t('stop.failed', { message: message }));
        }).finally(function () { setBusyId(null); });
      };

      /** Push one task note to the agent that owns the task, in real time. */
      const pushNote = function (agent, taskContent, text) {
        const channel = remote;
        if (channel === null || channel === undefined) return Promise.reject(new Error(t('note.offline')));
        const requestId = globalThis.crypto !== undefined && typeof globalThis.crypto.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : 'note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        const content = [{ type: 'text', text: t('note.message', { task: taskContent, note: text }) }];
        const mode = agent.running ? 'steer' : 'queue';
        const fail = function (result) {
          if (result !== undefined && result !== null && result.ok === false) {
            const failure = result.error;
            throw new Error(failure && failure.message ? failure.message : failure && failure.code ? failure.code : 'push failed');
          }
        };
        if (agent.parent !== undefined) {
          const address = typeof sessions.subagentAddress === 'function' ? sessions.subagentAddress(agent.id) : undefined;
          const parentSessionId = address !== undefined && address.parentSessionId !== undefined ? address.parentSessionId : agent.parent;
          return Promise.resolve(channel.subagents.prompt({ requestId: requestId, parentSessionId: parentSessionId, childSessionId: agent.id, mode: 'continuable', delivery: mode, content: content })).then(fail);
        }
        return Promise.resolve(channel.session.prompt({ requestId: requestId, sessionId: agent.id, mode: mode, content: content, clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })).then(fail);
      };

      /** Save one row's note (empty clears it) and push non-empty text to the model. */
      const saveNote = function (agent, taskContent, text) {
        const value = text.trim();
        setEditing(null);
        const next = { ...notes };
        const agentNotes = { ...(next[agent.id] ?? {}) };
        if (value === '') delete agentNotes[taskContent];
        else agentNotes[taskContent] = value;
        next[agent.id] = agentNotes;
        setNotes(next);
        writeNotes(next);
        if (value === '') return;
        setError(null);
        pushNote(agent, taskContent, value).catch(function (reason) {
          setError(t('note.failed', { message: reason instanceof Error ? reason.message : String(reason) }));
        });
      };

      const selectedCounts = countsOf(selected.todos);
      const header = h(
        'div',
        { style: styles.header },
        h(
          'button',
          {
            type: 'button',
            style: styles.headerMain,
            'aria-expanded': !collapsed,
            title: collapsed ? t('expand') : t('collapse'),
            onClick: toggleCollapsed,
          },
          h('span', { style: styles.lead, 'aria-hidden': true },
            h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
              h('path', { d: 'M2.5 4.5h1.8M2.5 8h1.8M2.5 11.5h1.8M6.2 4.5h7.3M6.2 8h7.3M6.2 11.5h7.3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
            ),
          ),
          h('span', { style: styles.title }, t('title')),
        ),
        agents.length > 1
          ? h(
              'button',
              {
                type: 'button',
                title: t('switch'),
                'aria-label': t('switch'),
                'aria-expanded': menuOpen,
                style: styles.switchButton,
                onClick: function () { setMenuOpen(function (value) { return !value; }); },
              },
              h('span', { style: dotStyle(selectedCounts.active > 0 ? (selected.running ? 'active' : 'paused') : 'pending', '6px'), 'aria-hidden': true }),
              h('span', { style: styles.switchLabel }, selected.title),
              h('span', { style: styles.menuCount }, t('count', { done: selectedCounts.done, total: selectedCounts.total })),
              h('span', { 'aria-hidden': true }, '▾'),
            )
          : null,
        h('span', { style: styles.progress }, progressText(t, selected, now)),
        selected.running && remote !== null
          ? h(
              'button',
              {
                type: 'button',
                style: styles.iconButton,
                title: t('stop.agent'),
                'aria-label': t('stop.agent'),
                disabled: busyId !== null,
                onClick: function () { stopAgent(selected); },
              },
              h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
                h('rect', { x: 2, y: 2, width: 8, height: 8, rx: 1.5, fill: 'currentColor' }),
              ),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            style: styles.chevron,
            'aria-label': collapsed ? t('expand') : t('collapse'),
            onClick: toggleCollapsed,
          },
          collapsed ? '▸' : '▾',
        ),
      );

      const menu = menuOpen && agents.length > 1
        ? h(
            'div',
            { style: styles.menu, role: 'menu', 'aria-label': t('switch') },
            agents.map(function (agent) {
              const counts = countsOf(agent.todos);
              const active = agent.id === selectedId;
              return h(
                'div',
                { key: agent.id, style: styles.menuRow },
                h(
                  'button',
                  {
                    type: 'button',
                    role: 'menuitemradio',
                    'aria-checked': active,
                    title: agent.prompt || agent.title,
                    style: active ? { ...styles.menuName, ...styles.menuNameActive } : styles.menuName,
                    onClick: function () {
                      setPicked(agent.id);
                      setMenuOpen(false);
                    },
                  },
                  h('span', { style: dotStyle(counts.active > 0 ? (agent.running ? 'active' : 'paused') : 'pending', '8px'), 'aria-hidden': true }),
                  h('span', { style: styles.menuLabel }, agent.title),
                  h('span', { style: styles.menuCount }, t('count', { done: counts.done, total: counts.total })),
                ),
                agent.running && remote !== null
                  ? h(
                      'button',
                      {
                        type: 'button',
                        style: styles.iconButton,
                        title: t('stop.agent'),
                        'aria-label': t('stop.agent'),
                        disabled: busyId !== null,
                        onClick: function () { stopAgent(agent); },
                      },
                      h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
                        h('rect', { x: 2, y: 2, width: 8, height: 8, rx: 1.5, fill: 'currentColor' }),
                      ),
                    )
                  : null,
              );
            }),
            anyRunning && remote !== null
              ? h('button', { type: 'button', style: styles.stopAll, disabled: busyId !== null, onClick: stopAll }, t('stop.all'))
              : null,
          )
        : null;

      const activity = activityOf(selected);
      const activityIndex = activity === null ? -1 : selected.todos.findIndex(function (item) { return item.status === 'in_progress'; });
      const guardLine = guardText(t, selected, now);
      const settled = collapsed ? [] : settledLines(t, selected);
      const listOrEmpty = selected.todos.length === 0
        ? h('p', { style: styles.status }, selected.running ? (activity === null ? t('empty.running') : t('activity', { text: activity })) : t('empty'))
        : h('ul', { style: styles.list },
            selected.todos.map(function (item, index) {
              const status = statusOf(item, selected, now);
              const noteKey = noteKeyOf(selected.id, item.content);
              const agentNotes = notes[selected.id] ?? {};
              const note = typeof agentNotes[item.content] === 'string' ? agentNotes[item.content] : '';
              const open = editing === noteKey;
              return h('li', { key: String(index) + ':' + String(item.content), style: styles.item, 'data-status': item.status },
                h('div', { style: styles.itemRow },
                  h('span', { style: dotStyle(status.key), 'aria-hidden': true }),
                  h('span', { style: contentStyle(status.key), title: item.content }, item.content),
                  h('button', {
                    type: 'button',
                    style: styles.noteButton,
                    title: t('note.add'),
                    'aria-label': t('note.add'),
                    onClick: function () {
                      if (open) { setEditing(null); return; }
                      setEditing(noteKey);
                      setDraft(note);
                    },
                  }, '✎'),
                  h('span', { style: styles.status }, t(status.label)),
                ),
                index === activityIndex
                  ? h('div', { style: styles.activity, title: activity, 'aria-live': 'polite' }, t('activity', { text: activity }))
                  : null,
                note !== '' && !open
                  ? h('div', { style: styles.noteText, title: t('note.noted', { note: note }) }, t('note.noted', { note: note }))
                  : null,
                open
                  ? h('div', { style: styles.noteEditor },
                      h('input', {
                        style: styles.noteInput,
                        value: draft,
                        placeholder: t('note.placeholder'),
                        'aria-label': t('note.add'),
                        onChange: function (event) { setDraft(event.target.value); },
                        onKeyDown: function (event) {
                          if (event.key === 'Enter') { event.preventDefault(); saveNote(selected, item.content, draft); }
                          else if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
                        },
                      }),
                      h('button', {
                        type: 'button',
                        style: styles.notePush,
                        onClick: function () { saveNote(selected, item.content, draft); },
                      }, t('note.push')),
                    )
                  : null,
              );
            }),
          );

      return h('section', { ref: rootRef, style: styles.root, 'aria-label': t('title') },
        h('div', { style: styles.body },
          header,
          collapsed ? null : listOrEmpty,
          collapsed || guardLine === null ? null : h('p', { style: styles.guard, title: selected.guard && selected.guard.final && selected.guard.final.reason ? selected.guard.final.reason : guardLine }, guardLine),
          settled.map(function (line, index) {
            return h('p', { key: 'settled-' + index, style: line.warn ? styles.guardWarn : styles.guard, title: line.text }, line.text);
          }),
          error === null ? null : h('p', { style: styles.error, role: 'alert' }, error),
        ),
        menu,
      );
    }

    const inject = ['slots', 'sessions', 'locale'];

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'task-board: dictionaries');
      const sessions = ctx.get('sessions');
      // The stop remotes are optional: without them the board still lists tasks,
      // it just hides the stop controls.
      ctx.inject(['remote', 'remote.session', 'remote.subagents'], function (scope) {
        stopSignal.set(scope.remote);
        scope.effect(function () {
          return function () { stopSignal.set(null); };
        }, 'task-board: stop remotes');
      });
      ctx.effect(function () {
        return ctx.slots.inject('conversation.input.dock', function () {
          return ctx.slots.register({
            name: 'conversation.input.dock',
            id: 'task-board',
            order: 0,
            locale: NS,
            inject: function (sessionId) {
              return { sessionId: sessionId, sessions: sessions, stopStore: stopSignal };
            },
          }, TaskBoard);
        });
      }, 'task-board: dock');
    }

    return { apply: apply, inject: inject };
  },
});
