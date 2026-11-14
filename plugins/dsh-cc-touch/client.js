/**
 * Client half of `@local/dsh-cc-touch`.
 *
 * Claude Code's sidebar feels softer than DSH's because a row animates its
 * fill over roughly 120 ms on an ease-out-snap curve and lands on a two-step
 * alpha ramp, while DSH swaps the background within one frame at a single
 * fixed alpha. This module adds the missing tokens and re-points the sidebar
 * rows and icon buttons at them. It only touches colour and timing — no
 * sizing, spacing, or layout rule is overridden — so nothing can shift.
 *
 * Every selector is attribute-based rather than a fixed CSS-Modules hash:
 * the hashed prefixes below are the current build's, and the generic
 * `_sessionRow` / `_projectRow` fallbacks keep the feel alive if a later
 * build reshuffles the hash without changing the semantic class name.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-cc-touch',
  factory() {
    const STYLE_ID = '@local/dsh-cc-touch/touch.css';

    const CSS = [
      /* Four-step alpha ramp on top of the live label colour, so the same
         tokens work in the light and the dark theme without a media query. */
      ':root {',
      '  --dsh-alpha-1: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);',
      '  --dsh-alpha-2: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);',
      '  --dsh-alpha-3: color-mix(in srgb, var(--dsw-alias-label-primary) 13%, transparent);',
      '  --dsh-alpha-4: color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);',
      '  --dsh-dur-snap: 120ms;',
      '  --dsh-dur-fast: 160ms;',
      '  --dsh-ease-snap: cubic-bezier(.32, .72, 0, 1);',
      '  --dsh-ease-out: cubic-bezier(0, 0, .2, 1);',
      '}',
      '',
      /* Dense lists read an instantaneous fill as a flicker, so animate it. */
      '[class*="wtg9ga_iconButton"],',
      '[class*="wtg9ga_panelRow"],',
      '[class*="wtg9ga_newSession"],',
      '[class*="wnFoaW_sessionRow"],',
      '[class*="wnFoaW_projectRow"],',
      '[class*="wnFoaW_searchResultRow"],',
      '[class*="wnFoaW_iconButton"],',
      '[class*="GAkraW_searchButton"],',
      '[class*="GAkraW_clearButton"],',
      '[class*="_sessionRow"],',
      '[class*="_projectRow"] {',
      '  transition:',
      '    background-color var(--dsh-dur-snap) var(--dsh-ease-snap),',
      '    color var(--dsh-dur-snap) var(--dsh-ease-snap),',
      '    box-shadow var(--dsh-dur-snap) var(--dsh-ease-snap);',
      '}',
      '',
      '@media (hover: hover) {',
      '  html [class*="wtg9ga_iconButton"]:hover,',
      '  html [class*="wtg9ga_panelRow"]:hover,',
      '  html [class*="wnFoaW_sessionRow"]:hover,',
      '  html [class*="wnFoaW_projectRow"]:hover,',
      '  html [class*="wnFoaW_searchResultRow"]:hover,',
      '  html [class*="_sessionRow"]:hover,',
      '  html [class*="_projectRow"]:hover {',
      '    background-color: var(--dsh-alpha-2);',
      '  }',
      '',
      /* The label also lifts one step, which is most of what "feels alive"
         in CC: the glyph brightens while the plate fills. */
      '  html [class*="wtg9ga_iconButton"]:hover,',
      '  html [class*="wnFoaW_iconButton"]:hover {',
      '    color: var(--dsw-alias-label-primary);',
      '  }',
      '',
      /* The new-session pill has a more specific shipped rule, so it needs
         the doubled pseudo-class to land on the same ramp. */
      '  html [class*="wtg9ga_newSession"]:hover:hover {',
      '    background-color: var(--dsh-alpha-2);',
      '  }',
      '}',
      '',
      /* Pressed state sits one step deeper, so a click has a visible floor. */
      'html [class*="wtg9ga_iconButton"]:active,',
      'html [class*="wnFoaW_sessionRow"]:active,',
      'html [class*="_sessionRow"]:active {',
      '  background-color: var(--dsh-alpha-3);',
      '  transition-duration: 60ms;',
      '}',
      '',
      /* Focus follows the same curve instead of the browser default. */
      'html [class*="wtg9ga_iconButton"]:focus-visible,',
      'html [class*="wnFoaW_sessionRow"]:focus-visible,',
      'html [class*="_sessionRow"]:focus-visible {',
      '  outline: 2px solid var(--dsw-alias-state-business-primary);',
      '  outline-offset: -2px;',
      '}',
      '',
      /* Skeleton shown while a Session journal is still opening. The chat
         view replaces its whole message area with one hint line during
         `openState === "loading"`, which reads as a flicker even when the
         journal only needs 15 ms; four pulsing bars read as content arriving. */
      '@keyframes dsh-chat-skeleton-pulse {',
      '  0%, 100% { opacity: .5; }',
      '  50% { opacity: .95; }',
      '}',
      '',
      '.dsh-chat-skeleton {',
      '  height: 168px;',
      '  margin: 24px;',
      '  background-repeat: no-repeat;',
      '  background-image:',
      '    linear-gradient(var(--dsh-alpha-2), var(--dsh-alpha-2)),',
      '    linear-gradient(var(--dsh-alpha-2), var(--dsh-alpha-2)),',
      '    linear-gradient(var(--dsh-alpha-2), var(--dsh-alpha-2)),',
      '    linear-gradient(var(--dsh-alpha-2), var(--dsh-alpha-2));',
      '  background-size: 62% 12px, 88% 12px, 74% 12px, 46% 12px;',
      '  background-position: 0 6px, 0 38px, 0 70px, 0 102px;',
      '  animation: dsh-chat-skeleton-pulse 1.4s ease-in-out infinite;',
      '}',
      '',
      '@media (prefers-reduced-motion: reduce) {',
      '  .dsh-chat-skeleton { animation: none; opacity: .7; }',
      '}',
    ].join('\n');

    /** Short verbs for the running indicator, so a Turn says what it is doing. */
    const TOOL_VERBS = {
      zh: { edit: '正在编辑', exec: '正在运行命令', read: '正在读取', search: '正在检索', todo: '正在整理任务', mcp: '正在调用 MCP', agent: '正在分派子任务' },
      en: { edit: 'Editing', exec: 'Running command', read: 'Reading', search: 'Searching', todo: 'Updating tasks', mcp: 'Calling MCP', agent: 'Delegating' },
    };

    const TOOL_KINDS = [
      ['edit', ['write', 'edit', 'apply_patch', 'create_file', 'str_replace', 'notebook_edit']],
      ['exec', ['bash', 'pwsh', 'shell', 'exec', 'run_command', 'run_terminal_cmd']],
      ['read', ['read', 'read_image', 'view_image', 'grep', 'glob', 'ls', 'list_dir']],
      ['search', ['web_search', 'web_fetch', 'web_search_meta']],
      ['todo', ['todo_write', 'todo_read', 'update_plan', 'plan']],
      ['agent', ['subagent', 'subagent_fork', 'workflow']],
    ];

    const FILE_PATTERN = /[\w@.-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|css|html|py|go|java|rs|yaml|yml|ps1|sh|sql|svg|txt)/i;

    function isZh() {
      const lang = (document.documentElement && document.documentElement.lang) || navigator.language || 'zh';
      return String(lang).toLowerCase().indexOf('zh') === 0;
    }

    function kindOf(toolName) {
      if (typeof toolName !== 'string') return null;
      if (toolName.indexOf('mcp__') === 0) return 'mcp';
      for (let i = 0; i < TOOL_KINDS.length; i += 1) {
        if (TOOL_KINDS[i][1].indexOf(toolName) !== -1) return TOOL_KINDS[i][0];
      }
      return null;
    }

    /**
     * Label for the running indicator, resolved on every tick from the Tool
     * card the transcript is currently executing. `data-state="running"` is
     * what keeps this honest: a card left over from an earlier Turn is done,
     * so it never claims work that is not happening. Returns null when nothing
     * is running, which lets the shipped copy stay in charge.
     */
    function runningLabel() {
      const cards = document.querySelectorAll('[data-tool][data-state="running"]');
      if (cards.length === 0) return null;
      const card = cards[cards.length - 1];
      const kind = kindOf(card.getAttribute('data-tool'));
      if (kind === null) return null;
      const verb = TOOL_VERBS[isZh() ? 'zh' : 'en'][kind];
      if (kind === 'mcp' || kind === 'todo' || kind === 'agent' || kind === 'exec') return verb;
      const match = String(card.innerText || '').slice(0, 600).match(FILE_PATTERN);
      if (match === null) return verb;
      return verb + ' ' + match[0].split(/[\\/]/).pop();
    }

    function apply(ctx) {
      ctx.effect(function () {
        const mounted = document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']');
        if (mounted !== null) return function () {};
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/dsh-cc-touch';
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return function () {
          tag.remove();
        };
      });

      /* Opening a Session journal is what makes a switch feel slow: the view
         shows its loading hint until the first snapshot frame lands. Hovering a
         row is free lead time, so warm the Session there. `Session.open()` is
         idempotent and `openState` gates re-entry, so a warm row opens with no
         loading phase at all. */
      ctx.effect(function () {
        const WARM_LIMIT = 8;
        let prefetchTimer = null;
        let sweepTimer = null;
        let sweepDelay = null;
        let lastSweepAt = 0;
        let stopList = null;

        const warm = function (sessionId) {
          let sessions = null;
          try {
            sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions;
          } catch (error) {
            return;
          }
          if (sessions === null || typeof sessions !== 'object') return;
          const manager = sessions.manager;
          if (manager === null || typeof manager !== 'object' || typeof manager.get !== 'function') return;
          try {
            const session = manager.get(sessionId);
            if (session === null || typeof session !== 'object') return;
            if (session.openState !== 'cold' || typeof session.open !== 'function') return;
            const pending = session.open();
            if (pending !== null && typeof pending === 'object' && typeof pending.catch === 'function') pending.catch(function () {});
          } catch (error) {
            /* A Session that cannot warm up simply opens the normal way. */
          }
        };

        const prefetch = function (sessionId) {
          if (typeof sessionId !== 'string' || sessionId.length === 0) return;
          if (prefetchTimer !== null) clearTimeout(prefetchTimer);
          prefetchTimer = setTimeout(function () {
            prefetchTimer = null;
            warm(sessionId);
          }, 150);
        };

        /* Hover only covers rows the cursor crosses. Switching usually comes
           from the keyboard, a fresh list, or a click that lands before the
           150 ms hover lead time, so warm the recent rows during idle too:
           the eight newest Sessions open serially, 120 ms apart, and any list
           change reschedules a sweep at most every 30 s. */
        const sessionsService = function () {
          try {
            const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : ctx.sessions;
            if (sessions === null || typeof sessions !== 'object') return null;
            return sessions;
          } catch (error) {
            return null;
          }
        };

        const listStore = function () {
          const sessions = sessionsService();
          if (sessions === null) return null;
          const list = sessions.list;
          if (list === null || typeof list !== 'object' || typeof list.getSnapshot !== 'function') return null;
          return list;
        };

        const warmRecent = function () {
          const list = listStore();
          if (list === null) return;
          let rows = null;
          try {
            const snapshot = list.getSnapshot();
            rows = snapshot !== null && typeof snapshot === 'object' && snapshot.byId !== undefined ? snapshot.byId : null;
          } catch (error) {
            return;
          }
          if (rows === null || typeof rows !== 'object') return;
          const ids = Object.keys(rows)
            .map(function (key) { return rows[key]; })
            .filter(function (row) { return row !== null && typeof row === 'object' && typeof row.id === 'string'; })
            .sort(function (left, right) { return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0); })
            .slice(0, WARM_LIMIT)
            .map(function (row) { return row.id; });
          let index = 0;
          const step = function () {
            sweepTimer = null;
            if (index >= ids.length) return;
            warm(ids[index]);
            index += 1;
            sweepTimer = setTimeout(step, 120);
          };
          sweepTimer = setTimeout(step, 0);
        };

        const scheduleWarm = function (delay) {
          if (sweepDelay !== null) clearTimeout(sweepDelay);
          sweepDelay = setTimeout(function () {
            sweepDelay = null;
            warmRecent();
          }, delay);
        };

        scheduleWarm(1200);

        const list = listStore();
        if (list !== null && typeof list.subscribe === 'function') {
          const onListChange = function () {
            const now = Date.now();
            if (now - lastSweepAt < 30000) return;
            lastSweepAt = now;
            scheduleWarm(600);
          };
          try {
            stopList = list.subscribe(onListChange);
          } catch (error) {
            stopList = null;
          }
        }

        window.__dshRunningLabel = runningLabel;
        window.__dshPrefetchSession = prefetch;
        return function () {
          if (prefetchTimer !== null) {
            clearTimeout(prefetchTimer);
            prefetchTimer = null;
          }
          if (sweepTimer !== null) {
            clearTimeout(sweepTimer);
            sweepTimer = null;
          }
          if (sweepDelay !== null) {
            clearTimeout(sweepDelay);
            sweepDelay = null;
          }
          if (typeof stopList === 'function') {
            try { stopList(); } catch (error) { /* list went away with the fiber */ }
            stopList = null;
          }
          if (window.__dshRunningLabel === runningLabel) delete window.__dshRunningLabel;
          if (window.__dshPrefetchSession === prefetch) delete window.__dshPrefetchSession;
        };
      });
    }

    return { apply: apply };
  },
});
