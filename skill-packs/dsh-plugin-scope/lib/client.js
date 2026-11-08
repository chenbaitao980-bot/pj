window.__ModuleLoader__.load({
	id: "dsh-plugin-scope",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const react = require("react");
		const h = react.createElement;

		/**
		 * 本地面板地址（由宿主启动时自动拉起，或手动跑 tools\plugin-scope-ui.cmd）。
		 *
		 * 为什么不再用 iframe：DSH 渲染页有 CSP，跨端口的内嵌框架/跨源 fetch 会被拦，
		 * 表现为"Tab 一片黑"。改成在浏览器里打开本地面板，界面完整、刷新/缩放都正常。
		 */
		const PANEL_URL = "http://127.0.0.1:8799/";
		const USAGE_URL = "http://127.0.0.1:8799/usage?range=30d";

		const T = {
			card: {
				border: "1px solid #E5E7EB",
				borderRadius: 14,
				background: "#FFFFFF",
				padding: "20px 22px",
				boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 8px 24px rgba(16,24,40,.04)",
				maxWidth: 720,
			},
			title: { fontSize: 16, fontWeight: 650, color: "#111827", letterSpacing: ".2px" },
			desc: { fontSize: 12.5, color: "#6B7280", marginTop: 6, lineHeight: 1.65 },
			row: {
				display: "flex",
				alignItems: "center",
				gap: 14,
				border: "1px solid #EEF0F4",
				borderRadius: 12,
				padding: "14px 16px",
				marginTop: 14,
				background: "#FCFCFD",
			},
			icon: {
				width: 36,
				height: 36,
				borderRadius: 10,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontSize: 17,
				flex: "0 0 auto",
				background: "#EEF3FF",
				color: "#3B63D6",
			},
			rowTitle: { fontSize: 13.5, fontWeight: 600, color: "#111827" },
			rowDesc: { fontSize: 12, color: "#8A93A6", marginTop: 2 },
			grow: { flex: "1 1 auto", minWidth: 0 },
			btn: {
				flex: "0 0 auto",
				border: "1px solid #D8DEF0",
				background: "#FFFFFF",
				color: "#2F4FBF",
				borderRadius: 9,
				padding: "7px 13px",
				fontSize: 12.5,
				fontWeight: 600,
				cursor: "pointer",
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
			},
			btnPrimary: {
				flex: "0 0 auto",
				border: "1px solid #4F7CFF",
				background: "#4F7CFF",
				color: "#FFFFFF",
				borderRadius: 9,
				padding: "7px 13px",
				fontSize: 12.5,
				fontWeight: 600,
				cursor: "pointer",
			},
			foot: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 16,
				paddingTop: 14,
				borderTop: "1px dashed #E9ECF2",
				fontSize: 12,
				color: "#8A93A6",
				flexWrap: "wrap",
			},
			code: {
				fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
				fontSize: 11.5,
				background: "#F4F6FA",
				border: "1px solid #E9ECF2",
				borderRadius: 7,
				padding: "3px 8px",
				color: "#475569",
			},
			toast: { fontSize: 11.5, color: "#16A34A", marginLeft: 2 },
		};

		function copyText(text) {
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text);
					return true;
				}
			} catch { /* ignore */ }
			try {
				const area = document.createElement("textarea");
				area.value = text;
				area.style.position = "fixed";
				area.style.opacity = "0";
				document.body.appendChild(area);
				area.select();
				document.execCommand("copy");
				document.body.removeChild(area);
				return true;
			} catch { return false; }
		}

		function openExternal(url) {
			try {
				const win = window.open(url, "_blank", "noopener,noreferrer");
				if (win) return true;
			} catch { /* ignore */ }
			return false;
		}

		/** 一行「图标 + 标题 + 说明 + 按钮」，两个 Tab 复用。 */
		function ActionRow(props) {
			const [hint, setHint] = react.useState("");
			const onClick = () => {
				if (openExternal(props.url)) return;
				setHint(copyText(props.url) ? "已复制地址，粘贴到浏览器打开" : "");
			};
			return h(
				"div",
				{ style: T.row },
				h("div", { style: T.icon }, props.glyph),
				h(
					"div",
					{ style: T.grow },
					h("div", { style: T.rowTitle }, props.title),
					h("div", { style: T.rowDesc }, props.desc),
				),
				hint ? h("span", { style: T.toast }, hint) : null,
				h("button", { type: "button", style: props.primary ? T.btnPrimary : T.btn, onClick }, props.action || "在浏览器打开 ↗"),
			);
		}

		function AddressFoot() {
			const [copied, setCopied] = react.useState(false);
			return h(
				"div",
				{ style: T.foot },
				h("span", null, "面板地址"),
				h("span", { style: T.code }, "127.0.0.1:8799"),
				h(
					"button",
					{
						type: "button",
						style: { ...T.btn, padding: "4px 9px", fontSize: 11.5 },
						onClick: () => { if (copyText(PANEL_URL)) { setCopied(true); setTimeout(() => setCopied(false), 1600); } },
					},
					copied ? "已复制" : "复制",
				),
				h("span", { style: { marginLeft: "auto" } }, "打不开？双击 <安装目录>\\tools\\plugin-scope-ui.cmd"),
			);
		}

		/** 插件页 →「按工作区」 */
		function ScopePanel() {
			return h(
				"div",
				{ style: { padding: "4px 2px" } },
				h(
					"div",
					{ style: T.card },
					h("div", { style: T.title }, "按工作区开关插件"),
					h("div", { style: T.desc }, "每个工作区一份配置，写在 <工作区>\\.dsh\\plugins.json；与插件运行时读的是同一份数据。全局总开关仍在插件页。"),
					h(ActionRow, {
						glyph: "\u2699",
						title: "工作区插件开关",
						desc: "已安装插件 × 所有工作区，支持搜索、三态切换（开 / 关 / 继承）",
						url: PANEL_URL,
						primary: true,
					}),
					h(ActionRow, {
						glyph: "\u2014",
						title: "Token 用量",
						desc: "按厂商 / 工作区 / 时间范围统计，含柱状图与占比",
						url: USAGE_URL,
					}),
					h(AddressFoot),
				),
			);
		}

		/** 插件页 →「Token 用量」 */
		function UsagePanel() {
			return h(
				"div",
				{ style: { padding: "4px 2px" } },
				h(
					"div",
					{ style: T.card },
					h("div", { style: T.title }, "Token 用量统计"),
					h("div", { style: T.desc }, "数据来自本机会话投影缓存，按题述范围聚合：未缓存输入 / 输出 / 缓存命中分开统计，可按厂商与工作区拆开看。"),
					h(ActionRow, {
						glyph: "\u25A4",
						title: "完整报表（30 天）",
						desc: "柱状趋势 + 厂商占比 + 工作区占比 + 模型明细",
						url: USAGE_URL,
						primary: true,
					}),
					h(ActionRow, {
						glyph: "\u221E",
						title: "全部历史",
						desc: "从第一条会话开始累计",
						url: "http://127.0.0.1:8799/usage?range=all",
					}),
					h(AddressFoot),
				),
			);
		}

		/** 设置 → 模型 页底部：紧凑一条 */
		function UsageFooter() {
			return h(
				"div",
				{ style: { ...T.card, padding: "14px 16px", maxWidth: "none" } },
				h(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: 12 } },
					h("div", { style: { ...T.icon, width: 30, height: 30, fontSize: 15 } }, "\u25A4"),
					h(
						"div",
						{ style: T.grow },
						h("div", { style: T.rowTitle }, "Token 用量"),
						h("div", { style: T.rowDesc }, "按厂商 / 工作区 / 时间范围统计，在浏览器里查看图表"),
					),
					h(
						"button",
						{
							type: "button",
							style: T.btnPrimary,
							onClick: () => { if (!openExternal(USAGE_URL)) copyText(USAGE_URL); },
						},
						"打开统计 ↗",
					),
					h(
						"button",
						{
							type: "button",
							style: T.btn,
							onClick: () => { if (!openExternal(PANEL_URL)) copyText(PANEL_URL); },
						},
						"工作区开关",
					),
				),
			);
		}

		const inject = ["slots"];

		function apply(ctx) {
			ctx.inject(["slots"], (scope) => {
				scope.slots.inject("plugins.tab", () =>
					scope.slots.register(
						{ name: "plugins.tab", id: "workspace-scope", order: 50, label: () => "按工作区" },
						ScopePanel,
					),
				);
				scope.slots.inject("plugins.tab", () =>
					scope.slots.register(
						{ name: "plugins.tab", id: "token-usage", order: 51, label: () => "Token 用量" },
						UsagePanel,
					),
				);
				// 设置 → 模型 页底部
				scope.slots.inject("settings.models.footer", () =>
					scope.slots.register(
						{ name: "settings.models.footer", id: "token-usage-footer", order: 50 },
						UsageFooter,
					),
				);
			});
		}

		exports.ScopePanel = ScopePanel;
		exports.UsagePanel = UsagePanel;
		exports.UsageFooter = UsageFooter;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
