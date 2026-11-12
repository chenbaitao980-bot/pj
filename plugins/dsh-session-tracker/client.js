/**
 * Client half of `@local/dsh-session-tracker`.
 *
 * Mounts the tracker panel above the workspace browser (the frozen sidebar
 * patch declares `sidebar.tracker` and mounts it) and raises desktop attention
 * notifications for Sessions that start waiting on the user.
 *
 * Data sources (all root-level, so the panel sees every Session):
 *   sessions.list        — title / cwd / updatedAt / parentId per Session
 *   uiSession.sessionStatus — { running, pendingInteraction, completionUnread }
 *   workspaces.list      — archived Session ids (archived rows cannot open)
 *
 * Buckets, in the order they are drawn:
 *   等你处理   pendingInteraction.kind ∈ question | approval | plan-review
 *   运行中     running
 *   待确认     completionUnread — a turn finished while the Session was not
 *              the visible main view, and the user has not opened it since
 *
 * Notifications: the desktop preload patch exposes `dshDesktop.attention`
 * (system notification + `onOpen`). The Host suppresses the notification while
 * its window is visible, unminimised and focused; clicking it shows the window
 * and sends the Session id back, which this module opens.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-tracker',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Side chats carry `⧉ <main-session-id> · <name>` so the Host can pair
    // them with their parent. Tracker rows and notifications show only <name>.
    const SIDE_TITLE_RE = /^⧉ [^ ]+ · /u;
    const sideTitleText = function (title) {
      return typeof title === 'string' ? title.replace(SIDE_TITLE_RE, '') : title;
    };
    const isSideTitle = function (title) {
      return typeof title === 'string' && SIDE_TITLE_RE.test(title);
    };

    const NS = 'sessionTracker';
    const COLLAPSED_KEY = 'dsh-session-tracker:collapsed:v1';
    const STYLE_ID = 'dsh-session-tracker-styles';

    const zh = {
      'title': '会话追踪',
      'collapse': '收起会话追踪',
      'expand': '展开会话追踪',
      'badge.running': '{n} 运行',
      'badge.pending': '{n} 待回答',
      'badge.done': '{n} 待确认',
      'all.idle': '全部空闲',
      'section.pending': '等你处理',
      'section.running': '运行中',
      'section.done': '已完成待确认',
      'status.question': '等待回答',
      'status.approval': '等待审批',
      'status.plan-review': '计划待审',
      'row.running': '运行中',
      'row.done': '待确认',
      'child': '子智能体',
      'side': '副会话',
      'untitled': '未命名会话',
      'ago.now': '刚刚',
      'ago.min': '{n} 分钟前',
      'ago.hour': '{n} 小时前',
      'ago.day': '{n} 天前',
      'notify.question': '会话在等你回答',
      'notify.approval': '会话在等你审批',
      'notify.plan-review': '计划在等你确认',
      'notify.body': '点击回到这个会话继续处理。',
    };
    const en = {
      'title': 'Session tracker',
      'collapse': 'Collapse session tracker',
      'expand': 'Expand session tracker',
      'badge.running': '{n} running',
      'badge.pending': '{n} waiting',
      'badge.done': '{n} unread',
      'all.idle': 'All idle',
      'section.pending': 'Waiting on you',
      'section.running': 'Running',
      'section.done': 'Finished, unread',
      'status.question': 'Waiting for an answer',
      'status.approval': 'Waiting for approval',
      'status.plan-review': 'Plan awaiting review',
      'row.running': 'Running',
      'row.done': 'Unread',
      'child': 'Subagent',
      'side': 'Side chat',
      'untitled': 'Untitled session',
      'ago.now': 'just now',
      'ago.min': '{n} min ago',
      'ago.hour': '{n} h ago',
      'ago.day': '{n} d ago',
      'notify.question': 'A session is waiting for your answer',
      'notify.approval': 'A session is waiting for your approval',
      'notify.plan-review': 'A plan is waiting for your review',
      'notify.body': 'Click to return to this session.',
    };

    const styles = {
      root: {
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        marginBottom: '6px',
        paddingRight: 'var(--dsh-session-list-edge-inset, 8px)',
        boxSizing: 'border-box',
      },
      header: {
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        minHeight: '32px',
        padding: '0 6px 0 8px',
        boxSizing: 'border-box',
        border: 'none',
        borderRadius: 'var(--dsw-radius-md)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        textAlign: 'left',
      },
      lead: {
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        border: '1.5px solid var(--dsw-alias-state-business-primary)',
        boxSizing: 'border-box',
      },
      title: {
        flex: 'none',
        fontWeight: 500,
        letterSpacing: '.02em',
        color: 'var(--dsw-alias-label-secondary)',
      },
      badges: {
        flex: 'auto',
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '8px',
        overflow: 'hidden',
      },
      badge: {
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
        whiteSpace: 'nowrap',
      },
      quiet: {
        flex: 'none',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
        whiteSpace: 'nowrap',
      },
      dot: {
        flex: 'none',
        display: 'inline-block',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
      },
      chevron: {
        flex: 'none',
        width: '16px',
        textAlign: 'center',
        fontSize: '10px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      body: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        minHeight: 0,
        maxHeight: '42vh',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        paddingBottom: '2px',
      },
      sectionLabel: {
        padding: '6px 8px 2px',
        fontSize: '11px',
        lineHeight: '14px',
        letterSpacing: '.04em',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      row: {
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        minHeight: '28px',
        padding: '0 8px',
        boxSizing: 'border-box',
        border: 'none',
        borderRadius: 'var(--dsw-radius-sm)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '18px',
        textAlign: 'left',
      },
      rowTitle: {
        flex: 'auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      rowMeta: {
        flex: 'none',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
        whiteSpace: 'nowrap',
      },
    };

    const COLOR = {
      question: 'var(--dsw-alias-state-warn-primary)',
      approval: 'var(--dsw-alias-state-warn-primary)',
      'plan-review': 'var(--dsw-alias-state-warn-primary)',
      running: 'var(--dsw-alias-state-business-primary)',
      done: 'var(--dsw-alias-state-success-primary)',
    };

    function installStyle() {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID) !== null) return;
      const tag = document.createElement('style');
      tag.id = STYLE_ID;
      tag.textContent = [
        '[data-dsh-session-tracker] button:hover{background-color:var(--dsw-alias-interactive-bg-hover)}',
        '[data-dsh-session-tracker] button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
        '@keyframes dsh-session-tracker-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
        '[data-dsh-session-tracker] .dsh-session-tracker-pulse{animation:dsh-session-tracker-pulse 1.8s ease-in-out infinite}',
        '@media (prefers-reduced-motion:reduce){[data-dsh-session-tracker] .dsh-session-tracker-pulse{animation:none}}',
      ].join('\n');
      document.head.appendChild(tag);
    }

    function readCollapsed() {
      try {
        return window.localStorage.getItem(COLLAPSED_KEY) === '1';
      } catch (_error) {
        return false;
      }
    }

    function writeCollapsed(value) {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
      } catch (_error) {
        // Private mode and friends: collapse state simply is not remembered.
      }
    }

    function useStoreValue(store) {
      const subscribe = React.useCallback(function (listener) {
        if (store === null || store === undefined || typeof store.subscribe !== 'function') return function () {};
        return store.subscribe(listener);
      }, [store]);
      const snapshot = React.useCallback(function () {
        if (store === null || store === undefined || typeof store.getSnapshot !== 'function') return undefined;
        return store.getSnapshot();
      }, [store]);
      return React.useSyncExternalStore(subscribe, snapshot);
    }

    function timeOf(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return 0;
    }

    function relativeTime(value, now, t) {
      const at = timeOf(value);
      if (at === 0) return '';
      const diff = Math.max(0, now - at);
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return t('ago.now');
      if (minutes < 60) return t('ago.min', { n: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('ago.hour', { n: hours });
      return t('ago.day', { n: Math.floor(hours / 24) });
    }

    /** One-line excerpt of what the Session is waiting for. */
    function pendingSnippet(interaction) {
      if (interaction === null || interaction === undefined) return '';
      if (Array.isArray(interaction.questions)) {
        for (const question of interaction.questions) {
          if (question !== null && typeof question === 'object' && typeof question.question === 'string' && question.question.trim() !== '') return question.question.trim();
        }
      }
      if (typeof interaction.displayReason === 'string' && interaction.displayReason.trim() !== '') return interaction.displayReason.trim();
      if (typeof interaction.reason === 'string' && interaction.reason.trim() !== '') return interaction.reason.trim();
      if (typeof interaction.toolName === 'string' && interaction.toolName.trim() !== '') return interaction.toolName.trim();
      return '';
    }

    function pendingKind(kind) {
      return kind === 'question' || kind === 'approval' || kind === 'plan-review' ? kind : null;
    }

    function byUpdatedDesc(left, right) {
      return right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
    }

    /** The tracker; mounted in `sidebar.tracker` (wide sidebar only). */
    function TrackerPanel(props) {
      const { t, openSession } = props;
      const list = useStoreValue(props.sessionsStore);
      const statusSnapshot = useStoreValue(props.statusStore);
      const statuses = statusSnapshot instanceof Map ? statusSnapshot : new Map();
      const workspaces = useStoreValue(props.workspacesStore);
      const [collapsed, setCollapsed] = React.useState(readCollapsed);
      const [now, setNow] = React.useState(function () { return Date.now(); });

      React.useEffect(function () {
        const timer = window.setInterval(function () { setNow(Date.now()); }, 30000);
        return function () { window.clearInterval(timer); };
      }, []);

      React.useEffect(function () {
        installStyle();
      }, []);

      const archived = new Set(workspaces !== null && workspaces !== undefined && Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : []);
      const byId = list !== null && list !== undefined && list.byId !== undefined ? list.byId : {};
      const pending = [];
      const running = [];
      const done = [];

      // Subagent Sessions run under their parent: their activity keeps the
      // parent's row in "运行中", but they only get a row of their own when they
      // are the ones waiting on the user (questions/approvals come per Session).
      const childRunning = new Map();
      for (const row of Object.values(byId)) {
        if (row === null || typeof row !== 'object' || row.origin !== 'subagent') continue;
        if (typeof row.parentId !== 'string' || row.parentId === '') continue;
        const status = statuses.get(row.id);
        if (status !== undefined && status.running === true) childRunning.set(row.parentId, (childRunning.get(row.parentId) || 0) + 1);
      }

      for (const row of Object.values(byId)) {
        if (row === null || typeof row !== 'object') continue;
        if (typeof row.id !== 'string' || row.blank === true || archived.has(row.id)) continue;
        const isChild = row.origin === 'subagent';
        const rawTitle = typeof row.title === 'string' ? row.title.trim() : '';
        const status = statuses.get(row.id);
        const kind = status === undefined ? null : pendingKind(status.pendingInteraction !== undefined && status.pendingInteraction !== null ? status.pendingInteraction.kind : undefined);
        if (isChild && kind === null) continue;
        const entry = {
          id: row.id,
          title: sideTitleText(rawTitle),
          cwd: typeof row.cwd === 'string' ? row.cwd : '',
          updatedAt: timeOf(row.updatedAt),
          kind: kind,
          snippet: kind === null ? '' : pendingSnippet(status.pendingInteraction),
          child: isChild,
          side: isSideTitle(rawTitle),
        };
        if (kind !== null) {
          pending.push(entry);
        } else if ((status !== undefined ? status.running === true : row.running === true) || (childRunning.get(row.id) || 0) > 0) {
          running.push(entry);
        } else if (status !== undefined && status.completionUnread === true) {
          // A finished side chat is visible in the workspace tree under its
          // parent. Keeping it out of “finished, unread” avoids the very
          // “已完成待确认” noise the tree was meant to remove.
          if (!entry.side) done.push(entry);
        }
      }

      pending.sort(byUpdatedDesc);
      running.sort(byUpdatedDesc);
      done.sort(byUpdatedDesc);

      const total = pending.length + running.length + done.length;

      const toggle = function () {
        setCollapsed(function (value) {
          const next = !value;
          writeCollapsed(next);
          return next;
        });
      };

      const displayTitle = function (entry) {
        if (entry.title === '') return t('untitled');
        return entry.side ? '↳ ' + entry.title : entry.title;
      };

      const scopeLabel = function (entry) {
        return entry.child ? t('child') : entry.side ? t('side') : '';
      };

      const withScope = function (entry, text) {
        const label = scopeLabel(entry);
        return label === '' ? text : label + ' · ' + text;
      };

      const row = function (entry, meta, color, pulse) {
        const title = displayTitle(entry);
        const tooltip = entry.snippet !== '' ? title + '\n' + entry.snippet : entry.cwd !== '' ? title + '\n' + entry.cwd : title;
        return h('button', {
          key: entry.id,
          type: 'button',
          style: styles.row,
          title: tooltip,
          onClick: function () { if (typeof openSession === 'function') openSession(entry.id); },
        },
          h('span', {
            style: { ...styles.dot, background: color },
            className: pulse ? 'dsh-session-tracker-pulse' : undefined,
            'aria-hidden': true,
          }),
          h('span', { style: styles.rowTitle }, title),
          h('span', { style: styles.rowMeta }, meta));
      };

      const section = function (label, rows) {
        if (rows.length === 0) return null;
        return [h('div', { key: 'label:' + label, style: styles.sectionLabel }, label)].concat(rows);
      };

      const pendingRows = pending.map(function (entry) {
        return row(entry, withScope(entry, t('status.' + entry.kind)), COLOR[entry.kind], true);
      });
      const runningRows = running.map(function (entry) {
        return row(entry, withScope(entry, relativeTime(entry.updatedAt, now, t) || t('row.running')), COLOR.running, false);
      });
      const doneRows = done.map(function (entry) {
        return row(entry, withScope(entry, relativeTime(entry.updatedAt, now, t) || t('row.done')), COLOR.done, false);
      });

      const badge = function (key, count, color) {
        if (count === 0) return null;
        return h('span', { key: key, style: styles.badge },
          h('span', { style: { ...styles.dot, background: color }, 'aria-hidden': true }),
          t(key, { n: count }));
      };

      return h('section', {
        style: styles.root,
        'data-dsh-session-tracker': true,
        'aria-label': t('title'),
      },
        h('button', {
          type: 'button',
          style: styles.header,
          'aria-expanded': !collapsed,
          title: collapsed ? t('expand') : t('collapse'),
          onClick: toggle,
        },
          h('span', { style: styles.lead, 'aria-hidden': true }),
          h('span', { style: styles.title }, t('title')),
          h('span', { style: styles.badges },
            badge('badge.pending', pending.length, COLOR.question),
            badge('badge.running', running.length, COLOR.running),
            badge('badge.done', done.length, COLOR.done),
            total === 0 ? h('span', { style: styles.quiet }, t('all.idle')) : null),
          h('span', { style: styles.chevron, 'aria-hidden': true }, collapsed ? '▸' : '▾')),
        collapsed || total === 0 ? null : h('div', { style: styles.body },
          section(t('section.pending'), pendingRows),
          section(t('section.running'), runningRows),
          section(t('section.done'), doneRows)));
    }

    const inject = ['slots', 'sessions', 'uiSession', 'uiWorkspace', 'workspaces', 'locale'];

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'session-tracker: dictionaries');
      installStyle();

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.tracker', function () {
          return ctx.slots.register({
            name: 'sidebar.tracker',
            locale: NS,
            inject: function () {
              return {
                sessionsStore: ctx.sessions.list,
                statusStore: ctx.uiSession.sessionStatus,
                workspacesStore: ctx.workspaces.list,
                openSession: function (sessionId) {
                  try {
                    const outcome = ctx.get('uiWorkspace').openSession(sessionId);
                    if (outcome !== undefined && outcome !== null && typeof outcome.catch === 'function') outcome.catch(function () {});
                  } catch (error) {
                    console.warn('session-tracker: open failed', error);
                  }
                },
              };
            },
          }, TrackerPanel);
        });
      }, 'session-tracker: sidebar panel');

      // Desktop attention notifications: one per Session per pending period.
      ctx.effect(function () {
        const bridge = globalThis.dshDesktop !== undefined && globalThis.dshDesktop !== null ? globalThis.dshDesktop.attention : undefined;
        if (bridge === undefined || bridge === null || typeof bridge.notify !== 'function') return;
        const t = ctx.locale.bind(NS);
        const seen = new Map();
        const check = function () {
          let statuses;
          try {
            statuses = ctx.uiSession.sessionStatus.getSnapshot();
          } catch (error) {
            return;
          }
          let byId = {};
          try {
            byId = ctx.sessions.list.getSnapshot().byId || {};
          } catch (error) {
            byId = {};
          }
          for (const [sessionId, status] of statuses) {
            const kind = status === undefined || status.pendingInteraction === undefined || status.pendingInteraction === null ? null : pendingKind(status.pendingInteraction.kind);
            if (kind === null) {
              seen.delete(sessionId);
              continue;
            }
            if (seen.get(sessionId) === kind) continue;
            seen.set(sessionId, kind);
            const summary = byId[sessionId];
            const rawName = summary !== undefined && typeof summary.title === 'string' ? summary.title.trim() : '';
            const name = rawName === '' ? t('untitled') : sideTitleText(rawName);
            const snippet = pendingSnippet(status.pendingInteraction);
            try {
              const outcome = bridge.notify({
                sessionId: sessionId,
                kind: kind,
                session: name,
                title: t('notify.' + kind) + ' · ' + name,
                body: snippet !== '' ? snippet.slice(0, 180) : t('notify.body'),
              });
              if (outcome !== undefined && outcome !== null && typeof outcome.catch === 'function') outcome.catch(function () {});
            } catch (error) {
              console.warn('session-tracker: notification failed', error);
            }
          }
          for (const sessionId of Array.from(seen.keys())) {
            const status = statuses.get(sessionId);
            if (status === undefined || status.pendingInteraction === undefined || status.pendingInteraction === null) seen.delete(sessionId);
          }
        };
        const stopStatus = ctx.uiSession.sessionStatus.subscribe(check);
        const stopList = ctx.sessions.list.subscribe(check);
        let disposeOpen;
        if (typeof bridge.onOpen === 'function') {
          disposeOpen = bridge.onOpen(function (request) {
            const sessionId = request !== null && request !== undefined && typeof request.sessionId === 'string' ? request.sessionId : '';
            if (sessionId === '') return;
            try {
              const outcome = ctx.get('uiWorkspace').openSession(sessionId);
              if (outcome !== undefined && outcome !== null && typeof outcome.catch === 'function') outcome.catch(function () {});
            } catch (error) {
              console.warn('session-tracker: open from notification failed', error);
            }
          });
        }
        check();
        return function () {
          if (typeof stopStatus === 'function') stopStatus();
          if (typeof stopList === 'function') stopList();
          if (typeof disposeOpen === 'function') disposeOpen();
        };
      }, 'session-tracker: attention notifications');
    }

    return { apply: apply, inject: inject };
  },
});
