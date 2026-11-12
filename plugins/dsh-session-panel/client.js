/**
 * Client half of `@local/dsh-session-panel` — the session overview page in the
 * right sidebar ("会话概览"), toggled with Ctrl+' or the header icon.
 *
 * Sections (each a collapsible card, collapse state remembered):
 *   环境     working directory and linked workspace roots
 *   上下文   context-window use (`contextPressure` projection)
 *   连接器   MCP servers with live health (Host route; no client API exists)
 *            and a reconnect action (plugin disable → enable)
 *   插件     installed plugin bundles, enabled / failing
 *   技能     skills this Session can use, filterable
 *   输出内容 files this Session wrote or edited (Host projection), click to open
 *   更改     per project-management tool (Git / SVN) and per repository: how far
 *            the local working copy is from its remote — uncommitted changes
 *            with +/− lines, commits not pushed / not pulled; switchable tabs
 *            when the Session spans several repositories or tools.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Side-chat titles embed `⧉ <main-session-id> · ` for the Host. The panel
    // header only shows the human-readable name after the marker.
    const SIDE_TITLE_RE = /^⧉ [^ ]+ · /u;
    const sideTitleText = function (value) {
      return typeof value === 'string' ? value.replace(SIDE_TITLE_RE, '') : value;
    };

    const NS = 'sessionPanel';
    const TAB_ID = '@local/dsh-session-panel';
    const KIND = 'sessionpanel';
    const COLLAPSE_KEY = 'dsh-session-panel:collapsed:v1';
    const PICK_KEY = 'dsh-session-panel:vcs-pick:v1';
    const NOTE_KEY = 'dsh-session-panel:note:v1:';
    const MCP_POLL_MS = 15000;
    const VCS_POLL_MS = 20000;
    const LIST_PREVIEW = 6;

    const zh = {
      'title': '会话概览',
      'guide.title': '会话概览',
      'guide.description': '上下文、MCP、插件、技能、输出与仓库差异',
      'toggle': '会话概览（Ctrl+\'）',
      'refresh': '刷新',
      'env': '环境',
      'env.cwd': '工作目录',
      'env.roots': '关联目录',
      'env.none': '无工作目录',
      'note': '备注',
      'note.meta': '仅本机可见',
      'note.placeholder': '写给自己看的备注（不会发给模型）',
      'note.hint': '自动保存在本机，不出现在对话里。',
      'context': '上下文',
      'context.of': '{used} / {total}',
      'context.unknown': '尚未统计',
      'mcp': '连接器',
      'mcp.summary': '{ok}/{total} 正常',
      'mcp.none': '没有配置 MCP 服务器',
      'mcp.connected': '已连接 · {n} 个工具',
      'mcp.retrying': '未连接，重试中',
      'mcp.starting': '启动中',
      'mcp.failed': '启动失败',
      'mcp.disabled': '已停用',
      'mcp.reconnect': '重新连接',
      'mcp.reconnecting': '重连中…',
      'mcp.enable': '启用',
      'mcp.error': '读取失败：{message}',
      'plugins': '插件',
      'plugins.summary': '{on} 个已启用',
      'plugins.failing': '{n} 个异常',
      'plugins.off': '已停用',
      'plugins.unavailable': '插件管理接口不可用',
      'skills': '技能',
      'skills.summary': '{n} 个可用',
      'skills.filter': '筛选技能…',
      'skills.auto': '模型可自动调用',
      'skills.manual': '仅手动 /调用',
      'skills.unavailable': '技能接口不可用',
      'outputs': '输出内容',
      'outputs.none': '本会话还没有写入或修改文件',
      'outputs.written': '新建',
      'outputs.edited': '修改 {n} 次',
      'changes': '更改',
      'changes.none': '当前目录不在 Git / SVN 管理下',
      'changes.loading': '读取仓库状态…',
      'changes.error': '读取失败：{message}',
      'changes.fetch': '获取远端',
      'changes.fetching': '获取中…',
      'changes.noRemote': '没有远端可比较',
      'changes.notUpstream': '未设置上游，对比 {ref}',
      'changes.ahead': '↑{n} 未推送',
      'changes.behind': '↓{n} 未拉取',
      'changes.synced': '与远端提交一致',
      'changes.local': '本地未提交',
      'changes.files': '{n} 个文件',
      'changes.clean': '工作区干净',
      'changes.untracked': '{n} 个未跟踪',
      'changes.untrackedLabel': '未跟踪文件',
      'changes.svnOutdatedLabel': '远端有更新的文件',
      'changes.statAhead': '未推送提交',
      'changes.statBehind': '未拉取提交',
      'changes.statFiles': '未提交文件',
      'changes.statLines': '未提交行数',
      'changes.vsRemoteLine': '与 {ref} 整体相差 {files} 个文件 · +{add} −{del}',
      'changes.conflicted': '{n} 个冲突',
      'changes.vsRemote': '与远端整体相差',
      'changes.unpushed': '未推送的提交',
      'changes.unpulled': '远端新提交（未拉取）',
      'changes.more': '还有更多…',
      'changes.fetchedAt': '上次获取远端 {time}',
      'changes.neverFetched': '从未获取远端',
      'changes.svnRev': '本地 r{local} · 远端 r{remote}',
      'changes.svnRevLocal': '本地 r{local}',
      'changes.svnOutdated': '{n} 个文件远端有更新',
      'changes.svnRemoteError': '无法连接远端：{message}',
      'show.all': '显示全部 {n}',
      'show.less': '收起',
      'ago.now': '刚刚',
      'ago.min': '{n} 分钟前',
      'ago.hour': '{n} 小时前',
      'ago.day': '{n} 天前',
    };
    const en = {
      'title': 'Session overview',
      'guide.title': 'Session overview',
      'guide.description': 'Context, MCP, plugins, skills, outputs and repo drift',
      'toggle': 'Session overview (Ctrl+\')',
      'refresh': 'Refresh',
      'env': 'Environment',
      'env.cwd': 'Working directory',
      'env.roots': 'Linked roots',
      'env.none': 'No working directory',
      'note': 'Notes',
      'note.meta': 'local only',
      'note.placeholder': 'Notes for yourself (never sent to the model)',
      'note.hint': 'Saved on this machine; never appears in the conversation.',
      'context': 'Context',
      'context.of': '{used} / {total}',
      'context.unknown': 'Not measured yet',
      'mcp': 'Connectors',
      'mcp.summary': '{ok}/{total} healthy',
      'mcp.none': 'No MCP servers configured',
      'mcp.connected': 'Connected · {n} tools',
      'mcp.retrying': 'Not connected, retrying',
      'mcp.starting': 'Starting',
      'mcp.failed': 'Failed to start',
      'mcp.disabled': 'Disabled',
      'mcp.reconnect': 'Reconnect',
      'mcp.reconnecting': 'Reconnecting…',
      'mcp.enable': 'Enable',
      'mcp.error': 'Could not read: {message}',
      'plugins': 'Plugins',
      'plugins.summary': '{on} enabled',
      'plugins.failing': '{n} failing',
      'plugins.off': 'Disabled',
      'plugins.unavailable': 'Plugin manager unavailable',
      'skills': 'Skills',
      'skills.summary': '{n} available',
      'skills.filter': 'Filter skills…',
      'skills.auto': 'Model can invoke',
      'skills.manual': 'Manual /invoke only',
      'skills.unavailable': 'Skills API unavailable',
      'outputs': 'Outputs',
      'outputs.none': 'No files written or edited in this session yet',
      'outputs.written': 'Created',
      'outputs.edited': 'Edited {n}×',
      'changes': 'Changes',
      'changes.none': 'Not under Git / SVN',
      'changes.loading': 'Reading repository status…',
      'changes.error': 'Could not read: {message}',
      'changes.fetch': 'Fetch remote',
      'changes.fetching': 'Fetching…',
      'changes.noRemote': 'No remote to compare',
      'changes.notUpstream': 'No upstream; comparing {ref}',
      'changes.ahead': '↑{n} unpushed',
      'changes.behind': '↓{n} to pull',
      'changes.synced': 'Commits match the remote',
      'changes.local': 'Uncommitted',
      'changes.files': '{n} files',
      'changes.clean': 'Working tree clean',
      'changes.untracked': '{n} untracked',
      'changes.untrackedLabel': 'Untracked files',
      'changes.svnOutdatedLabel': 'Files updated remotely',
      'changes.statAhead': 'Unpushed commits',
      'changes.statBehind': 'Commits to pull',
      'changes.statFiles': 'Uncommitted files',
      'changes.statLines': 'Uncommitted lines',
      'changes.vsRemoteLine': 'Total drift from {ref}: {files} files · +{add} −{del}',
      'changes.conflicted': '{n} conflicted',
      'changes.vsRemote': 'Total drift from remote',
      'changes.unpushed': 'Unpushed commits',
      'changes.unpulled': 'New on the remote (not pulled)',
      'changes.more': 'More…',
      'changes.fetchedAt': 'Last fetched {time}',
      'changes.neverFetched': 'Never fetched',
      'changes.svnRev': 'Local r{local} · remote r{remote}',
      'changes.svnRevLocal': 'Local r{local}',
      'changes.svnOutdated': '{n} files updated on the remote',
      'changes.svnRemoteError': 'Remote unreachable: {message}',
      'show.all': 'Show all {n}',
      'show.less': 'Show less',
      'ago.now': 'just now',
      'ago.min': '{n} min ago',
      'ago.hour': '{n} h ago',
      'ago.day': '{n} d ago',
    };

    // ------------------------------------------------------------------ style

    const FONT = 'var(--dsh-content-font-size, 13px)';
    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const C = {
      text: 'var(--dsw-alias-label-primary)',
      text2: 'var(--dsw-alias-label-secondary)',
      text3: 'var(--dsw-alias-label-tertiary)',
      border: 'var(--dsw-alias-border-l1)',
      card: 'var(--dsw-specific-menu)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warning-primary, #d98a00)',
      bad: 'var(--dsw-alias-state-error-primary)',
      accent: 'var(--dsw-alias-state-business-primary)',
    };
    const S = {
      root: { boxSizing: 'border-box', width: '100%', height: '100%', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '12px 12px 24px', color: C.text, fontSize: FONT, lineHeight: '20px' },
      top: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 2px 10px' },
      topTitle: { flex: 'auto', minWidth: 0, fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      iconButton: { flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', padding: 0, border: 'none', borderRadius: 'var(--dsw-radius-sm)', background: 'transparent', color: C.text2, cursor: 'pointer' },
      card: { margin: '0 0 10px', border: '0.5px solid ' + C.border, borderRadius: 'var(--dsw-radius-lg)', background: C.card, overflow: 'hidden' },
      cardHead: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', minHeight: '36px', padding: '6px 12px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left' },
      cardTitle: { flex: 'none', fontSize: '12px', fontWeight: 600, letterSpacing: '0.02em', color: C.text2 },
      cardMeta: { flex: 'auto', minWidth: 0, textAlign: 'right', fontSize: '12px', color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      chevron: { flex: 'none', width: '12px', color: C.text3, fontSize: '10px', textAlign: 'center' },
      cardBody: { padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: '6px' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
      label: { flex: 'none', width: '64px', fontSize: '12px', color: C.text3 },
      value: { flex: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      mono: { fontFamily: MONO, fontSize: '12px' },
      muted: { fontSize: '12px', color: C.text3 },
      hint: { margin: 0, fontSize: '12px', color: C.text3 },
      error: { margin: 0, fontSize: '12px', color: C.bad },
      dot: { flex: 'none', width: '8px', height: '8px', borderRadius: '50%' },
      item: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, minHeight: '28px', padding: '2px 6px', margin: '0 -6px', borderRadius: 'var(--dsw-radius-sm)' },
      itemMain: { flex: 'auto', minWidth: 0, display: 'flex', flexDirection: 'column' },
      itemName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      itemSub: { fontSize: '11px', lineHeight: '15px', color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      pill: { flex: 'none', display: 'inline-flex', alignItems: 'center', height: '22px', padding: '0 8px', border: '0.5px solid ' + C.border, borderRadius: '11px', background: 'transparent', color: C.text2, cursor: 'pointer', font: 'inherit', fontSize: '11px', whiteSpace: 'nowrap' },
      linkButton: { alignSelf: 'flex-start', padding: 0, border: 'none', background: 'transparent', color: C.text3, cursor: 'pointer', font: 'inherit', fontSize: '12px' },
      meter: { position: 'relative', flex: 'auto', height: '6px', borderRadius: '3px', background: C.hover, overflow: 'hidden' },
      chips: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      chip: { display: 'inline-flex', alignItems: 'center', gap: '6px', maxWidth: '100%', height: '24px', padding: '0 8px', border: '0.5px solid ' + C.border, borderRadius: 'var(--dsw-radius-sm)', fontSize: '12px', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      input: { boxSizing: 'border-box', width: '100%', height: '28px', padding: '0 8px', border: '0.5px solid ' + C.border, borderRadius: 'var(--dsw-radius-sm)', background: 'transparent', color: C.text, font: 'inherit', fontSize: '12px' },
      tabs: { display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' },
      tab: { flex: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 10px', border: '0.5px solid ' + C.border, borderRadius: '13px', background: 'transparent', color: C.text2, cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 400 },
      tabActive: { background: C.hover, color: C.text, fontWeight: 600 },
      stats: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' },
      stat: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px', border: '0.5px solid ' + C.border, borderRadius: 'var(--dsw-radius-sm)', minWidth: 0 },
      statNum: { fontSize: '16px', fontWeight: 600, lineHeight: '20px', fontVariantNumeric: 'tabular-nums' },
      statLabel: { fontSize: '11px', color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: { flex: 'none', width: '16px', textAlign: 'center', fontFamily: MONO, fontSize: '11px', fontWeight: 700 },
      add: { color: C.ok, fontFamily: MONO, fontSize: '11px', fontVariantNumeric: 'tabular-nums' },
      del: { color: C.bad, fontFamily: MONO, fontSize: '11px', fontVariantNumeric: 'tabular-nums' },
      subhead: { margin: '6px 0 0', fontSize: '11px', fontWeight: 600, color: C.text3 },
    };

    const STATE_COLOR = { M: C.warn, A: C.ok, D: C.bad, R: C.accent, C: C.bad, U: C.text3, '!': C.bad, '~': C.bad };

    // ---------------------------------------------------------------- helpers

    const readJson = function (key) {
      try {
        const raw = globalThis.localStorage === undefined ? null : globalThis.localStorage.getItem(key);
        const parsed = raw === null ? {} : JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (_unavailable) {
        return {};
      }
    };
    const writeJson = function (key, value) {
      try {
        if (globalThis.localStorage !== undefined) globalThis.localStorage.setItem(key, JSON.stringify(value));
      } catch (_unavailable) {}
    };

    const baseName = function (path) {
      const parts = String(path).split(/[\\/]/).filter(function (part) { return part !== ''; });
      return parts.length === 0 ? String(path) : parts[parts.length - 1];
    };
    const dirName = function (path) {
      const parts = String(path).split(/[\\/]/);
      parts.pop();
      return parts.join('/');
    };
    /** Directory of `path` relative to `cwd` when inside it ('' at the root), else the absolute directory. */
    const relDir = function (path, cwd) {
      const dir = dirName(String(path).replace(/\\/g, '/'));
      const root = typeof cwd === 'string' ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : '';
      if (root === '') return dir;
      if (dir.toLowerCase() === root.toLowerCase()) return '';
      if (dir.toLowerCase().startsWith(root.toLowerCase() + '/')) return dir.slice(root.length + 1);
      return dir;
    };
    const tokens = function (n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '–';
      if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
      return String(n);
    };
    const ago = function (t, at) {
      if (typeof at !== 'number') return '';
      const s = Math.max(0, (Date.now() - at) / 1000);
      if (s < 60) return t('ago.now');
      if (s < 3600) return t('ago.min', { n: Math.floor(s / 60) });
      if (s < 86400) return t('ago.hour', { n: Math.floor(s / 3600) });
      return t('ago.day', { n: Math.floor(s / 86400) });
    };
    const errorText = function (error) {
      return error instanceof Error ? error.message : String(error);
    };

    const fileAddress = function (sessionId, cwd, path) {
      const seg = function (s) { return encodeURIComponent(s).replace(/%3A/gi, ':'); };
      const enc = function (p) { return p.split('/').map(seg).join('/'); };
      const make = function (p) { return 'dsh-resource://file/session/' + seg(sessionId) + '/' + enc(p.replace(/^(?:\.\/)+/, '')); };
      const normalized = String(path).replace(/\\/g, '/');
      const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//');
      if (!absolute) return make(normalized);
      const root = typeof cwd === 'string' ? cwd.replace(/\\/g, '/').replace(/\/+$/, '') : '';
      if (root !== '' && normalized.toLowerCase() === root.toLowerCase()) return make('');
      if (root !== '' && normalized.toLowerCase().startsWith(root.toLowerCase() + '/')) return make(normalized.slice(root.length + 1));
      return make(normalized);
    };

    /** Minimal external store. */
    const createSignal = function (initial) {
      let value = initial;
      const listeners = new Set();
      return {
        get: function () { return value; },
        set: function (next) { value = next; listeners.forEach(function (listener) { listener(); }); },
        subscribe: function (listener) { listeners.add(listener); return function () { listeners.delete(listener); }; },
      };
    };
    const pluginRemote = createSignal(null);
    const skillsRemote = createSignal(null);
    const pluginEvents = createSignal(0);

    const useSignal = function (signal) {
      return React.useSyncExternalStore(signal.subscribe, signal.get);
    };

    /** Poll a JSON loader while `active`; returns { data, error, loading, refresh }. */
    const usePolled = function (load, key, active, intervalMs) {
      const [state, setState] = React.useState({ data: undefined, error: null, loading: true });
      const tick = React.useRef(0);
      const refresh = React.useCallback(function () {
        const id = ++tick.current;
        setState(function (prev) { return { ...prev, loading: true }; });
        Promise.resolve().then(load).then(function (data) {
          if (id === tick.current) setState({ data: data, error: null, loading: false });
        }, function (error) {
          if (id === tick.current) setState(function (prev) { return { data: prev.data, error: errorText(error), loading: false }; });
        });
      }, [key]);
      React.useEffect(function () {
        if (!active) return undefined;
        refresh();
        if (!intervalMs) return undefined;
        const timer = setInterval(refresh, intervalMs);
        return function () { clearInterval(timer); };
      }, [key, active, intervalMs]);
      return { data: state.data, error: state.error, loading: state.loading, refresh: refresh };
    };

    const getJson = function (url, init) {
      return fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init }).then(function (response) {
        if (!response.ok) return response.text().then(function (text) { throw new Error(response.status + ' ' + (text || response.statusText)); });
        return response.json();
      });
    };

    // -------------------------------------------------------------- pieces

    const Icon = function (props) {
      const paths = {
        panel: 'M2.5 3.5h11v9h-11zM9.5 3.5v9',
        refresh: 'M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5',
        branch: 'M5 3v10M5 9c0-2 6-1 6-4M11 3.5a1.2 1.2 0 1 0 0 .01M5 13.5a1.2 1.2 0 1 0 0 .01',
        file: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
        plug: 'M6 2v3M10 2v3M4.5 5h7v2a3.5 3.5 0 0 1-7 0zM8 10.5V14',
      };
      return h('svg', { width: props.size || 14, height: props.size || 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { flex: 'none' } },
        h('path', { d: paths[props.name], stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    };

    const Dot = function (props) {
      return h('span', { style: { ...S.dot, background: props.color, boxShadow: props.ring ? '0 0 0 3px color-mix(in srgb, ' + props.color + ' 20%, transparent)' : 'none' }, 'aria-hidden': true });
    };

    /** One collapsible card; collapse state persists per section id. */
    const Card = function (props) {
      const [collapsed, setCollapsed] = React.useState(function () { return readJson(COLLAPSE_KEY)[props.id] === true; });
      const toggle = function () {
        setCollapsed(function (value) {
          const next = !value;
          const all = readJson(COLLAPSE_KEY);
          all[props.id] = next;
          writeJson(COLLAPSE_KEY, all);
          return next;
        });
      };
      return h('section', { style: S.card, 'data-section': props.id },
        h('button', { type: 'button', style: S.cardHead, 'aria-expanded': !collapsed, onClick: toggle },
          h('span', { style: S.chevron }, collapsed ? '▸' : '▾'),
          h('span', { style: S.cardTitle }, props.title),
          h('span', { style: S.cardMeta }, props.meta || null)),
        collapsed ? null : h('div', { style: S.cardBody }, props.children));
    };

    const ShowMore = function (props) {
      if (props.total <= LIST_PREVIEW) return null;
      return h('button', { type: 'button', style: S.linkButton, onClick: props.onToggle },
        props.open ? props.t('show.less') : props.t('show.all', { n: props.total }));
    };

    // ------------------------------------------------------------ sections

    /**
     * 备注：每会话一段纯文本，只写进本机 localStorage，不进会话日志、不发给模型。
     * 输入 400ms 防抖保存，失焦立即落盘；清空即删除该会话的键。
     */
    const NoteSection = function (props) {
      const t = props.t;
      const storageKey = NOTE_KEY + String(props.sessionId === undefined ? '' : props.sessionId);
      const read = function () {
        try {
          const raw = globalThis.localStorage === undefined ? null : globalThis.localStorage.getItem(storageKey);
          return typeof raw === 'string' ? raw : '';
        } catch (_error) {
          return '';
        }
      };
      const [text, setText] = React.useState(read);
      const timer = React.useRef(undefined);
      const flush = function (value) {
        try {
          if (globalThis.localStorage === undefined) return;
          if (value === '') globalThis.localStorage.removeItem(storageKey);
          else globalThis.localStorage.setItem(storageKey, value);
        } catch (_error) {}
      };
      React.useEffect(function () {
        setText(read());
        return function () {
          if (timer.current !== undefined) {
            clearTimeout(timer.current);
            timer.current = undefined;
          }
        };
      }, [storageKey]);
      const onChange = function (event) {
        const value = event.target.value;
        setText(value);
        if (timer.current !== undefined) clearTimeout(timer.current);
        timer.current = setTimeout(function () { flush(value); }, 400);
      };
      const onBlur = function () {
        if (timer.current !== undefined) {
          clearTimeout(timer.current);
          timer.current = undefined;
        }
        flush(text);
      };
      return h(Card, { id: 'note', title: t('note'), meta: t('note.meta') },
        h('textarea', {
          value: text,
          onChange: onChange,
          onBlur: onBlur,
          placeholder: t('note.placeholder'),
          'aria-label': t('note'),
          spellCheck: false,
          rows: 4,
          style: { ...S.input, height: 'auto', minHeight: '72px', padding: '6px 8px', lineHeight: '18px', resize: 'vertical', font: 'inherit', fontSize: '12px' },
        }),
        h('p', { style: S.hint }, t('note.hint')));
    };

    const EnvSection = function (props) {
      const t = props.t;
      const roots = props.roots;
      return h(Card, { id: 'env', title: t('env') },
        h('div', { style: S.row },
          h('span', { style: S.label }, t('env.cwd')),
          props.cwd
            ? h('span', { style: { ...S.value, ...S.mono }, title: props.cwd }, props.cwd)
            : h('span', { style: S.muted }, t('env.none'))),
        roots.length > 0
          ? h('div', { style: { ...S.row, alignItems: 'flex-start' } },
              h('span', { style: S.label }, t('env.roots')),
              h('div', { style: { flex: 'auto', minWidth: 0, display: 'flex', flexDirection: 'column' } },
                roots.map(function (root) { return h('span', { key: root, style: { ...S.value, ...S.mono }, title: root }, root); })))
          : null);
    };

    const ContextSection = function (props) {
      const t = props.t;
      const pressure = props.pressure;
      const used = pressure ? (pressure.projectedTokens ?? pressure.pressureTokens) : undefined;
      const total = pressure ? pressure.contextWindow : undefined;
      const known = typeof used === 'number' && typeof total === 'number' && total > 0;
      const percent = known ? Math.min(100, Math.round(used / total * 100)) : null;
      const color = percent === null ? C.text3 : percent >= 85 ? C.bad : percent >= 65 ? C.warn : C.accent;
      return h(Card, { id: 'context', title: t('context'), meta: percent === null ? null : percent + '%' },
        known
          ? h('div', { style: S.row },
              h('div', { style: S.meter, role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent },
                h('div', { style: { position: 'absolute', inset: 0, width: percent + '%', background: color, borderRadius: '3px', transition: 'width .3s ease' } })),
              h('span', { style: { ...S.muted, ...S.mono, flex: 'none' } }, t('context.of', { used: tokens(used), total: tokens(total) })))
          : h('p', { style: S.hint }, t('context.unknown')));
    };

    const MCP_STATE = {
      connected: { color: C.ok, key: 'mcp.connected' },
      retrying: { color: C.warn, key: 'mcp.retrying' },
      starting: { color: C.warn, key: 'mcp.starting' },
      failed: { color: C.bad, key: 'mcp.failed' },
      disabled: { color: C.text3, key: 'mcp.disabled' },
    };

    const McpSection = function (props) {
      const t = props.t;
      const remote = useSignal(pluginRemote);
      const polled = usePolled(function () { return getJson('/api/sessionPanel.mcp'); }, 'mcp', props.visible, MCP_POLL_MS);
      const [busy, setBusy] = React.useState(null);
      const [actionError, setActionError] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const servers = polled.data && Array.isArray(polled.data.servers) ? polled.data.servers : [];
      const ok = servers.filter(function (server) { return server.state === 'connected'; }).length;
      const restart = function (server) {
        if (remote === null || busy !== null) return;
        setBusy(server.entryId);
        setActionError(null);
        const manager = remote.pluginManager;
        const step = function (enabled) {
          return Promise.resolve(manager.setPluginEnabled(server.entryId, enabled)).then(function (result) {
            if (result && result.ok === false) throw new Error(result.error && result.error.message ? result.error.message : 'error');
          });
        };
        const chain = server.state === 'disabled' ? step(true) : step(false).then(function () { return step(true); });
        chain.catch(function (error) { setActionError(errorText(error)); }).finally(function () {
          setBusy(null);
          setTimeout(polled.refresh, 1500);
        });
      };
      const shown = open ? servers : servers.slice(0, LIST_PREVIEW);
      return h(Card, { id: 'mcp', title: t('mcp'), meta: servers.length === 0 ? null : t('mcp.summary', { ok: ok, total: servers.length }) },
        polled.error !== null && servers.length === 0 ? h('p', { style: S.error }, t('mcp.error', { message: polled.error })) : null,
        polled.data !== undefined && servers.length === 0 ? h('p', { style: S.hint }, t('mcp.none')) : null,
        shown.map(function (server) {
          const meta = MCP_STATE[server.state] || MCP_STATE.failed;
          const canAct = remote !== null && server.state !== 'connected' && server.state !== 'starting';
          return h('div', { key: server.entryId, style: S.item, title: (server.target || '') + (server.tools && server.tools.length > 0 ? '\n' + server.tools.join(', ') : '') },
            h(Dot, { color: meta.color, ring: server.state === 'connected' }),
            h('div', { style: S.itemMain },
              h('span', { style: S.itemName }, server.serverName),
              h('span', { style: S.itemSub }, t(meta.key, { n: server.toolCount }))),
            canAct
              ? h('button', { type: 'button', style: S.pill, disabled: busy !== null, onClick: function () { restart(server); } },
                  busy === server.entryId ? t('mcp.reconnecting') : server.state === 'disabled' ? t('mcp.enable') : t('mcp.reconnect'))
              : null);
        }),
        h(ShowMore, { t: t, total: servers.length, open: open, onToggle: function () { setOpen(!open); } }),
        actionError === null ? null : h('p', { style: S.error }, actionError));
    };

    const PluginsSection = function (props) {
      const t = props.t;
      const remote = useSignal(pluginRemote);
      const changed = useSignal(pluginEvents);
      const [open, setOpen] = React.useState(false);
      const polled = usePolled(function () {
        if (remote === null) return null;
        return Promise.resolve(remote.pluginManager.listBundles()).then(function (result) {
          if (!result || result.ok === false) throw new Error(result && result.error && result.error.message ? result.error.message : 'listBundles failed');
          return result.value;
        });
      }, 'plugins:' + (remote === null ? 0 : 1) + ':' + changed, props.visible && remote !== null, 0);
      if (remote === null) return h(Card, { id: 'plugins', title: t('plugins') }, h('p', { style: S.hint }, t('plugins.unavailable')));
      const bundles = Array.isArray(polled.data) ? polled.data.filter(function (bundle) { return bundle && bundle.installed !== false; }) : [];
      const resolve = props.resolveText;
      const named = bundles.map(function (bundle) {
        const meta = bundle.meta || {};
        const failing = Boolean(bundle.error || meta.error);
        return {
          name: bundle.name,
          title: resolve(meta.title) || bundle.name,
          description: resolve(meta.description) || resolve(bundle.description) || '',
          enabled: bundle.enabled === true,
          failing: failing,
          error: failing ? String((bundle.error && bundle.error.message) || bundle.error || meta.error) : '',
        };
      }).sort(function (a, b) {
        return Number(b.failing) - Number(a.failing) || Number(b.enabled) - Number(a.enabled) || a.title.localeCompare(b.title);
      });
      const on = named.filter(function (item) { return item.enabled; }).length;
      const failing = named.filter(function (item) { return item.failing; }).length;
      const shown = open ? named : named.slice(0, LIST_PREVIEW * 2);
      const meta = [t('plugins.summary', { on: on }), ...(failing > 0 ? [t('plugins.failing', { n: failing })] : [])].join(' · ');
      return h(Card, { id: 'plugins', title: t('plugins'), meta: polled.data === undefined ? null : meta },
        polled.error !== null ? h('p', { style: S.error }, polled.error) : null,
        h('div', { style: S.chips },
          shown.map(function (item) {
            const color = item.failing ? C.bad : item.enabled ? C.ok : C.text3;
            return h('span', { key: item.name, style: { ...S.chip, opacity: item.enabled ? 1 : 0.6 }, title: item.title + '\n' + item.name + (item.description ? '\n' + item.description : '') + (item.error ? '\n' + item.error : '') + (item.enabled ? '' : '\n' + t('plugins.off')) },
              h(Dot, { color: color }), item.title);
          })),
        named.length > LIST_PREVIEW * 2
          ? h('button', { type: 'button', style: S.linkButton, onClick: function () { setOpen(!open); } }, open ? t('show.less') : t('show.all', { n: named.length }))
          : null);
    };

    const SkillsSection = function (props) {
      const t = props.t;
      const remote = useSignal(skillsRemote);
      const changed = useSignal(pluginEvents);
      const [filter, setFilter] = React.useState('');
      const [open, setOpen] = React.useState(false);
      const polled = usePolled(function () {
        if (remote === null) return null;
        return Promise.resolve(remote.skills.list({ sessionId: props.sessionId })).then(function (result) {
          if (!result || result.ok === false) throw new Error(result && result.error && result.error.message ? result.error.message : 'skills.list failed');
          return result.value && Array.isArray(result.value.skills) ? result.value.skills : [];
        });
      }, 'skills:' + props.sessionId + ':' + (remote === null ? 0 : 1) + ':' + changed, props.visible && remote !== null, 0);
      if (remote === null) return h(Card, { id: 'skills', title: t('skills') }, h('p', { style: S.hint }, t('skills.unavailable')));
      const skills = Array.isArray(polled.data) ? polled.data.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }) : [];
      const needle = filter.trim().toLowerCase();
      const matched = needle === '' ? skills : skills.filter(function (skill) {
        return String(skill.name).toLowerCase().includes(needle) || String(skill.description || '').toLowerCase().includes(needle);
      });
      const shown = open || needle !== '' ? matched : matched.slice(0, LIST_PREVIEW);
      return h(Card, { id: 'skills', title: t('skills'), meta: polled.data === undefined ? null : t('skills.summary', { n: skills.length }) },
        polled.error !== null ? h('p', { style: S.error }, polled.error) : null,
        skills.length > LIST_PREVIEW ? h('input', { style: S.input, value: filter, placeholder: t('skills.filter'), 'aria-label': t('skills.filter'), onChange: function (event) { setFilter(event.target.value); } }) : null,
        shown.map(function (skill) {
          return h('div', { key: skill.name, style: S.item, title: (skill.description || '') + (skill.whenToUse ? '\n' + skill.whenToUse : '') },
            h(Dot, { color: skill.modelInvocable === false ? C.text3 : C.accent }),
            h('div', { style: S.itemMain },
              h('span', { style: { ...S.itemName, ...S.mono } }, '/' + skill.name),
              skill.description ? h('span', { style: S.itemSub }, skill.description) : null));
        }),
        needle === '' ? h(ShowMore, { t: t, total: matched.length, open: open, onToggle: function () { setOpen(!open); } }) : null);
    };

    const OutputsSection = function (props) {
      const t = props.t;
      const [open, setOpen] = React.useState(false);
      const files = props.outputs && Array.isArray(props.outputs.files) ? props.outputs.files : [];
      const shown = open ? files : files.slice(0, LIST_PREVIEW);
      return h(Card, { id: 'outputs', title: t('outputs'), meta: files.length > 0 ? String(files.length) : null },
        files.length === 0 ? h('p', { style: S.hint }, t('outputs.none')) : null,
        shown.map(function (file) {
          const edits = (file.edits || 0);
          const sub = [file.writes > 0 ? t('outputs.written') : null, edits > 0 ? t('outputs.edited', { n: edits }) : null, ago(t, file.at)].filter(Boolean).join(' · ');
          return h('button', {
            key: file.path,
            type: 'button',
            style: { ...S.item, width: 'calc(100% + 12px)', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left' },
            title: file.path,
            onClick: function () { props.openFile(file.path); },
          },
            h('span', { style: { color: C.text3 } }, h(Icon, { name: 'file' })),
            h('div', { style: S.itemMain },
              h('span', { style: S.itemName }, baseName(file.path)),
              h('span', { style: S.itemSub }, [relDir(file.path, props.cwd), sub].filter(Boolean).join('  ·  '))));
        }),
        h(ShowMore, { t: t, total: files.length, open: open, onToggle: function () { setOpen(!open); } }));
    };

    const AddDel = function (props) {
      return h('span', { style: { flex: 'none', display: 'inline-flex', gap: '6px' } },
        typeof props.add === 'number' ? h('span', { style: S.add }, '+' + props.add) : null,
        typeof props.del === 'number' ? h('span', { style: S.del }, '−' + props.del) : null);
    };

    const Stat = function (props) {
      return h('div', { style: S.stat, title: props.title || props.label },
        h('span', { style: { ...S.statNum, color: props.color || C.text } }, props.value),
        h('span', { style: S.statLabel }, props.label));
    };

    const CommitList = function (props) {
      if (!Array.isArray(props.commits) || props.commits.length === 0) return null;
      return h(React.Fragment, null,
        h('p', { style: S.subhead }, props.title),
        props.commits.map(function (commit) {
          return h('div', { key: commit.hash, style: S.item, title: commit.subject },
            h('span', { style: { ...S.mono, color: C.accent, flex: 'none' } }, commit.hash),
            h('span', { style: { ...S.value, fontSize: '12px' } }, commit.subject),
            h('span', { style: { ...S.muted, flex: 'none', fontSize: '11px' } }, ago(props.t, commit.at)));
        }),
        props.more ? h('p', { style: S.hint }, props.t('changes.more')) : null);
    };

    const FileList = function (props) {
      const [open, setOpen] = React.useState(false);
      const list = props.changes && Array.isArray(props.changes.list) ? props.changes.list : [];
      const shown = open ? list : list.slice(0, LIST_PREVIEW + 2);
      return h(React.Fragment, null,
        shown.map(function (file) {
          return h('button', {
            key: file.state + file.path,
            type: 'button',
            style: { ...S.item, width: 'calc(100% + 12px)', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left' },
            title: file.path,
            onClick: function () { props.openFile(props.root + '/' + file.path); },
          },
            h('span', { style: { ...S.badge, color: STATE_COLOR[file.state] || C.text2 } }, file.state),
            h('span', { style: { ...S.value, fontSize: '12px' } },
              baseName(file.path),
              h('span', { style: { color: C.text3, marginLeft: '6px', fontSize: '11px' } }, dirName(file.path))),
            h(AddDel, { add: file.add, del: file.del }));
        }),
        list.length > LIST_PREVIEW + 2
          ? h('button', { type: 'button', style: S.linkButton, onClick: function () { setOpen(!open); } },
              open ? props.t('show.less') : props.t('show.all', { n: list.length + (props.changes.truncated ? '+' : '') }))
          : null);
    };

    const GitReport = function (props) {
      const t = props.t;
      const r = props.report;
      const changes = r.changes || { files: 0, add: 0, del: 0 };
      const hasRemote = typeof r.compareRef === 'string' && r.compareRef !== '';
      return h(React.Fragment, null,
        h('div', { style: S.row },
          h('span', { style: { color: C.text3 } }, h(Icon, { name: 'branch' })),
          h('span', { style: { ...S.value, ...S.mono }, title: (r.branch || 'HEAD') + (hasRemote ? ' → ' + r.compareRef : '') },
            (r.branch || (r.head ? r.head.hash : 'HEAD')) + (hasRemote ? '  →  ' + r.compareRef : ''))),
        r.remoteUrl ? h('span', { style: { ...S.itemSub, ...S.mono }, title: r.remoteUrl }, r.remoteUrl) : null,
        hasRemote && r.upstream === null ? h('p', { style: S.hint }, t('changes.notUpstream', { ref: r.compareRef })) : null,
        hasRemote ? null : h('p', { style: S.hint }, t('changes.noRemote')),
        h('div', { style: S.stats },
          hasRemote ? h(Stat, { value: '↑' + r.ahead, label: t('changes.statAhead'), color: r.ahead > 0 ? C.warn : C.text }) : null,
          hasRemote ? h(Stat, { value: '↓' + r.behind, label: t('changes.statBehind'), color: r.behind > 0 ? C.accent : C.text }) : null,
          h(Stat, { value: String(changes.files), label: t('changes.statFiles'), color: changes.files > 0 ? C.warn : C.ok }),
          h(Stat, {
            value: h('span', null, h('span', { style: { color: C.ok } }, '+' + (changes.add || 0)), ' ', h('span', { style: { color: C.bad } }, '−' + (changes.del || 0))),
            label: t('changes.statLines'),
          })),
        hasRemote && r.vsRemote ? h('p', { style: S.hint }, t('changes.vsRemoteLine', { ref: r.compareRef, files: r.vsRemote.files, add: r.vsRemote.add, del: r.vsRemote.del })) : null,
        h('div', { style: { ...S.row, justifyContent: 'space-between' } },
          h('span', { style: S.muted },
            [
              changes.files === 0 ? t('changes.clean') : null,
              changes.untracked > 0 ? t('changes.untracked', { n: changes.untracked }) : null,
              changes.conflicted > 0 ? t('changes.conflicted', { n: changes.conflicted }) : null,
              hasRemote ? (r.lastFetchAt ? t('changes.fetchedAt', { time: ago(t, r.lastFetchAt) }) : t('changes.neverFetched')) : null,
            ].filter(Boolean).join(' · ')),
          hasRemote || r.remote ? h('button', { type: 'button', style: S.pill, disabled: props.fetching, onClick: props.onFetch }, props.fetching ? t('changes.fetching') : t('changes.fetch')) : null),
        r.fetchError ? h('p', { style: S.error }, r.fetchError) : null,
        h(FileList, { t: t, changes: changes, root: r.root, openFile: props.openFile }),
        h(CommitList, { t: t, title: t('changes.unpushed'), commits: r.unpushed, more: r.ahead > (r.unpushed || []).length }),
        h(CommitList, { t: t, title: t('changes.unpulled'), commits: r.unpulled, more: r.behind > (r.unpulled || []).length }));
    };

    const SvnReport = function (props) {
      const t = props.t;
      const r = props.report;
      const changes = r.changes || { files: 0, add: 0, del: 0 };
      return h(React.Fragment, null,
        h('div', { style: S.row },
          h('span', { style: { color: C.text3 } }, h(Icon, { name: 'branch' })),
          h('span', { style: { ...S.value, ...S.mono }, title: r.url || '' }, r.url || r.root)),
        h('div', { style: S.stats },
          h(Stat, { value: r.behind === null ? '–' : '↓' + r.behind, label: r.headRevision === null ? t('changes.svnRevLocal', { local: r.revision }) : t('changes.svnRev', { local: r.revision, remote: r.headRevision }), color: r.behind > 0 ? C.accent : C.text }),
          h(Stat, { value: String(changes.files), label: t('changes.statFiles'), color: changes.files > 0 ? C.warn : C.ok }),
          h(Stat, { value: h('span', null, h('span', { style: { color: C.ok } }, '+' + (changes.add || 0)), ' ', h('span', { style: { color: C.bad } }, '−' + (changes.del || 0))), label: t('changes.statLines') }),
          r.outdated === null
            ? h(Stat, { value: String(changes.untracked || 0), label: t('changes.untrackedLabel') })
            : h(Stat, { value: String(r.outdated), label: t('changes.svnOutdatedLabel'), color: r.outdated > 0 ? C.accent : C.text })),
        h('div', { style: { ...S.row, justifyContent: 'space-between' } },
          h('span', { style: S.muted }, [changes.files === 0 ? t('changes.clean') : null, changes.conflicted > 0 ? t('changes.conflicted', { n: changes.conflicted }) : null].filter(Boolean).join(' · ')),
          h('button', { type: 'button', style: S.pill, disabled: props.fetching, onClick: props.onFetch }, props.fetching ? t('changes.fetching') : t('changes.fetch'))),
        r.remoteError ? h('p', { style: S.error }, t('changes.svnRemoteError', { message: r.remoteError })) : null,
        h(FileList, { t: t, changes: changes, root: r.root, openFile: props.openFile }));
    };

    const ChangesSection = function (props) {
      const t = props.t;
      const roots = props.dirs;
      const query = roots.map(function (root) { return 'root=' + encodeURIComponent(root); }).join('&');
      const polled = usePolled(function () {
        if (roots.length === 0) return { roots: [] };
        return getJson('/api/sessionPanel.vcs?' + query);
      }, 'vcs:' + query + ':' + props.turnKey, props.visible, VCS_POLL_MS);
      const [override, setOverride] = React.useState({});
      const [fetching, setFetching] = React.useState(null);
      const [fetchError, setFetchError] = React.useState(null);
      const [pick, setPick] = React.useState(function () { return readJson(PICK_KEY)[props.sessionId] || null; });

      // Flatten roots × providers into switchable entries; de-duplicate by repo root.
      const entries = [];
      const seen = new Set();
      const results = polled.data && Array.isArray(polled.data.roots) ? polled.data.roots : [];
      results.forEach(function (result) {
        (result.providers || []).forEach(function (report) {
          const id = report.kind + ':' + report.root;
          if (seen.has(id)) return;
          seen.add(id);
          entries.push({ id: id, report: override[id] || report });
        });
      });
      const selected = entries.find(function (entry) { return entry.id === pick; }) || entries[0];
      const choose = function (id) {
        setPick(id);
        const all = readJson(PICK_KEY);
        all[props.sessionId] = id;
        writeJson(PICK_KEY, all);
      };
      const fetchRemote = function (entry) {
        if (fetching !== null) return;
        setFetching(entry.id);
        setFetchError(null);
        getJson('/api/sessionPanel.vcsFetch?root=' + encodeURIComponent(entry.report.root) + '&kind=' + entry.report.kind, { method: 'POST' })
          .then(function (data) {
            const report = data && data.roots && data.roots[0] && data.roots[0].providers ? data.roots[0].providers.find(function (item) { return item.kind === entry.report.kind; }) : undefined;
            if (report !== undefined) setOverride(function (prev) { return { ...prev, [entry.id]: report }; });
          })
          .catch(function (error) { setFetchError(errorText(error)); })
          .finally(function () { setFetching(null); });
      };
      React.useEffect(function () { setOverride({}); }, [polled.data]);

      const summary = selected === undefined ? null : (function () {
        const r = selected.report;
        const files = r.changes ? r.changes.files : 0;
        if (r.kind === 'git') return (r.ahead > 0 ? '↑' + r.ahead + ' ' : '') + (r.behind > 0 ? '↓' + r.behind + ' ' : '') + (files > 0 ? '±' + files : '');
        return (r.behind > 0 ? '↓' + r.behind + ' ' : '') + (files > 0 ? '±' + files : '');
      })();

      return h(Card, { id: 'changes', title: t('changes'), meta: summary },
        polled.data === undefined && polled.loading ? h('p', { style: S.hint }, t('changes.loading')) : null,
        polled.error !== null && entries.length === 0 ? h('p', { style: S.error }, t('changes.error', { message: polled.error })) : null,
        polled.data !== undefined && entries.length === 0 && polled.error === null ? h('p', { style: S.hint }, t('changes.none')) : null,
        entries.length > 1
          ? h('div', { style: S.tabs, role: 'tablist' },
              entries.map(function (entry) {
                const active = selected !== undefined && entry.id === selected.id;
                const r = entry.report;
                const drift = (r.changes ? r.changes.files : 0) + (r.ahead || 0) + (r.behind || 0);
                return h('button', { key: entry.id, type: 'button', role: 'tab', 'aria-selected': active, style: active ? { ...S.tab, ...S.tabActive } : S.tab, title: r.root, onClick: function () { choose(entry.id); } },
                  h(Dot, { color: r.error ? C.bad : drift > 0 ? C.warn : C.ok }),
                  r.kind.toUpperCase() + ' · ' + baseName(r.root));
              }))
          : null,
        selected === undefined ? null
          : selected.report.error
            ? h('p', { style: S.error }, t('changes.error', { message: selected.report.error }))
            : selected.report.kind === 'git'
              ? h(GitReport, { t: t, report: selected.report, fetching: fetching === selected.id, onFetch: function () { fetchRemote(selected); }, openFile: props.openFile })
              : h(SvnReport, { t: t, report: selected.report, fetching: fetching === selected.id, onFetch: function () { fetchRemote(selected); }, openFile: props.openFile }),
        fetchError === null ? null : h('p', { style: S.error }, fetchError));
    };

    // -------------------------------------------------------------- body

    function PanelBody(props) {
      const t = props.t;
      const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined;
      const visible = info === undefined || info.tab === undefined || info.tab.visible !== false;
      const cwdProjection = props.useProjection('workingDirectory');
      const rootsProjection = props.useProjection('multiWorkspaceRoots');
      const pressure = props.useProjection('contextPressure');
      const outputs = props.useProjection('sessionPanelOutputs');
      const running = typeof props.useSession === 'function' ? props.useSession(function (s) { return Boolean(s && s.running); }) : false;
      const sessions = props.sessions;
      const list = sessions.list;
      const rows = React.useSyncExternalStore(
        React.useCallback(function (listener) { return list.subscribe(listener); }, [list]),
        React.useCallback(function () { return list.getSnapshot(); }, [list]),
      );
      const row = rows && rows.byId ? rows.byId[props.sessionId] : undefined;
      const cwd = typeof cwdProjection === 'string' && cwdProjection !== '' ? cwdProjection : row && typeof row.cwd === 'string' ? row.cwd : '';
      const roots = rootsProjection && Array.isArray(rootsProjection.roots) ? rootsProjection.roots : [];
      const dirs = [cwd, ...roots].filter(function (dir, index, all) { return typeof dir === 'string' && dir !== '' && all.indexOf(dir) === index; });
      // Re-read repositories whenever a turn finishes (the agent may have edited files).
      const [turnKey, setTurnKey] = React.useState(0);
      const wasRunning = React.useRef(running);
      React.useEffect(function () {
        if (wasRunning.current && !running) setTurnKey(function (value) { return value + 1; });
        wasRunning.current = running;
      }, [running]);
      const [refreshKey, setRefreshKey] = React.useState(0);
      const openFile = function (path) {
        try {
          props.openResource(fileAddress(props.sessionId, cwd, path));
        } catch (error) {
          console.warn('session panel: open failed: ' + errorText(error));
        }
      };
      const title = row ? sideTitleText(row.displayTitle || row.title || '') : '';
      return h('div', { style: S.root, 'data-session-panel': '' },
        h('div', { style: S.top },
          h('span', { style: { color: C.text3 } }, h(Icon, { name: 'panel', size: 16 })),
          h('span', { style: S.topTitle, title: title }, title || t('title')),
          h('button', { type: 'button', style: S.iconButton, title: t('refresh'), 'aria-label': t('refresh'), onClick: function () { setRefreshKey(function (value) { return value + 1; }); pluginEvents.set(pluginEvents.get() + 1); } },
            h(Icon, { name: 'refresh' }))),
        h(NoteSection, { t: t, sessionId: props.sessionId }),
        h(EnvSection, { t: t, cwd: cwd, roots: roots }),
        h(ContextSection, { t: t, pressure: pressure }),
        h(McpSection, { key: 'mcp' + refreshKey, t: t, visible: visible }),
        h(PluginsSection, { t: t, visible: visible, resolveText: props.resolveText }),
        h(SkillsSection, { t: t, visible: visible, sessionId: props.sessionId }),
        h(OutputsSection, { t: t, outputs: outputs, openFile: openFile, cwd: cwd }),
        h(ChangesSection, { key: 'vcs' + refreshKey, t: t, visible: visible, dirs: dirs, sessionId: props.sessionId, turnKey: turnKey, openFile: openFile }));
    }

    function HeaderToggle(props) {
      const label = props.t('toggle');
      return h('button', {
        type: 'button',
        title: label,
        'aria-label': label,
        onClick: function () { props.togglePanel(); },
        style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: 'var(--dsw-radius-sm)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
      }, h(Icon, { name: 'panel', size: 16 }));
    }

    const GuideIcon = function () {
      return h('span', { style: { display: 'inline-flex', color: 'var(--dsw-alias-label-secondary)' } }, h(Icon, { name: 'panel', size: 20 }));
    };

    // --------------------------------------------------------------- apply

    const inject = ['slots', 'sessions', 'locale', 'uiWorkspace', 'shortcuts'];

    function mainSessionId(ctx) {
      const ui = ctx.get('uiWorkspace');
      const reference = ui === undefined ? undefined : ui.mainReference;
      if (reference !== undefined && reference !== null) return reference.sessionId;
      const rows = ctx.get('sessions').list.getSnapshot();
      const row = Object.values(rows.byId || {}).find(function (candidate) {
        return candidate && candidate.retainedBy && (candidate.retainedBy.mainView ?? 0) > 0;
      });
      return row === undefined ? undefined : row.id;
    }

    /** Show the panel; when it is already the visible tab, hide the column (Claude-style toggle). */
    function togglePanel(ctx) {
      const sidebar = ctx.get('sidebarRight');
      const sessionId = mainSessionId(ctx);
      if (sidebar === undefined || sessionId === undefined) return;
      try {
        const tabs = sidebar.tabsIn(sessionId) || [];
        const mine = tabs.find(function (tab) { return tab.kind === KIND; });
        const active = sidebar.active();
        if (mine !== undefined && sidebar.isExpanded() && active !== undefined && active.id === mine.id) {
          sidebar.hide(mine.id);
          return;
        }
        if (mine !== undefined) {
          if (!sidebar.isExpanded()) sidebar.toggleExpanded();
          sidebar.focus(mine.id);
          return;
        }
        sidebar.openTab(KIND, { revealIfOpened: true });
      } catch (error) {
        console.warn('session panel: toggle failed: ' + errorText(error));
      }
    }

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'session-panel: dictionaries');
      const t = function (key, vars) { return ctx.locale.bind(NS)(key, vars); };
      const resolveText = function (text) {
        if (text === undefined || text === null) return '';
        if (typeof text === 'string') return text;
        try {
          if (typeof ctx.locale.resolveText === 'function') return String(ctx.locale.resolveText(text) || '');
        } catch (_ignored) {}
        return String(text.zh || text.en || Object.values(text)[0] || '');
      };

      // Remote namespaces are optional: each section degrades on its own.
      ctx.inject(['remote', 'remote.pluginManager'], function (scope) {
        pluginRemote.set(scope.remote);
        let off;
        try {
          off = scope.remote.$on('plugin-manager/changed', function () { pluginEvents.set(pluginEvents.get() + 1); });
        } catch (_ignored) {}
        scope.effect(function () {
          return function () {
            pluginRemote.set(null);
            if (typeof off === 'function') off();
          };
        }, 'session-panel: plugin remote');
      });
      ctx.inject(['remote', 'remote.skills'], function (scope) {
        skillsRemote.set(scope.remote);
        scope.effect(function () { return function () { skillsRemote.set(null); }; }, 'session-panel: skills remote');
      });

      ctx.inject(['sidebarRightTabs', 'sidebarRight'], function (scope) {
        scope.effect(function () {
          return scope.sidebarRightTabs.register({
            id: TAB_ID,
            kind: KIND,
            multiple: false,
            priority: 'builtin',
            title: function () { return t('title'); },
            guide: [{
              id: 'open',
              order: 5,
              title: function () { return t('guide.title'); },
              description: function () { return t('guide.description'); },
              icon: GuideIcon,
            }],
          });
        }, 'session-panel: tab type');

        scope.effect(function () {
          return ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register({
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
              locale: NS,
              inject: function (sessionId) {
                return {
                  sessionId: sessionId,
                  sessions: ctx.sessions,
                  resolveText: resolveText,
                  openResource: function (address) { scope.sidebarRight.openResourceIn ? scope.sidebarRight.openResourceIn(sessionId, address) : scope.sidebarRight.openResource(address); },
                };
              },
            }, PanelBody);
          });
        }, 'session-panel: tab body');
      });

      ctx.effect(function () {
        return ctx.slots.inject('conversation.session.header.utilities', function () {
          return ctx.slots.register({
            name: 'conversation.session.header.utilities',
            id: 'session-panel-toggle',
            order: 90,
            locale: NS,
            inject: function () {
              return { togglePanel: function () { togglePanel(ctx); } };
            },
          }, HeaderToggle);
        });
      }, 'session-panel: header toggle');

      ctx.effect(function () {
        return ctx.shortcuts.register({
          id: 'session.panel',
          label: function () { return t('toggle'); },
          aliases: ['session overview', 'session panel', '会话概览'],
          defaults: {
            'desktop:macos': { code: 'Quote', modifiers: ['primary'] },
            'desktop:windows': { code: 'Quote', modifiers: ['primary'] },
            'desktop:linux': { code: 'Quote', modifiers: ['primary'] },
            'web:macos': { code: 'Quote', modifiers: ['primary', 'alt'] },
            'web:windows': { code: 'Quote', modifiers: ['primary', 'alt'] },
          },
          regions: ['page', 'editable'],
          modals: ['sidebar'],
          resolve: function () {
            return { status: 'handled', run: function () { togglePanel(ctx); } };
          },
        });
      }, 'session-panel: Ctrl+\' shortcut');
    }

    return { apply: apply, inject: inject };
  },
});
