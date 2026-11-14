#!/usr/bin/env node
/**
 * Evaluate one JavaScript expression in the page of a running DeepSeek Harness
 * window over CDP, printing the JSON result.
 *
 * usage: node tools/cdp-eval.mjs <port> < expression.js
 *        echo "document.title" | node tools/cdp-eval.mjs 9223
 */
const port = process.argv[2] ?? '9223';

let source = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) source += chunk;
if (source.trim() === '') {
  console.error('cdp-eval: empty expression on stdin');
  process.exit(2);
}

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((item) => item.type === 'page');
if (page === undefined) {
  console.error('cdp-eval: no page target');
  process.exit(2);
}

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
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error('socket error')), { once: true });
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });

const answer = await send('Runtime.evaluate', {
  expression: source,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
});
socket.close();

if (answer.result?.exceptionDetails) {
  console.error('cdp-eval exception:', answer.result.exceptionDetails.exception?.description ?? answer.result.exceptionDetails.text);
  process.exit(1);
}
console.log(JSON.stringify(answer.result?.result?.value ?? null, null, 2));
