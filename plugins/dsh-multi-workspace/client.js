/**
 * Client half of `@local/dsh-multi-workspace`.
 *
 * Adds the workspace picker's multi-select entry point. The dropdown's new
 * "多选工作区…" item opens this dialog; checking several workspaces creates one
 * Session in the first checked workspace (the main root) and attaches the
 * remaining checked workspaces through the Host `/roots` command, so the model
 * sees every path without the UI having to change the Session model.
 *
 * The dialog deliberately implements its own controls, per the Harness plugin
 * guidance: it stays theme-token based and does not replace host primitives.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-multi-workspace',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'multiWorkspace';
    const zh = {
      'dialog.title': '多选工作区',
      'dialog.hint': '第一个勾选的工作区作为主目录，其余作为附加目录挂到同一个会话；模型按绝对路径访问。',
      'dialog.empty': '还没有工作区。先在工作区栏添加一个目录。',
      'dialog.cancel': '取消',
      'dialog.confirm': '开始会话（{count}）',
      'dialog.working': '正在创建会话…',
      'dialog.unsupported': '当前版本不支持多选工作区，请升级冻结版。',
      'dialog.failed': '创建会话失败：{message}',
      'dialog.partial': '会话已创建，但这些目录没能挂上：{roots}。可在会话里用「管理工作区」重试。',
      'menu.multi': '多选工作区…',
      'cmd.label': '管理工作区',
      'cmd.description': '添加、更换或移除本会话的附加工作区目录（输入 / 或点 + 都能找到）',
      'manager.title': '管理工作区',
      'manager.hint': '主目录是会话的工作区；附加目录由 /roots 挂到同一会话，模型按绝对路径读写。跨目录写入需要「完全权限」。',
      'manager.main': '主目录',
      'manager.extra': '附加目录',
      'manager.empty': '这个会话还没有附加目录。',
      'manager.add': '添加目录…',
      'manager.replace': '更换',
      'manager.remove': '移除',
      'manager.done': '完成',
      'manager.working': '正在更新…',
      'manager.failed': '操作失败：{message}',
      'manager.unsupported': '当前版本不支持从会话内管理工作区，请升级冻结版。',
      'manager.noPick': '没有选择目录。',
      'manager.mobile': '手机端无法调起电脑的系统目录选择器：请在电脑上操作，或在会话里输入 /roots add <绝对路径>。',
    };
    const en = {
      'dialog.title': 'Select workspaces',
      'dialog.hint': 'The first checked workspace is the main root; the others attach to the same Session and the model reads them by absolute path.',
      'dialog.empty': 'No workspaces yet. Add a folder from the workspace sidebar first.',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Start with {count}',
      'dialog.working': 'Creating the session…',
      'dialog.unsupported': 'This build does not support multi-workspace selection; upgrade the frozen build.',
      'dialog.failed': 'Could not create the session: {message}',
      'dialog.partial': 'The Session was created, but these folders did not attach: {roots}. Retry from Manage workspaces inside the Session.',
      'menu.multi': 'Select multiple workspaces…',
      'cmd.label': 'Manage workspaces',
      'cmd.description': 'Add, replace or remove this Session’s extra workspace roots (type / or click +)',
      'manager.title': 'Manage workspaces',
      'manager.hint': 'The main root is the Session workspace; extra roots attach to the same Session through /roots and the model reads them by absolute path. Writing across roots needs Full access.',
      'manager.main': 'Main root',
      'manager.extra': 'Extra roots',
      'manager.empty': 'This Session has no extra roots yet.',
      'manager.add': 'Add folder…',
      'manager.replace': 'Replace',
      'manager.remove': 'Remove',
      'manager.done': 'Done',
      'manager.working': 'Updating…',
      'manager.failed': 'The change failed: {message}',
      'manager.unsupported': 'This build does not support managing workspaces from inside a Session; upgrade the frozen build.',
      'manager.noPick': 'No folder was selected.',
      'manager.mobile': 'A phone cannot open the PC folder picker: add the folder on the desktop, or run /roots add <absolute path> in the Session.',
    };

    /** Minimal external store for the dialog's open state and checked ids. */
    function createSignal(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        get() { return value; },
        set(next) {
          value = next;
          for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return function () { listeners.delete(listener); };
        },
      };
    }

    const signal = createSignal({ open: false, mode: 'pick', sessionId: undefined, selected: new Set(), order: [] });

    /**
     * The commands Remote + directory picker the manager talks to. Held in a
     * store (not a plain variable) so a dialog opened before the namespaces
     * finish mounting re-renders with working buttons once they arrive.
     */
    const transportSignal = createSignal(null);

    const styles = {
      backdrop: {
        position: 'fixed',
        inset: 0,
        zIndex: 95,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'var(--dsw-alias-bg-mask-1)',
        backdropFilter: 'var(--dsw-mask-blur)',
      },
      panel: {
        boxSizing: 'border-box',
        width: '440px',
        maxWidth: '100%',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '16px',
        borderRadius: 'var(--dsw-radius-lg)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-overlay)',
        boxShadow: 'var(--dsw-elevation-prominent)',
        color: 'var(--dsw-alias-label-primary)',
      },
      title: {
        margin: 0,
        fontSize: '14px',
        fontWeight: 600,
        lineHeight: '20px',
      },
      hint: {
        margin: 0,
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      list: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minHeight: 0,
        overflow: 'auto',
        padding: '2px 0',
      },
      row: {
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        width: '100%',
        minHeight: '40px',
        padding: '5px 8px',
        border: 'none',
        borderRadius: 'var(--dsw-radius-md)',
        background: 'transparent',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
      },
      check: {
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '15px',
        height: '15px',
        borderRadius: '4px',
        border: '1px solid var(--dsw-alias-border-l3)',
        color: '#ffffff',
        fontSize: '11px',
        lineHeight: 1,
      },
      rowText: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        gap: '1px',
      },
      rowTitle: {
        fontSize: '12px',
        lineHeight: '17px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      rowPath: {
        fontSize: '10px',
        lineHeight: '15px',
        color: 'var(--dsw-alias-label-tertiary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      footer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '8px',
        paddingTop: '4px',
      },
      button: {
        height: '30px',
        padding: '0 12px',
        borderRadius: 'var(--dsw-radius-sm)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
      },
      primary: {
        height: '30px',
        padding: '0 12px',
        borderRadius: 'var(--dsw-radius-sm)',
        border: 'none',
        background: 'var(--dsw-alias-button-primary-fill)',
        color: '#ffffff',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
      },
      error: {
        margin: 0,
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-state-error-primary)',
      },
      status: {
        margin: 0,
        fontSize: '11px',
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      sectionLabel: {
        margin: 0,
        fontSize: '11px',
        lineHeight: '16px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-tertiary)',
      },
      rootRow: {
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        minHeight: '38px',
        padding: '5px 8px',
        borderRadius: 'var(--dsw-radius-md)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
      },
      rowGrow: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        flex: 1,
        gap: '1px',
      },
      smallButton: {
        flex: 'none',
        height: '24px',
        padding: '0 8px',
        borderRadius: 'var(--dsw-radius-sm)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '11px',
      },
      dangerButton: {
        flex: 'none',
        height: '24px',
        padding: '0 8px',
        borderRadius: 'var(--dsw-radius-sm)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '11px',
      },
    };

    function rowStyle(checked, hovered) {
      return {
        ...styles.row,
        background: hovered || checked ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
      };
    }

    function checkStyle(checked) {
      return checked
        ? {
            ...styles.check,
            border: 'none',
            background: 'var(--dsw-alias-brand-primary)',
          }
        : styles.check;
    }

    /** Workspace label: the explicit title, else the folder's last segment. */
    function displayName(item) {
      if (typeof item.title === 'string' && item.title !== '') return item.title;
      const parts = String(item.path ?? '').split(/[\\/]/).filter(Boolean);
      return parts.length === 0 ? String(item.path ?? '') : parts[parts.length - 1];
    }

    /**
     * Manage an already-open Session's roots: list the main root and every
     * extra root, add a directory, replace one, or remove one. Every change
     * goes through the Host `/roots` command so the Session projection (and
     * the model's next request) sees it immediately.
     */
    function MultiWorkspaceManager(props) {
      const state = React.useSyncExternalStore(signal.subscribe, signal.get);
      const sessions = props.sessions;
      const list = sessions?.list;
      const snapshot = React.useSyncExternalStore(
        React.useCallback(function (listener) {
          return list === undefined ? function () {} : list.subscribe(listener);
        }, [list]),
        React.useCallback(function () { return list === undefined ? undefined : list.getSnapshot(); }, [list]),
      );
      const [busy, setBusy] = React.useState(null);
      const [error, setError] = React.useState(null);
      const sessionId = state.sessionId;
      const row = sessionId === undefined ? undefined : snapshot?.byId?.[sessionId];
      const roots = Array.isArray(row?.projectionValues?.multiWorkspaceRoots?.roots)
        ? row.projectionValues.multiWorkspaceRoots.roots
        : [];
      const cwd = typeof row?.cwd === 'string' ? row.cwd : '';
      const transport = React.useSyncExternalStore(transportSignal.subscribe, transportSignal.get);
      const panelRef = React.useRef(null);

      React.useEffect(function () {
        if (!state.open) return undefined;
        const panel = panelRef.current;
        if (panel !== null) panel.focus();
        const onKey = function (event) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        };
        document.addEventListener('keydown', onKey, true);
        return function () { document.removeEventListener('keydown', onKey, true); };
      }, [state.open]);

      if (!state.open) return null;

      const commands = transport?.remote?.commands;
      const picker = transport?.remote?.directoryPicker;
      const supported = commands !== undefined && typeof commands.execute === 'function';
      // A phone cannot drive the desktop's native folder picker; the namespace
      // exists, so detect the pointer instead of waiting for a failure.
      const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      const canPick = supported && picker !== undefined && typeof picker.pick === 'function' && !coarse;

      const change = function (label, action) {
        if (busy !== null || !supported) return;
        setBusy(label || '…');
        setError(null);
        Promise.resolve()
          .then(action)
          .catch(function (reason) {
            setError(props.t('manager.failed', { message: reason instanceof Error ? reason.message : String(reason) }));
          })
          .finally(function () { setBusy(null); });
      };

      const runLine = function (line) {
        return Promise.resolve(commands.execute(sessionId, line, [])).then(function (result) {
          if (!result.ok) throw new Error(result.error?.message ?? result.error?.code ?? 'command failed');
          if (result.value === undefined) throw new Error('unknown command: ' + line);
          if (result.value.result?.kind === 'error') throw new Error(result.value.result.text);
          return result;
        });
      };

      const pick = function () {
        if (!canPick) {
          return Promise.reject(new Error(coarse ? props.t('manager.mobile') : props.t('manager.unsupported')));
        }
        return Promise.resolve(picker.pick()).then(function (result) {
          if (!result.ok) {
            const code = String(result.error?.code ?? '');
            if (coarse || /unavailable|unsupported/i.test(code)) throw new Error(props.t('manager.mobile'));
            throw new Error(result.error?.message ?? 'directory picker failed');
          }
          if (typeof result.value !== 'string' || result.value === '') {
            throw new Error(props.t('manager.noPick'));
          }
          return result.value;
        });
      };

      const add = function () {
        change('add', function () {
          return pick().then(function (path) { return runLine('/roots add ' + path); });
        });
      };

      const remove = function (path) {
        change(path, function () { return runLine('/roots remove ' + path); });
      };

      const replace = function (path) {
        change(path, function () {
          return pick().then(function (next) {
            if (next === path) return undefined;
            // Attach the new root first: if the add is refused the old root is
            // still attached, so a failed replace never loses a workspace.
            return runLine('/roots add ' + next).then(function () {
              return runLine('/roots remove ' + path).catch(function (reason) {
                return runLine('/roots remove ' + next).catch(function () {}).then(function () { throw reason; });
              });
            });
          });
        });
      };

      const rootRow = function (path) {
        return h(
          'div',
          { style: styles.rootRow, key: path },
          h(
            'span',
            { style: styles.rowGrow },
            h('span', { style: styles.rowPath, title: path }, path),
          ),
          h(
            'button',
            {
              type: 'button',
              style: styles.smallButton,
              'aria-label': props.t('manager.replace') + ' ' + path,
              onClick: function () { replace(path); },
              disabled: busy !== null || !canPick,
            },
            props.t('manager.replace'),
          ),
          h(
            'button',
            {
              type: 'button',
              style: styles.dangerButton,
              'aria-label': props.t('manager.remove') + ' ' + path,
              onClick: function () { remove(path); },
              disabled: busy !== null || !supported,
            },
            props.t('manager.remove'),
          ),
        );
      };

      return h(
        'div',
        {
          style: styles.backdrop,
          role: 'presentation',
          onMouseDown: function (event) {
            if (event.target === event.currentTarget) close();
          },
        },
        h(
          'div',
          {
            ref: panelRef,
            tabIndex: -1,
            style: styles.panel,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': props.t('manager.title'),
          },
          h('h2', { style: styles.title }, props.t('manager.title')),
          h('p', { style: styles.hint }, props.t('manager.hint')),
          cwd === ''
            ? null
            : h(
                'div',
                null,
                h('p', { style: styles.sectionLabel }, props.t('manager.main')),
                h(
                  'div',
                  { style: styles.rootRow },
                  h('span', { style: styles.rowGrow }, h('span', { style: styles.rowPath, title: cwd }, cwd)),
                ),
              ),
          h(
            'div',
            null,
            h('p', { style: styles.sectionLabel }, props.t('manager.extra')),
            roots.length === 0
              ? h('p', { style: styles.status }, props.t('manager.empty'))
              : h('div', { style: styles.list }, roots.map(rootRow)),
          ),
          supported && !canPick ? h('p', { style: styles.status }, props.t('manager.mobile')) : null,
          busy !== null ? h('p', { style: styles.status }, props.t('manager.working')) : null,
          error !== null ? h('p', { style: styles.error, role: 'alert' }, error) : null,
          h(
            'div',
            { style: styles.footer },
            h(
              'button',
              { type: 'button', style: styles.button, onClick: close, disabled: busy !== null },
              props.t('manager.done'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: { ...styles.primary, opacity: busy !== null || !canPick ? 0.5 : 1 },
                onClick: add,
                disabled: busy !== null || !canPick,
              },
              props.t('manager.add'),
            ),
          ),
        ),
      );
    }

    /** Router; mounted once in `shell.overlay`, picks the picker or the manager. */
    function MultiWorkspaceDialog(props) {
      const state = React.useSyncExternalStore(signal.subscribe, signal.get);
      if (!state.open) return null;
      return state.mode === 'manage' ? h(MultiWorkspaceManager, props) : h(MultiWorkspacePicker, props);
    }

    function MultiWorkspacePicker(props) {
      const state = React.useSyncExternalStore(signal.subscribe, signal.get);
      const snapshot = React.useSyncExternalStore(
        React.useCallback(function (listener) { return props.workspaces.list.subscribe(listener); }, [props.workspaces]),
        React.useCallback(function () { return props.workspaces.list.getSnapshot(); }, [props.workspaces]),
      );
      const [pending, setPending] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [hovered, setHovered] = React.useState(null);
      const panelRef = React.useRef(null);
      const items = snapshot?.items ?? [];
      const selected = state.selected;

      React.useEffect(function () {
        if (!state.open) return undefined;
        const panel = panelRef.current;
        if (panel !== null) panel.focus();
        const onKey = function (event) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        };
        document.addEventListener('keydown', onKey, true);
        return function () { document.removeEventListener('keydown', onKey, true); };
      }, [state.open]);

      if (!state.open) return null;

      // Checked workspaces in the order the user checked them; the first one
      // becomes the main root, matching the dialog's hint.
      const order = Array.isArray(state.order) ? state.order : [];
      const picked = [];
      for (const workspaceId of order) {
        const item = items.find(function (candidate) { return candidate.workspaceId === workspaceId; });
        if (item !== undefined) picked.push(item);
      }
      for (const item of items) {
        if (selected.has(item.workspaceId) && !picked.includes(item)) picked.push(item);
      }

      const toggle = function (workspaceId) {
        const next = new Set(selected);
        const nextOrder = order.filter(function (id) { return id !== workspaceId; });
        if (next.has(workspaceId)) next.delete(workspaceId);
        else {
          next.add(workspaceId);
          nextOrder.push(workspaceId);
        }
        error !== null && setError(null);
        signal.set({ ...state, selected: next, order: nextOrder });
      };

      const confirm = function () {
        if (picked.length === 0 || pending) return;
        const ui = props.uiWorkspace;
        if (ui === undefined || typeof ui.openWorkspaceWithRoots !== 'function') {
          setError(props.t('dialog.unsupported'));
          return;
        }
        const primary = picked[0];
        const extraPaths = picked.slice(1).map(function (item) { return item.path; });
        setPending(true);
        setError(null);
        Promise.resolve(ui.openWorkspaceWithRoots(primary.workspaceId, extraPaths))
          .then(function (result) {
            const failed = result && Array.isArray(result.failedRoots) ? result.failedRoots : [];
            if (failed.length > 0) {
              setError(props.t('dialog.partial', { roots: failed.join('、') }));
              return;
            }
            close();
          })
          .catch(function (reason) {
            setError(props.t('dialog.failed', { message: reason instanceof Error ? reason.message : String(reason) }));
          })
          .finally(function () { setPending(false); });
      };

      const footer = h(
        'div',
        { style: styles.footer },
        h(
          'button',
          { type: 'button', style: styles.button, onClick: close, disabled: pending },
          props.t('dialog.cancel'),
        ),
        h(
          'button',
          {
            type: 'button',
            style: { ...styles.primary, opacity: picked.length === 0 || pending ? 0.5 : 1 },
            onClick: confirm,
            disabled: picked.length === 0 || pending,
          },
          props.t('dialog.confirm', { count: picked.length }),
        ),
      );

      return h(
        'div',
        {
          style: styles.backdrop,
          role: 'presentation',
          onMouseDown: function (event) {
            if (event.target === event.currentTarget) close();
          },
        },
        h(
          'div',
          {
            ref: panelRef,
            tabIndex: -1,
            style: styles.panel,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': props.t('dialog.title'),
          },
          h('h2', { style: styles.title }, props.t('dialog.title')),
          h('p', { style: styles.hint }, props.t('dialog.hint')),
          items.length === 0
            ? h('p', { style: styles.status }, props.t('dialog.empty'))
            : h(
                'div',
                { style: styles.list, role: 'group', 'aria-label': props.t('dialog.title') },
                items.map(function (item) {
                  const checked = selected.has(item.workspaceId);
                  return h(
                    'button',
                    {
                      key: item.workspaceId,
                      type: 'button',
                      role: 'checkbox',
                      'aria-checked': checked ? 'true' : 'false',
                      style: rowStyle(checked, hovered === item.workspaceId),
                      onClick: function () { toggle(item.workspaceId); },
                      onMouseEnter: function () { setHovered(item.workspaceId); },
                      onMouseLeave: function () { setHovered(null); },
                      disabled: pending,
                    },
                    h('span', { style: checkStyle(checked), 'aria-hidden': true }, checked ? '✓' : ''),
                    h(
                      'span',
                      { style: styles.rowText },
                      h('span', { style: styles.rowTitle }, displayName(item)),
                      h('span', { style: styles.rowPath, title: item.path }, item.path),
                    ),
                  );
                }),
              ),
          pending ? h('p', { style: styles.status }, props.t('dialog.working')) : null,
          error !== null ? h('p', { style: styles.error, role: 'alert' }, error) : null,
          footer,
        ),
      );
    }

    /** Translate through the plugin's own namespace. */
    function close() {
      signal.set({ open: false, mode: 'pick', sessionId: undefined, selected: new Set(), order: [] });
    }

    let bound = null;

    const inject = ['slots', 'workspaces', 'sessions', 'uiWorkspace', 'locale'];

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'multi-workspace: dictionaries');

      const workspaces = ctx.get('workspaces');
      const uiWorkspace = ctx.get('uiWorkspace');

      const api = {
        /** Open the dialog, preselecting the on-screen Session's workspace. */
        open() {
          const items = workspaces.list.getSnapshot()?.items ?? [];
          const sessions = ctx.get('sessions');
          const current = uiWorkspace?.mainReference?.sessionId;
          const owner =
            current === undefined
              ? undefined
              : items.find(function (item) { return item.sessionIds.includes(current); });
          const selected = new Set(owner === undefined ? [] : [owner.workspaceId]);
          // Reopening the dialog reflects the Session's real roots, which the
          // Host projection derives from the `/roots` command log.
          const roots =
            current === undefined
              ? undefined
              : sessions?.list?.getSnapshot()?.byId?.[current]?.projectionValues?.multiWorkspaceRoots?.roots;
          if (Array.isArray(roots)) {
            const wanted = new Set(roots.map(function (root) { return String(root).toLowerCase(); }));
            for (const item of items) {
              if (wanted.has(String(item.path).toLowerCase())) selected.add(item.workspaceId);
            }
          }
          signal.set({ open: true, mode: 'pick', sessionId: undefined, selected: selected, order: owner === undefined ? [] : [owner.workspaceId] });
        },
        /**
         * Open the in-Session manager for one Session (add / replace / remove
         * extra roots). Reachable from `/` and from the composer's `+` menu
         * through the `/workspaces` command contribution.
         * @param sessionId - the Session whose roots are managed.
         */
        openManager(sessionId) {
          if (typeof sessionId !== 'string' || sessionId === '') return;
          signal.set({ open: true, mode: 'manage', sessionId: sessionId, selected: new Set() });
        },
        close: close,
      };
      ctx.provide('multiWorkspaceUi', api);
      bound = api;

      ctx.effect(function () {
        return function () {
          if (bound === api) bound = null;
        };
      }, 'multi-workspace: ui service');

      // The manager talks to the Host through the commands Remote (the same
      // `/roots` line the picker uses) and the directory picker. Both the
      // service and its namespaces must be injected for the accessor to
      // resolve, so they are requested dynamically: the picker keeps working
      // on builds that lack either namespace. The value lives in a store so a
      // dialog opened early re-renders when the namespaces mount, and the
      // cleanup rides the injected scope's lifetime.
      ctx.inject(['remote', 'remote.commands', 'remote.directoryPicker'], function (scope) {
        transportSignal.set({ remote: scope.remote });
        scope.effect(function () {
          return function () { transportSignal.set(null); };
        }, 'multi-workspace: transport');
      });

      // `/workspaces` — the in-Session manager as a command contribution, so
      // it appears both when typing `/` and when opening the composer's `+`
      // menu (which lists the command source only).
      ctx.inject(['commandUi'], function (scope) {
        ctx.effect(function () {
          return scope.commandUi.register({
            name: 'workspaces',
            label: function () { return t('cmd.label'); },
            description: function () { return t('cmd.description'); },
            available: function () { return true; },
            ui: {
              kind: 'action',
              run: function (session) { api.openManager(session.sessionId); },
            },
          });
        }, 'multi-workspace: /workspaces contribution');
      });

      ctx.effect(function () {
        return ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'multi-workspace-picker',
              locale: NS,
              inject: function () {
                return {
                  workspaces: workspaces,
                  uiWorkspace: uiWorkspace,
                  sessions: ctx.get('sessions'),
                };
              },
            },
            function MultiWorkspaceDialogEntry(props) {
              return h(MultiWorkspaceDialog, {
                workspaces: props.workspaces,
                uiWorkspace: props.uiWorkspace,
                sessions: props.sessions,
                t: props.t,
              });
            },
          );
        });
      }, 'multi-workspace: picker overlay');
    }

    return { apply: apply, inject: inject };
  },
});
