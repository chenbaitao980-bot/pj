#!/usr/bin/env node
/**
 * Frozen-build patch: desktop attention popup.
 *
 * A question, an approval request or a plan review that starts waiting while
 * the window is hidden, minimised or behind another application currently has
 * no way to reach the user: the composer card only exists inside the Session.
 *
 * This patch adds a narrow bridge:
 *
 *   preload  `dshDesktop.attention.notify(request)` → `dsh-desktop:attention-notify`
 *            `dshDesktop.attention.onOpen(listener)` ← `dsh-desktop:attention-open`
 *   main     shows a small always-on-top notice at the bottom-right of the
 *            screen when the main window is not in front (Windows Toast would
 *            need a ToastActivator registration this installer does not make).
 *            "查看会话" restores/focuses the window and sends the Session id
 *            back so the client opens it; "稍后" dismisses; focusing the main
 *            window dismisses it too, and it expires after 60s.
 *
 * `@local/dsh-session-tracker`'s client half calls the bridge.
 *
 * Idempotent: both files carry a marker and are skipped when present.
 *
 * usage: node patch-desktop-attention.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:desktop-attention*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-desktop-attention.js <payloadRoot> [--dry]');
  process.exit(2);
}

const libRoot = path.join(payloadRoot, 'resources', 'app', 'lib');
const preloadFile = path.join(libRoot, 'preload-app.cjs');
const mainFile = path.join(libRoot, 'main.js');

for (const file of [preloadFile, mainFile]) {
  if (!fs.existsSync(file)) {
    console.error(`MISSING  ${file}`);
    process.exit(1);
  }
}

/** ---------------- preload-app.cjs ---------------- */
const preloadOriginal = fs.readFileSync(preloadFile, 'utf8');

const FIND_CHANNELS = `\twindowsMenu: "dsh-desktop:windows-menu"\n};`;
const REPLACE_CHANNELS = `\twindowsMenu: "dsh-desktop:windows-menu",\n\t${MARK}\n\tattentionNotify: "dsh-desktop:attention-notify",\n\tattentionOpen: "dsh-desktop:attention-open"\n};`;

const FIND_API = `function createProductApi() {\n\treturn {\n\t\tprotocolVersion: 1,`;
const REPLACE_API = `function createProductApi() {\n\treturn {\n\t\t${MARK}\n\t\t// Small always-on-top notice for a Session waiting on the user; the click reopens it.\n\t\tattention: {\n\t\t\tnotify: (request) => electron.ipcRenderer.invoke(DESKTOP_IPC.attentionNotify, request),\n\t\t\tonOpen: (listener) => {\n\t\t\t\tconst handle = (_event, request) => {\n\t\t\t\t\tlistener(request);\n\t\t\t\t};\n\t\t\t\telectron.ipcRenderer.on(DESKTOP_IPC.attentionOpen, handle);\n\t\t\t\treturn () => {\n\t\t\t\t\telectron.ipcRenderer.off(DESKTOP_IPC.attentionOpen, handle);\n\t\t\t\t};\n\t\t\t}\n\t\t},\n\t\tprotocolVersion: 1,`;

let preloadNext = preloadOriginal;
if (!preloadOriginal.includes(MARK)) {
  for (const [label, find] of [
    ['preload channels', FIND_CHANNELS],
    ['preload product API', FIND_API],
  ]) {
    const hits = preloadOriginal.split(find).length - 1;
    if (hits !== 1) {
      console.error(`FAIL     ${label} anchor matched ${hits} time(s)`);
      process.exit(1);
    }
  }
  preloadNext = preloadOriginal.replace(FIND_CHANNELS, REPLACE_CHANNELS).replace(FIND_API, REPLACE_API);
  if (preloadNext === preloadOriginal) {
    console.error('FAIL     preload patch produced no change');
    process.exit(1);
  }
}

/** ---------------- main.js ---------------- */
const mainOriginal = fs.readFileSync(mainFile, 'utf8');

/** `screen` is needed to place the notice on the window's display. */
const FIND_IMPORT = `powerMonitor, protocol, session, shell`;
const REPLACE_IMPORT = `powerMonitor, protocol, screen, session, shell`;

const FIND_HANDLER = `\tipcMain.handle(DESKTOP_IPC.deviceInfo, (event) => {`;

const HANDLER = String.raw`	/*dsh:desktop-attention*/
	// A Session that starts waiting on the user reaches them even while this
	// window is hidden, minimised or behind another app. Windows Toasts need a
	// ToastActivator registration this installer does not make, so the notice is
	// a small always-on-top window of our own; its buttons reopen the Session.
	const attentionLabels = () => locale.id.startsWith('zh') ? {
		question: '等待回答',
		approval: '等待审批',
		'plan-review': '计划待审',
		open: '查看会话',
		dismiss: '稍后',
		body: '回到该会话继续处理。',
		untitled: '未命名会话'
	} : {
		question: 'Waiting for an answer',
		approval: 'Waiting for approval',
		'plan-review': 'Plan awaiting review',
		open: 'Open session',
		dismiss: 'Later',
		body: 'Return to this session to continue.',
		untitled: 'Untitled session'
	};
	const escapeAttention = (value) => String(value).replace(/[&<>"']/g, (character) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	})[character]);
	let attentionWindow;
	let attentionRequest;
	let attentionTimer;
	const closeAttention = () => {
		if (attentionTimer !== void 0) {
			clearTimeout(attentionTimer);
			attentionTimer = void 0;
		}
		const window = attentionWindow;
		attentionWindow = void 0;
		attentionRequest = void 0;
		if (window !== void 0 && !window.isDestroyed()) window.close();
	};
	const attentionDocument = (request) => {
		const labels = attentionLabels();
		const dark = nativeTheme.shouldUseDarkColors;
		const background = dark ? '#1f2023' : '#ffffff';
		const foreground = dark ? '#f2f3f5' : '#1f2329';
		const secondary = dark ? '#a9adb5' : '#6b7280';
		const border = dark ? '#3a3c42' : '#e5e7eb';
		const accent = '#4f7cff';
		const kind = labels[request.kind] || labels.question;
		const title = request.session !== '' ? request.session : labels.untitled;
		const body = request.body !== '' ? request.body : labels.body;
		return '<!doctype html><html><head><meta charset="utf-8"><style>' +
			'html,body{margin:0;height:100%;overflow:hidden;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:' + background + ';color:' + foreground + ';user-select:none}' +
			'.card{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:3px;padding:12px 14px;border:1px solid ' + border + '}' +
			'.kind{font-size:10px;line-height:14px;letter-spacing:.08em;color:' + accent + '}' +
			'.title{font-size:13px;font-weight:600;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
			'.body{font-size:12px;line-height:17px;color:' + secondary + ';overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
			'.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:auto}' +
			'a{font-size:12px;line-height:20px;padding:2px 12px;border-radius:6px;text-decoration:none;cursor:pointer}' +
			'.primary{background:' + accent + ';color:#ffffff}' +
			'.ghost{color:' + secondary + ';border:1px solid ' + border + '}' +
			'</style></head><body><div class="card">' +
			'<div class="kind">' + escapeAttention(kind) + '</div>' +
			'<div class="title">' + escapeAttention(title) + '</div>' +
			'<div class="body">' + escapeAttention(body) + '</div>' +
			'<div class="actions"><a class="ghost" href="dsh-attention://dismiss">' + escapeAttention(labels.dismiss) + '</a><a class="primary" href="dsh-attention://open">' + escapeAttention(labels.open) + '</a></div>' +
			'</div></body></html>';
	};
	const showAttention = (request) => {
		const owner = mainWindow;
		if (owner === void 0 || owner.isDestroyed()) return false;
		if (owner.isVisible() && !owner.isMinimized() && owner.isFocused()) {
			closeAttention();
			return false;
		}
		attentionRequest = request;
		let popup = attentionWindow;
		if (popup === void 0 || popup.isDestroyed()) {
			popup = new BrowserWindow({
				width: 360,
				height: 148,
				frame: false,
				show: false,
				resizable: false,
				minimizable: false,
				maximizable: false,
				fullscreenable: false,
				skipTaskbar: true,
				alwaysOnTop: true,
				backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f2023' : '#ffffff',
				webPreferences: {
					sandbox: true,
					contextIsolation: true,
					nodeIntegration: false,
					devTools: false
				}
			});
			popup.setAlwaysOnTop(true, 'screen-saver');
			popup.on('closed', () => {
				if (attentionTimer !== void 0) {
					clearTimeout(attentionTimer);
					attentionTimer = void 0;
				}
				if (attentionWindow === popup) {
					attentionWindow = void 0;
					attentionRequest = void 0;
				}
				if (!owner.isDestroyed()) owner.removeListener('focus', closeAttention);
			});
			popup.webContents.on('will-navigate', (event, url) => {
				if (!url.startsWith('dsh-attention:')) return;
				event.preventDefault();
				const action = url.slice('dsh-attention:'.length).replace(/^\/\//, '').split(/[?#]/)[0];
				const target = attentionRequest;
				if (action === 'open' && target !== void 0) {
					const window = mainWindow;
					if (window !== void 0 && !window.isDestroyed()) {
						if (window.isMinimized()) window.restore();
						window.show();
						window.focus();
						if (target.sessionId !== '') window.webContents.send('dsh-desktop:attention-open', { sessionId: target.sessionId });
					}
				}
				closeAttention();
			});
			owner.on('focus', closeAttention);
			attentionWindow = popup;
		}
		const display = screen.getDisplayMatching(owner.getBounds());
		const area = display.workArea;
		popup.setBounds({
			x: area.x + area.width - 376,
			y: area.y + area.height - 164,
			width: 360,
			height: 148
		});
		popup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(attentionDocument(request))).then(() => {
			if (attentionWindow === popup && !popup.isDestroyed()) popup.showInactive();
		}).catch((error) => {
			console.warn('desktop attention: notice load failed', error);
		});
		if (attentionTimer !== void 0) clearTimeout(attentionTimer);
		attentionTimer = setTimeout(() => {
			attentionTimer = void 0;
			closeAttention();
		}, 60000);
		return true;
	};
	ipcMain.handle('dsh-desktop:attention-notify', (event, request) => {
		assertProductSender(event);
		if (request === null || typeof request !== 'object' || Array.isArray(request)) return false;
		const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
		return showAttention({
			sessionId: text(request.sessionId, 200),
			kind: request.kind === 'approval' || request.kind === 'plan-review' ? request.kind : 'question',
			session: text(request.session, 120),
			body: text(request.body, 240)
		});
	});
${FIND_HANDLER}`;

let mainNext = mainOriginal;
if (!mainOriginal.includes(MARK)) {
  for (const [label, find] of [
    ['main import', FIND_IMPORT],
    ['main handler', FIND_HANDLER],
  ]) {
    const hits = mainOriginal.split(find).length - 1;
    if (hits !== 1) {
      console.error(`FAIL     ${label} anchor matched ${hits} time(s)`);
      process.exit(1);
    }
  }
  mainNext = mainOriginal.replace(FIND_IMPORT, REPLACE_IMPORT).replace(FIND_HANDLER, HANDLER);
  if (mainNext === mainOriginal) {
    console.error('FAIL     main patch produced no change');
    process.exit(1);
  }
}

if (dry) {
  console.log('dry      would patch preload-app.cjs and main.js');
  process.exit(0);
}

fs.writeFileSync(preloadFile, preloadNext, 'utf8');
fs.writeFileSync(mainFile, mainNext, 'utf8');
console.log(preloadNext === preloadOriginal ? 'skip     preload-app.cjs (already applied)' : 'patched  resources/app/lib/preload-app.cjs');
console.log(mainNext === mainOriginal ? 'skip     main.js (already applied)' : 'patched  resources/app/lib/main.js');
