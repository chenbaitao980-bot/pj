/**
 * Client half of `@local/dsh-plugin-slash`.
 *
 * The Harness `/` menu is a pipeline of trigger sources: `ui-commands` owns the
 * "command" group, `ui-skill` the "skill" group. This plugin adds a "plugin"
 * group that lists the plugins the current profile actually loaded and enabled,
 * with the display text each package already publishes in its `locale/*.json`.
 *
 * Picking a row inserts a short request naming the plugin, so the composer
 * stays the place where the user finishes the thought, e.g.
 *   `使用插件 dsh-tool-websearch ` + the query.
 *
 * The group is deliberately read-only: it never toggles plugins and never
 * executes a command. Host plugins without a slash command stay reachable
 * from here anyway, which is the gap the menu had.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-slash',
  factory(require) {
    const NS = 'pluginSlash';
    const zh = {
      'pick.prefix': '使用插件 {name} ',
      'empty': '没有已启用的插件。',
    };
    const en = {
      'pick.prefix': 'Use the plugin {name} ',
      'empty': 'No enabled plugins.',
    };

    /** Packages that make up the harness itself; they are not "plugins" to a user. */
    const INTERNAL = /^(@deepseek-ai\/|@cordisjs\/|@satorijs\/|cordis($|-)|cosmokit$|schemastery$)/;

    /**
     * The Loader also mounts subpath modules (`dsh-purge/redteam`), Windows
     * paths, and colon-namespaced or resolved specifiers (`cordis:loader`,
     * `file://…`); only bare package names belong in a user-facing plugin list.
     * A scoped package has exactly one slash (`@scope/name`), a plain one none.
     */
    const isPackageName = (name) => {
      if (name === '' || name.includes('\\') || name.includes(':')) return false;
      if (name.startsWith('.') || name.startsWith('/')) return false;
      const parts = name.split('/');
      return name.startsWith('@') ? parts.length === 2 && parts.every(Boolean) : parts.length === 1;
    };

    /** How long an inventory read is reused before the next menu open re-reads it. */
    const CACHE_TTL_MS = 15000;

    const inject = ['locale', 'sessions', 'inputTriggers', 'remote', 'remote.pluginInventory'];

    /**
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'plugin-slash: dictionaries');

      const sessions = ctx.get('sessions');
      const inputTriggers = ctx.get('inputTriggers');

      /**
       * Cached inventory read. The cache is a coalescing promise with a short
       * TTL: entries still in `pending`/`loading` bypass it so a slow plugin
       * becomes visible once its fiber activates, and enable/disable through the
       * plugin manager is noticed within one TTL window.
       */
      let cache = null;
      const readEntries = function () {
        const entry = { promise: null, at: Date.now(), value: undefined };
        const promise = (async function () {
          const result = await ctx.remote.pluginInventory.list();
          if (!result.ok) throw new Error('pluginInventory.list failed: ' + result.error.code + ': ' + result.error.message);
          return Array.isArray(result.value?.entries) ? result.value.entries : [];
        })();
        entry.promise = promise;
        cache = entry;
        promise.then(function (value) { entry.value = value; }, function () {
          if (cache !== null && cache.promise === promise) cache = null;
        });
        return promise;
      };
      const entries = function () {
        if (cache === null) return readEntries();
        const known = cache.value;
        const transient = Array.isArray(known) && known.some(function (entry) {
          if (entry === undefined || entry === null || entry.enabled === false) return false;
          return entry.fiberPhase === 'pending' || entry.fiberPhase === 'loading';
        });
        if (!transient && Date.now() - cache.at < CACHE_TTL_MS) {
          return known === undefined ? cache.promise : Promise.resolve(known);
        }
        return readEntries();
      };
      const invalidate = function () {
        cache = null;
      };

      const text = function (value) {
        if (typeof value === 'string') return value;
        if (value === undefined || value === null) return '';
        try {
          return ctx.locale.resolveText(value) ?? '';
        } catch (error) {
          return '';
        }
      };

      /** One row per enabled, active, non-internal plugin. */
      const rowsOf = function (entries) {
        const rows = [];
        const seen = new Set();
        for (const entry of entries) {
          if (entry === undefined || entry === null) continue;
          const name = String(entry.moduleName ?? '');
          if (name === '' || INTERNAL.test(name) || seen.has(name)) continue;
          if (!isPackageName(name)) continue;
          if (entry.enabled === false) continue;
          if (entry.fiberPhase !== undefined && entry.fiberPhase !== null && entry.fiberPhase !== 'active') continue;
          seen.add(name);
          const meta = entry.meta ?? {};
          const title = text(meta.title);
          const description = text(meta.description);
          rows.push({
            name: name,
            ...title !== '' && title !== name ? { label: title } : {},
            ...description !== '' ? { description: description } : {},
          });
        }
        return rows;
      };

      ctx.effect(function () {
        const source = {
          trigger: '/',
          name: 'plugin',
          order: 1,
          warm: function () {
            entries().catch(function () {});
          },
          candidates: async function (session, request) {
            if (sessions.subagentAddress(session.sessionId) !== void 0) return [];
            const rows = rowsOf(await entries());
            if (request.signal.aborted) return [];
            const query = String(request.query ?? '').trim().toLowerCase();
            if (query === '') return rows;
            return rows.filter(function (row) {
              const haystack = (row.name + ' ' + (row.label ?? '') + ' ' + (row.description ?? '')).toLowerCase();
              return haystack.includes(query);
            });
          },
          onPick: function (pick) {
            return { text: t('pick.prefix', { name: pick.candidate.name }) };
          },
        };
        const unregister = inputTriggers.registerSource(source);
        const offChanged = ctx.remote.$on('plugin-manager/changed', invalidate);
        const offReset = ctx.on('connection/reset', invalidate);
        return function () {
          unregister();
          if (typeof offChanged === 'function') offChanged();
          else if (typeof ctx.remote.$off === 'function') ctx.remote.$off('plugin-manager/changed', invalidate);
          if (typeof offReset === 'function') offReset();
        };
      }, 'plugin-slash: source');
    }

    return { apply: apply, inject: inject };
  },
});
