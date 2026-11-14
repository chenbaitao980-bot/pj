#!/usr/bin/env node
/**
 * Drive one real model turn in the running window, asking the model to record a
 * three-step todo list, then poll for the todo dock. Used to verify the frozen
 * build's live task board end to end.
 *
 * usage: node tools/cdp-todo-turn.mjs [port]
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

// Clear the draft with real key events.
await evaluate(`(() => {
  const el = document.querySelector('[data-composer-input]');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
})()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });

const prompt = '请用 todo_write 创建一个三步任务清单（第一步写“检查构建产物”，第二步写“运行冒烟测试”，第三步写“汇总结果”），并把第一步标为 in_progress。只调用工具，不要做别的事。';
await send('Input.insertText', { text: prompt });
await sleep(400);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

for (let attempt = 0; attempt < 30; attempt += 1) {
  await sleep(2000);
  const state = await evaluate(`(() => {
    const panel = document.querySelector('[data-testid="todo-panel"]') ?? document.querySelector('section[aria-label="\u4efb\u52a1"]');
    if (!panel) return { present: false, tail: document.body.innerText.slice(-160).replace(/\\n+/g, ' | ') };
    const header = panel.querySelector('button');
    return {
      present: true,
      expanded: header?.getAttribute('aria-expanded') ?? null,
      text: panel.innerText.replace(/\\n+/g, ' | '),
      rows: [...panel.querySelectorAll('li')].map((row) => ({ status: row.getAttribute('data-status'), text: row.innerText.replace(/\\n+/g, ' ') })),
    };
  })()`);
  if (state?.present === true) {
    console.log(JSON.stringify(state, null, 1));
    socket.close();
    process.exit(0);
  }
  if (attempt === 29) {
    console.log(JSON.stringify({ timeout: true, state }, null, 1));
  }
}
socket.close();
process.exit(1);
