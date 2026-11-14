#!/usr/bin/env node
/**
 * Verify the in-Session workspace manager against a live window:
 * open `/` → pick 管理工作区 → read the dialog → press 移除 on the first extra
 * root → read the dialog again. Prints both snapshots.
 *
 * usage: node tools/cdp-workspace-manager.mjs [port] [--remove]
 */
const port = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '9223';
const doRemove = process.argv.includes('--remove');

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((item) => item.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (entry === undefined) return;
  pending.delete(message.id);
  entry(message);
});
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  return answer.result?.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const focusComposer = `(() => {
  const el = document.querySelector('[data-composer-input]');
  if (!el) return false;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
})()`;

await evaluate(focusComposer);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await send('Input.insertText', { text: '/' });
await sleep(900);

const picked = await evaluate(`(() => {
  const option = [...document.querySelectorAll('button[role="option"]')]
    .find((node) => node.textContent.startsWith('管理工作区'));
  if (!option) return false;
  option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(700);

const readDialog = `(() => {
  const dialog = document.querySelector('[role=dialog]');
  if (!dialog) return { present: false };
  const rows = [...dialog.querySelectorAll('div')]
    .filter((node) => node.children.length === 2 && node.querySelectorAll('button').length === 2)
    .map((node) => ({ path: node.children[0]?.textContent, actions: [...node.querySelectorAll('button')].map((b) => b.textContent.trim()) }));
  return { present: true, label: dialog.getAttribute('aria-label'), text: dialog.innerText.replace(/\\n+/g, ' | '), rows };
})()`;

const before = await evaluate(readDialog);

let after = null;
if (doRemove) {
  const removed = await evaluate(`(() => {
    const dialog = document.querySelector('[role=dialog]');
    const button = dialog ? [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === '移除') : undefined;
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await sleep(2500);
  after = { removed, dialog: await evaluate(readDialog) };
}

console.log(JSON.stringify({ picked, before, after }, null, 1));
socket.close();
