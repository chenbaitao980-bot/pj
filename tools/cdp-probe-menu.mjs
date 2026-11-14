#!/usr/bin/env node
/**
 * One-off CDP sequence: clear the composer with real key events, type "/", and
 * print the resulting menu groups and the row that opens the workspace manager.
 * Used to iterate on the ui-smoke selectors without rerunning the whole suite.
 *
 * usage: node tools/cdp-probe-menu.mjs [port]
 */
const port = process.argv[2] ?? '9223';

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

await evaluate(`(() => {
  const el = document.querySelector('[data-composer-input]');
  if (!el) return false;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
})()`);

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
await sleep(200);
console.log('after clear:', JSON.stringify(await evaluate(`document.querySelector('[data-composer-input]').innerText`)));

await send('Input.insertText', { text: '/' });
await sleep(900);

const menu = await evaluate(`(() => {
  const groups = [...document.querySelectorAll('[data-source]')].map((node) => ({ source: node.getAttribute('data-source'), title: node.textContent }));
  const rows = [...document.querySelectorAll('button[role="option"]')].map((node) => ({
    name: node.querySelector('span:nth-child(1)')?.textContent,
    text: node.textContent.slice(0, 60),
    id: node.id,
  }));
  return { groups, count: rows.length, workspace: rows.filter((row) => row.text.includes('工作区') || row.text.includes('orkspace')) };
})()`);
console.log(JSON.stringify(menu, null, 1).slice(0, 2000));
socket.close();
