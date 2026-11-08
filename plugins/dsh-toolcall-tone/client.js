/**
 * Client half of `@local/dsh-toolcall-tone`.
 *
 * Every tool call in the transcript renders through the Tool card whose root
 * element carries `data-tool="<wire tool name>"`. MCP servers register their
 * tools as `mcp__<server>__<name>`, and plugin-provided tools keep their own
 * prefix, so a scoped stylesheet can tint exactly those rows while ordinary
 * command execution (bash / pwsh terminal cards) keeps the shipped look.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-toolcall-tone',
  factory() {
    const STYLE_ID = '@local/dsh-toolcall-tone/highlight.css';

    /**
     * Classification rules. Each group paints one accent.
     * `prefixes` matches `data-tool` by prefix, `names` matches it exactly.
     * Edit these lists to retune what counts as MCP, plugin, or neither.
     */
    const GROUPS = [
      {
        id: 'mcp',
        accent: '#7c5cff',
        prefixes: ['mcp__'],
        names: [],
      },
      {
        id: 'plugin',
        accent: '#e0912f',
        prefixes: ['artex_', 'purge_', 'dsh_', 'plugin_', 'hookify_', 'tabbit_'],
        names: [],
      },
    ];

    /** Build the selector list for one group. */
    function selectorsOf(group) {
      const fromPrefixes = group.prefixes.map(function (prefix) {
        return '[data-tool^="' + prefix + '"]';
      });
      const fromNames = group.names.map(function (name) {
        return '[data-tool="' + name + '"]';
      });
      return fromPrefixes.concat(fromNames);
    }

    /** Compose the whole stylesheet at call time so the rule lists stay the single source of truth. */
    function buildCss() {
      const blocks = [];
      GROUPS.forEach(function (group) {
        const selectors = selectorsOf(group);
        if (selectors.length === 0) return;
        const hovered = selectors.map(function (one) {
          return one + ':hover';
        });
        blocks.push(
          selectors.join(',\n') + ' {\n' +
          '  --toolcall-tone-accent: ' + group.accent + ';\n' +
          '  border-radius: 8px;\n' +
          '  padding: 2px 8px 2px 10px;\n' +
          '  background: color-mix(in srgb, var(--toolcall-tone-accent) 9%, transparent);\n' +
          '  box-shadow: inset 2px 0 0 0 var(--toolcall-tone-accent);\n' +
          '  transition: background 120ms ease;\n' +
          '}\n' +
          hovered.join(',\n') + ' {\n' +
          '  background: color-mix(in srgb, var(--toolcall-tone-accent) 15%, transparent);\n' +
          '}\n',
        );
      });
      return blocks.join('\n');
    }

    /** Mount the stylesheet once; disposal removes it with the plugin fiber. */
    function apply(ctx) {
      ctx.effect(function () {
        const mounted = document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']');
        if (mounted !== null) return function () {};
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/dsh-toolcall-tone';
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = buildCss();
        document.head.appendChild(tag);
        return function () {
          tag.remove();
        };
      });
    }

    return { apply: apply };
  },
});
