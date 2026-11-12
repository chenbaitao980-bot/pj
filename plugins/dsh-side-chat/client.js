/**
 * Client half of `@local/dsh-side-chat`.
 *
 * Ctrl+; opens a *side chat*: a second conversation rendered in the right
 * panel beside the one on screen, the way Claude Code desktop's side chat
 * works. The side conversation is a real, independent Session with its own
 * composer and agent loop. It forks the conversation on screen, so it starts
 * with that history: it can report where the work stands and keep working on
 * the same task in the same workspace. A conversation without a finished turn
 * has nothing to fork, so it starts fresh in the same workspace instead.
 *
 * Side chats are remembered per main Session (localStorage). Pressing the
 * shortcut while some of them are closed reopens the oldest closed one with
 * its conversation intact; once every remembered side chat is open it starts
 * another, so the panel holds as many side chats as you open. With no Session
 * on screen it starts an ordinary one first, so the shortcut is never a no-op.
 * The right panel's "+" also creates another side chat while one is open (see
 * `claimAddTab`), instead of opening the tab guide.
 *
 * The panel plumbing mirrors the shipped subagent side chat
 * (`@deepseek-ai/dsh-client-ui-subagent`): a resource protocol retains the
 * Session, a right-sidebar tab type owns the address, and the tab body renders
 * the Conversation slot for that retained Session. The tab works for ordinary
 * Sessions, not only subagent children.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-side-chat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const TAB_ID = '@local/dsh-side-chat';
    const KIND = 'sidechat';
    const PROTOCOL = 'sidechat';
    const ADDRESS_PREFIX = 'dsh-resource://' + PROTOCOL + '/session/';
    const NS = 'sideChat';

    const zh = {
      'action.side': '副会话',
      'tab.title': '副会话',
      'notice.failed': '副会话打开失败：{message}',
    };
    const en = {
      'action.side': 'Side chat',
      'tab.title': 'Side chat',
      'notice.failed': 'Could not open the side chat: {message}',
    };

    /** Canonical resource address of one ordinary Session's side chat. */
    function sideChatAddress(sessionId) {
      return ADDRESS_PREFIX + encodeURIComponent(sessionId);
    }

    /** Parse one side-chat resource address; undefined for anything else. */
    function parseSideChatAddress(value) {
      let url;
      try {
        url = new URL(value);
      } catch (_invalidUrl) {
        return undefined;
      }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== PROTOCOL) return undefined;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 2 || parts[0] !== 'session') return undefined;
      try {
        return { sessionId: decodeURIComponent(parts[1]) };
      } catch (_invalidEncoding) {
        return undefined;
      }
    }

    function waitForAbort(signal) {
      if (signal.aborted) return Promise.resolve();
      return new Promise(function (resolve) {
        signal.addEventListener('abort', function () { resolve(); }, { once: true });
      });
    }

    /**
     * A restored tab may open before the Session list has loaded. Retain fails
     * for an unknown Session, so wait briefly for the row instead of blanking
     * the restored tab.
     */
    async function waitForKnownSession(sessions, sessionId, signal) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const rows = sessions.list.getSnapshot();
        if (rows.byId[sessionId] !== undefined || rows.ids.includes(sessionId)) return true;
        if (signal.aborted) return false;
        await new Promise(function (resolve) { setTimeout(resolve, 100); });
      }
      return false;
    }

    /** Retain one Session for the lifetime of a side-chat resource occurrence. */
    function sideChatResourceProvider(sessions) {
      return {
        protocol: PROTOCOL,
        async *open(resourceAddress, options) {
          const signal = options.signal;
          const parsed = parseSideChatAddress(resourceAddress);
          if (parsed === undefined) throw new Error('dsh-side-chat: invalid chat address "' + resourceAddress + '"');
          if (signal.aborted) return;
          await waitForKnownSession(sessions, parsed.sessionId, signal);
          if (signal.aborted) return;
          const reference = sessions.retain(parsed.sessionId, { source: 'sideChat', signal: signal });
          try {
            yield { ok: true, value: { sessionId: parsed.sessionId, reference: reference } };
            await waitForAbort(signal);
          } finally {
            reference.release();
          }
        },
      };
    }

    const ROOT_STYLE = {
      display: 'flex',
      width: '100%',
      minWidth: 0,
      height: '100%',
      minHeight: 0,
    };

    /** Bind a chat resource's retained Session around its Conversation slot. */
    function SideChatTab(props) {
      const tab = props.useTabInfo().tab;
      const resource = props.useResource(tab.contentId);
      const value = resource.value;
      return h(
        'div',
        { style: ROOT_STYLE, 'data-side-chat': '' },
        value === undefined
          ? null
          : h(props.SessionProvider, { session: value.reference }, props.renderSlot('sidechat.conversation', {})),
      );
    }

    /** Fixed Chat selection used by an embedded Conversation occurrence. */
    function FixedChatConversationView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }));
    }

    /** Render the shared Conversation content for one explicitly retained Session. */
    function ConversationSlotPanel(props) {
      const session = props.useSession(function (value) { return value; });
      const shellPhase =
        props.useConversation(function (value) { return value; }).activeTargets.size > 0 ||
        (!session.blank && !session.awaitingFirstTurn) ||
        session.running
          ? 'active'
          : session.promptAttempted
            ? 'engaging'
            : 'blank';
      const summaryBlank = props.useSessions(function (state) { return state.byId[props.sessionId]?.blank; });
      const settling =
        (shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true) ||
        (session.subagent?.address.mode === 'continuable' && session.subagent.parentAvailable === undefined);
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
      return props.renderFactorySlot(
        'conversation.content',
        {
          variant: 'embedded',
          phase: settling ? 'settling' : hero ? 'hero' : 'active',
          hero: hero,
        },
        { slots: { views: FixedChatConversationView } },
      );
    }

    /** The Session shown in the main view, if any. */
    function mainSessionId(ctx) {
      const ui = ctx.get('uiWorkspace');
      const reference = ui === undefined ? undefined : ui.mainReference;
      if (reference !== undefined) return reference.sessionId;
      const rows = ctx.sessions.list.getSnapshot();
      const row = Object.values(rows.byId).find(function (candidate) {
        return (candidate.retainedBy?.mainView ?? 0) > 0;
      });
      return row === undefined ? undefined : row.sessionId;
    }

    /** Workspace owning one Session, when it belongs to one. */
    function workspaceIdOf(ctx, sessionId) {
      const ui = ctx.get('uiWorkspace');
      const list = ui === undefined ? undefined : ui.workspaces?.list?.getSnapshot();
      const item = list?.items?.find(function (candidate) {
        return candidate.sessionIds.includes(sessionId);
      });
      return item === undefined ? undefined : item.workspaceId;
    }

    /** Open one Session as a side-chat tab of the on-screen Session. */
    function openSideTab(ctx, sessionId) {
      const sidebar = ctx.get('sidebarRight');
      if (sidebar === undefined) return;
      sidebar.openResource(sideChatAddress(sessionId), {
        kind: KIND,
        preferNewPane: true,
      });
    }

    /** Persisted main Session -> side chat Session associations, oldest first. */
    const LINKS_KEY = 'dsh-side-chat:links:v1';

    /** Read the associations; missing or malformed storage reads as none. */
    function readLinks() {
      let raw;
      try {
        raw = globalThis.localStorage === undefined ? undefined : globalThis.localStorage.getItem(LINKS_KEY);
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
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const links = {};
      Object.keys(parsed).forEach(function (mainId) {
        if (!Array.isArray(parsed[mainId])) return;
        const ids = parsed[mainId].filter(function (id) {
          return typeof id === 'string' && id !== '';
        });
        if (ids.length > 0) links[mainId] = ids;
      });
      return links;
    }

    /** Write the associations; a storage failure only costs the next restart. */
    function writeLinks(links) {
      try {
        if (globalThis.localStorage !== undefined) globalThis.localStorage.setItem(LINKS_KEY, JSON.stringify(links));
      } catch (_storageUnavailable) {}
    }

    /**
     * Drop associations whose side Session (or main Session) no longer exists.
     * The session list starts pending, so pruning waits for a ready snapshot —
     * an early Ctrl+; must not wipe links for sessions that are merely loading.
     */
    function pruneLinks(sessions, links) {
      const snapshot = sessions.list.getSnapshot();
      if (snapshot.phase !== 'ready') return links;
      let changed = false;
      Object.keys(links).forEach(function (mainId) {
        if (snapshot.byId[mainId] === undefined) {
          delete links[mainId];
          changed = true;
          return;
        }
        const kept = links[mainId].filter(function (id) {
          return snapshot.byId[id] !== undefined;
        });
        if (kept.length === links[mainId].length) return;
        changed = true;
        if (kept.length === 0) delete links[mainId];
        else links[mainId] = kept;
      });
      if (changed) writeLinks(links);
      return links;
    }

    /** Side-chat Session ids, seeded from the persisted links so restarts keep rows hidden. */
    const sideIds = new Set();

    const rememberSideSession = function (id) {
      if (typeof id === 'string' && id !== '') sideIds.add(id);
    };

    /** Record one side Session under its main Session, keeping opening order. */
    function linkSideSession(mainId, sideId) {
      rememberSideSession(sideId);
      const links = readLinks();
      const ids = (links[mainId] ?? []).filter(function (id) {
        return id !== sideId;
      });
      ids.push(sideId);
      links[mainId] = ids;
      writeLinks(links);
    }

    /** Session ids of the side chat tabs currently open for one main Session. */
    function openSideSessionIds(ctx, mainId) {
      const sidebar = ctx.get('sidebarRight');
      const tabs = sidebar === undefined ? undefined : sidebar.tabsIn(mainId);
      if (!Array.isArray(tabs)) return [];
      const ids = [];
      tabs.forEach(function (tab) {
        if (tab.kind !== KIND) return;
        const parsed = parseSideChatAddress(tab.contentId);
        if (parsed === undefined || ids.includes(parsed.sessionId)) return;
        ids.push(parsed.sessionId);
      });
      return ids;
    }

    /** Host-readable marker: `⧉ <parent-session-id> · <human title>`. */
    const SIDE_TITLE_MARK = '⧉ ';
    const SIDE_TITLE_SEPARATOR = ' · ';

    /** The human part of a side-chat title, without the host marker. */
    function sideTitleText(title) {
      if (typeof title !== 'string' || !title.startsWith(SIDE_TITLE_MARK)) return title;
      const rest = title.slice(SIDE_TITLE_MARK.length);
      const cut = rest.indexOf(SIDE_TITLE_SEPARATOR);
      return cut < 0 ? rest : rest.slice(cut + SIDE_TITLE_SEPARATOR.length);
    }

    /** Next unused `副会话 N` name for a main Session. */
    function nextSideTitle(sessions, mainId) {
      const snapshot = sessions.list.getSnapshot();
      const ids = readLinks()[mainId] ?? [];
      let max = 0;
      ids.forEach(function (id) {
        const summary = snapshot.byId[id];
        const text = sideTitleText(summary === undefined ? '' : summary.displayTitle ?? summary.title ?? '');
        const match = /^副会话 (\d+)$/u.exec(text);
        if (match !== null) max = Math.max(max, Number(match[1]));
      });
      return '副会话 ' + (max + 1);
    }

    /**
     * Name the forked Session `⧉ <mainId> · <title>`. The Client owns the
     * pairing in localStorage; the Host parses this title to find the main
     * Session and stream its new events into the side chat.
     */
    async function markSideSession(sessions, mainId, sideId) {
      const snapshot = sessions.list.getSnapshot();
      const side = snapshot.byId[sideId];
      // Reopening a side chat must keep its own title; only a brand-new fork
      // (or a legacy unmarked side chat) gets the next 副会话 N name.
      const existing = side === undefined ? undefined : side.displayTitle ?? side.title;
      const existingText = typeof existing === 'string' && existing !== '' ? sideTitleText(existing) : undefined;
      const marked = typeof existing === 'string' && existing.startsWith(SIDE_TITLE_MARK);
      const human =
        marked && existingText !== undefined && existingText !== ''
          ? existingText
          : nextSideTitle(sessions, mainId);
      const title = SIDE_TITLE_MARK + mainId + SIDE_TITLE_SEPARATOR + human;
      const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined;
      const reference = sessions.retain(
        sideId,
        timeout === undefined ? { source: 'sideChat' } : { source: 'sideChat', signal: timeout },
      );
      try {
        const binding = await reference.ready;
        const session = binding === undefined ? undefined : binding.session;
        if (session === undefined || typeof session.rename !== 'function') return;
        const result = await session.rename(title);
        if (result !== undefined && result.ok === false) {
          console.warn('side chat: title rename failed: ' + String(result.error));
        }
      } finally {
        reference.release();
      }
    }

    /**
     * Create one new side chat of the main Session: a fork when the main has a
     * finished turn, so the side conversation reads the same history. A blank
     * main has nothing to fork, so it starts a fresh Session in the same
     * workspace (or cwd). Resolves to the new Session id.
     */
    async function createSideSession(ctx, sessions, mainId) {
      const summary = sessions.list.getSnapshot().byId[mainId];
      let sideId;
      if (summary === undefined || summary.blank !== true) {
        try {
          sideId = await sessions.fork({ sessionId: mainId, increaseTitle: true });
        } catch (error) {
          const unavailable =
            error !== null &&
            typeof error === 'object' &&
            error.name === 'SessionForkError' &&
            error.rpcError !== undefined &&
            error.rpcError.code === 'session/fork-unavailable';
          if (!unavailable) throw error;
        }
      }
      if (sideId === undefined) {
        const workspaceId = workspaceIdOf(ctx, mainId);
        const cwd = summary === undefined ? undefined : summary.cwd;
        const request =
          workspaceId !== undefined ? { workspaceId: workspaceId } : cwd !== undefined && cwd !== '' ? { cwd: cwd } : {};
        const created = await sessions.create(request);
        sideId = typeof created === 'string' ? created : created === undefined ? undefined : created.sessionId;
      }
      return sideId;
    }

    /**
     * Ctrl+; body. Reopens the oldest side chat of the on-screen Session that
     * is not currently open, so closing a tab never loses its conversation;
     * once every remembered side chat is open, starts another one. With no
     * Session open, starts an ordinary one so the shortcut is never a no-op.
     */
    function activate(ctx) {
      const ui = ctx.get('uiWorkspace');
      const sessions = ctx.get('sessions');
      if (ui === undefined || sessions === undefined) return;
      const t = ctx.locale.bind(NS);
      const report = function (error) {
        console.warn('side chat: ' + String(error));
        if (typeof ui.notify === 'function') {
          ui.notify({ kind: 'createFailed', message: t('notice.failed', { message: error instanceof Error ? error.message : String(error) }) });
        }
      };
      const main = mainSessionId(ctx);
      if (main === undefined) {
        ui.startSession();
        return;
      }
      const links = pruneLinks(sessions, readLinks());
      const open = openSideSessionIds(ctx, main);
      const closed = (links[main] ?? []).find(function (id) {
        return !open.includes(id);
      });
      if (closed !== undefined) {
        markSideSession(sessions, main, closed).catch(function (error) {
          console.warn('side chat: title rename failed: ' + String(error));
        });
        try {
          openSideTab(ctx, closed);
        } catch (error) {
          report(error);
        }
        return;
      }
      createSideSession(ctx, sessions, main)
        .then(function (sideId) {
          if (sideId === undefined) return;
          linkSideSession(main, sideId);
          markSideSession(sessions, main, sideId)
            .catch(function (error) {
              console.warn('side chat: title rename failed: ' + String(error));
            })
            .then(function () {
              openSideTab(ctx, sideId);
            });
        })
        .catch(report);
    }

    /** Whether one Session already keeps a side-chat tab open. */
    function hasSideChatTab(ctx, sessionId) {
      const sidebar = ctx.get('sidebarRight');
      const tabs = sidebar === undefined ? undefined : sidebar.tabsIn(sessionId);
      return Array.isArray(tabs) && tabs.some(function (tab) {
        return tab.kind === KIND;
      });
    }

    /** Required services: the shortcut, panel, resource, and navigation owners. */
    const inject = ['sessions', 'uiWorkspace', 'slots', 'locale', 'sidebarRight', 'shortcuts', 'workspaces'];

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'side-chat: dictionaries');

      ctx.inject(['resources', 'sidebarRightTabs'], function (scope) {
        ctx.effect(function () {
          return scope.resources.register(sideChatResourceProvider(scope.sessions));
        }, 'side-chat: chat resources');

        ctx.effect(function () {
          return scope.sidebarRightTabs.register({
            id: TAB_ID,
            kind: KIND,
            patterns: [ADDRESS_PREFIX + '**'],
            priority: 'builtin',
            multiple: true,
            canOpen: function (address) {
              return parseSideChatAddress(address) !== undefined;
            },
            title: function (address) {
              const parsed = parseSideChatAddress(address);
              const fallback = ctx.locale.bind(NS)('tab.title');
              if (parsed === undefined) return fallback;
              const row = scope.sessions.list.getSnapshot().byId[parsed.sessionId];
              if (row === undefined) return fallback;
              return sideTitleText(row.displayTitle ?? row.title ?? fallback);
            },
          });
        }, 'side-chat: tab type');

        ctx.effect(function () {
          return ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: TAB_ID,
                children: {
                  'sidechat.conversation': { kind: 'single', scope: 'session' },
                },
              },
              SideChatTab,
            );
          });
        }, 'side-chat: tab body');

        ctx.effect(function () {
          return ctx.slots.inject('sidechat.conversation', function () {
            return ctx.slots.register({ name: 'sidechat.conversation' }, ConversationSlotPanel);
          });
        }, 'side-chat: conversation body');
      });

      ctx.effect(function () {
        return ctx.shortcuts.register({
          id: 'session.side',
          label: function () { return ctx.locale.bind(NS)('action.side'); },
          aliases: ['side session', 'side chat', '副会话'],
          defaults: {
            'desktop:macos': { code: 'Semicolon', modifiers: ['primary'] },
            'desktop:windows': { code: 'Semicolon', modifiers: ['primary'] },
            'desktop:linux': { code: 'Semicolon', modifiers: ['primary'] },
            'web:macos': { code: 'Semicolon', modifiers: ['primary', 'alt'] },
            'web:windows': { code: 'Semicolon', modifiers: ['primary', 'alt'] },
          },
          regions: ['page', 'editable'],
          modals: ['sidebar'],
          resolve: function () {
            return {
              status: 'handled',
              run: function () { activate(ctx); },
            };
          },
        });
      }, 'side-chat: Ctrl+; shortcut');

      // The right panel's "+" consults this hook before opening its tab guide:
      // with a side chat already open, "+" keeps creating side chats of the
      // same conversation instead of asking which page to open.
      ctx.effect(function () {
        const links = readLinks();
        Object.keys(links).forEach(function (mainId) {
          links[mainId].forEach(rememberSideSession);
        });
        globalThis.__DSH_SIDE_CHAT__ = {
          claimAddTab: function (sessionId) {
            if (!hasSideChatTab(ctx, sessionId)) return false;
            activate(ctx);
            return true;
          },
          // Consulted by the frozen workspace patch: a side chat belongs to
          // the right panel, not to the session list on the left.
          isSideSession: function (sessionId) {
            return sideIds.has(sessionId);
          },
          // Consulted by the tree patch when a side row is renamed, so the
          // `⧉ <parent> · ` title marker survives the rename.
          parentOf: function (sessionId) {
            const links = readLinks();
            const ids = Object.keys(links);
            for (let i = 0; i < ids.length; i += 1) {
              if (links[ids[i]].includes(sessionId)) return ids[i];
            }
            return undefined;
          },
        };
        return function () {
          if (globalThis.__DSH_SIDE_CHAT__ !== undefined) delete globalThis.__DSH_SIDE_CHAT__;
        };
      }, 'side-chat: add-tab hook');

      // A second entry point next to the transcript header so the feature is
      // discoverable without knowing the shortcut.
      ctx.effect(function () {
        return ctx.slots.inject('conversation.session.header.actions', function () {
          return ctx.slots.register(
            {
              name: 'conversation.session.header.actions',
              id: 'side-chat-open',
              order: 20,
              locale: NS,
              inject: function () {
                return { openSideChat: function () { activate(ctx); } };
              },
            },
            function SideChatHeaderAction(props) {
              const label = props.t('action.side');
              return h(
                'button',
                {
                  type: 'button',
                  title: label,
                  'aria-label': label,
                  onClick: function () { props.openSideChat(); },
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    height: '28px',
                    padding: '0 8px',
                    border: 'none',
                    borderRadius: 'var(--dsw-radius-sm)',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-secondary)',
                    cursor: 'pointer',
                    fontSize: '12px',
                  },
                },
                h('span', { 'aria-hidden': true, style: { fontSize: '14px', lineHeight: 1 } }, '⧉'),
                h('span', null, label),
              );
            },
          );
        });
      }, 'side-chat: header action');
    }

    return { apply: apply, inject: inject };
  },
});
