#!/usr/bin/env node
/**
 * Drive a running DeepSeek Harness window over the Chrome DevTools Protocol and
 * report what the composer's `/` menu and the Session task board actually show.
 *
 * The desktop shell is Electron, so it exposes CDP only when started with
 * `--remote-debugging-port=<port>`; this script never launches anything.
 *
 * usage: node tools/ui-smoke.mjs [port] [--json]
 *
 * Checks:
 *   1. a Session composer is on screen;
 *   2. typing `/` opens the grouped menu and lists its group titles + rows;
 *   3. the "插件" group is present with at least one row;
 *   4. `工作区` opens the in-Session workspace manager dialog;
 *   5. the todo dock reports its expanded state and rows.
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */

const port = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '9223';
const asJson = process.argv.includes('--json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP list failed: ${response.status}`);
  return response.json();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let seq = 0;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const entry = pending.get(message.id);
      if (entry === undefined) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    socket.addEventListener('error', () => reject(new Error('CDP socket error')));
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = ++seq;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
        },
        close() { socket.close(); },
      });
    });
  });
}

const evaluate = async (cdp, expression) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluate failed');
  }
  return result.result.value;
};

const FOCUS_COMPOSER = `(() => {
  const el = document.querySelector('[data-composer-input]');
  if (el === null) return { ok: false, reason: 'composer not found' };
  el.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
  return { ok: true };
})()`;

const READ_MENU = `(() => {
  const titles = [...document.querySelectorAll('[data-source]')].map((node) => ({
    source: node.getAttribute('data-source'),
    title: node.textContent,
  }));
  const options = [...document.querySelectorAll('button[role="option"]')].map((node) => node.textContent);
  return { titles, options };
})()`;

const READ_TODO = `(() => {
  const panel = document.querySelector('[data-testid="todo-panel"]') ?? document.querySelector('section[aria-label="任务"]');
  if (panel === null) return { present: false };
  const header = panel.querySelector('button');
  return {
    present: true,
    expanded: header?.getAttribute('aria-expanded') ?? null,
    text: panel.textContent,
    rows: [...panel.querySelectorAll('li')].map((row) => ({ status: row.getAttribute('data-status'), text: row.textContent })),
  };
})()`;

const PICK_WORKSPACES = `(() => {
  const option = [...document.querySelectorAll('button[role="option"]')]
    .find((node) => node.textContent.startsWith('\\u7ba1\\u7406\\u5de5\\u4f5c\\u533a'));
  if (option === undefined) return { picked: false };
  option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  return { picked: true };
})()`;

const READ_DIALOG = `(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog === null) return { present: false };
  return { present: true, label: dialog.getAttribute('aria-label'), text: dialog.textContent.slice(0, 400) };
})()`;

const main = async () => {
  const list = await targets();
  const page = list.find((item) => item.type === 'page');
  if (page === undefined) throw new Error('no page target; is the window running with --remote-debugging-port?');
  const cdp = await connect(page.webSocketDebuggerUrl);
  const report = { url: page.url, checks: [] };
  const check = (name, ok, detail) => report.checks.push({ name, ok, detail });

  try {
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    const composer = await evaluate(cdp, `document.querySelector('[data-composer-input]') !== null`);
    check('composer present', composer === true, composer);

    const todo = await evaluate(cdp, READ_TODO);
    check('todo dock state', true, todo);

    const focused = await evaluate(cdp, FOCUS_COMPOSER);
    check('composer focus', focused?.ok === true, focused);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await sleep(200);
    await cdp.send('Input.insertText', { text: '/' });
    check('typed /', true, null);
    await sleep(2500);

    const menu = await evaluate(cdp, READ_MENU);
    const sources = (menu?.titles ?? []).map((row) => row.source);
    check('menu groups', sources.length > 0, { titles: menu?.titles ?? [], rows: (menu?.options ?? []).length });
    check('plugin group', sources.includes('plugin'), sources);
    const pluginRows = (menu?.options ?? []).filter((row) => row.includes('@local/') || row.includes('dsh-tool-websearch')).length;
    check('plugin rows rendered', pluginRows > 0, pluginRows);

    const picked = await evaluate(cdp, PICK_WORKSPACES);
    check('picked workspaces', picked?.picked === true, picked);
    await sleep(700);
    const dialog = await evaluate(cdp, READ_DIALOG);
    check('workspace manager dialog', dialog?.present === true, dialog);
    if (dialog?.present === true) {
      await evaluate(cdp, `(() => {
        const dialog = document.querySelector('[role=dialog]');
        const button = dialog ? [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '完成') : undefined;
        if (button) button.click();
        return true;
      })()`);
    }
  } finally {
    cdp.close();
  }

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else for (const row of report.checks) console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name}  ${typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail)}`);
  const failed = report.checks.filter((row) => !row.ok);
  process.exit(failed.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error('ui-smoke:', error instanceof Error ? error.message : String(error));
  process.exit(2);
});
