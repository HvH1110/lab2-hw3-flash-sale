// Reproducible browser audit (Chrome DevTools Protocol).
// Usage: npm run build && npm run preview, start Chrome with --remote-debugging-port=9222, then:
//        node scripts/browser-audit.mjs 9222 http://localhost:4173/ <screenshot dir>
import { writeFileSync } from 'node:fs';

const [port, url, outDir] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') logs.push({ type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description).join(' ') });
  if (msg.method === 'Runtime.exceptionThrown') logs.push({ type: 'exception', text: msg.params.exceptionDetails.exception?.description });
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  const timer = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
  pending.set(i, (msg) => { clearTimeout(timer); resolve(msg); });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const step = (label) => process.stderr.write(`[audit] ${label}
`);
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const { result } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${outDir}/${name}.png`, Buffer.from(result.data, 'base64')); };

// Harness-only instrumentation: a naive setInterval countdown (the classic AI draft) for comparison,
// a commit counter fed by rAF-observed DOM mutations, and a long-task observer.
const instrument = `
  window.__naive = { remaining: null, started: 0 };
  window.__startNaive = (ms) => {
    window.__naive.remaining = ms;
    window.__naive.started = Date.now();
    setInterval(() => { window.__naive.remaining -= 10; }, 10); // "subtract 10 ms every 10 ms"
  };
  window.__longTasks = 0;
  new PerformanceObserver((list) => { window.__longTasks += list.getEntries().length; }).observe({ type: 'longtask', buffered: true });
`;
const parseCountdown = `(() => {
  const text = document.querySelector('#countdown').textContent;
  const [h, m, rest] = text.split(':');
  const [s, cs] = rest.split('.');
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(cs) * 10;
})()`;

await send('Runtime.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: instrument });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
for (let i = 0; i < 40 && !(await evaluate(`!!document.querySelector('#countdown')`)); i++) await sleep(150);

const report = {};
report.clockOffset = await evaluate(`document.querySelector('#stat-clock-offset-vs-server').textContent`);
await shot('hw3-upcoming');

// 1. Drift: displayed remaining + true now must stay constant (= the target), through jank and a frozen page.
step('drift');
await evaluate(`window.__startNaive(${parseCountdown})`);
const samples = [];
const sample = async (label) => {
  const [remaining, now, naive] = await evaluate(`[${parseCountdown}, Date.now(), window.__naive.remaining]`);
  samples.push({ label, impliedTarget: remaining + now, naiveImpliedTarget: naive + now });
};
await sample('start');
await sleep(1000); await sample('+1s');
await evaluate(`(() => { const end = performance.now() + 700; while (performance.now() < end) {} })()`); // 700 ms long task
await sleep(100); await sample('after 700 ms long task');
// A 3 s stall (no frames, no timer callbacks), like a throttled background tab or a frozen device.
// (Page.setWebLifecycleState 'frozen' would be closer, but headless Chrome stops producing frames after it.)
await evaluate(`(() => { const end = performance.now() + 3000; while (performance.now() < end) {} })()`);
await sleep(150); await sample('after 3 s main-thread stall');
await sleep(2000); await sample('+2s');
const base = samples[0].impliedTarget;
const naiveBase = samples[0].naiveImpliedTarget;
report.drift = samples.map((s) => ({ at: s.label, ourErrorMs: s.impliedTarget - base, naiveSetIntervalErrorMs: s.naiveImpliedTarget - naiveBase }));

step('render cost');
// 2. Render cost while the countdown runs at centisecond resolution.
const before = await evaluate(`({ t: performance.now(), long: window.__longTasks })`);
const fps = await evaluate(`new Promise((resolve) => { let n = 0; const start = performance.now(); const step = (t) => { n++; if (t - start < 2000) requestAnimationFrame(step); else resolve(Math.round(n * 1000 / (t - start))); }; requestAnimationFrame(step); })`);
report.pageFpsDuringCountdown = fps;
report.longTasksDuringCountdown = (await evaluate('window.__longTasks')) - before.long;

step('purchase flow');
// 3. Go live, reserve, watch the optimistic unit, pay.
await evaluate(`document.querySelector('#latency').value = 'congested'; document.querySelector('#latency').dispatchEvent(new Event('change', { bubbles: true }))`);
await evaluate(`document.querySelector('#start-now').click()`);
await sleep(300);
report.phaseAfterStart = await evaluate(`document.querySelector('#phase-label').textContent`);
const beforeReserve = await evaluate(`document.querySelector('#available-ao-dai').textContent`);
await evaluate(`document.querySelector('#reserve-ao-dai').click()`);
report.optimistic = { before: beforeReserve, immediatelyAfterClick: await evaluate(`document.querySelector('#available-ao-dai').textContent`), status: await evaluate(`document.querySelector('[aria-labelledby="name-ao-dai"]').dataset.status`) };
for (let i = 0; i < 40 && (await evaluate(`document.querySelector('[aria-labelledby="name-ao-dai"]').dataset.status`)) === 'RESERVING'; i++) await sleep(100);
report.afterServer = await evaluate(`({ status: document.querySelector('[aria-labelledby="name-ao-dai"]').dataset.status, hold: document.querySelector('.hold time')?.textContent })`);
await sleep(1500);
await shot('hw3-live-held');
await evaluate(`document.querySelector('#pay-ao-dai').click(); document.querySelector('#pay-ao-dai').click()`);
for (let i = 0; i < 40 && (await evaluate(`document.querySelector('[aria-labelledby="name-ao-dai"]').dataset.status`)) === 'CHECKING_OUT'; i++) await sleep(100);
report.order = await evaluate(`document.querySelector('.success')?.textContent ?? document.querySelector('[aria-labelledby="name-ao-dai"]').dataset.status`);

step('bots');
// 4. Let the competing shoppers run, then check nothing was oversold.
await sleep(8000);
report.bots = await evaluate(`({ shoppers: document.querySelector('#stat-competing-shoppers').textContent, purchases: document.querySelector('#stat-their-purchases').textContent })`);
report.soldLabels = await evaluate(`[...document.querySelectorAll('.card__meter-label')].map((l) => l.textContent)`);
report.oversold = await evaluate(`[...document.querySelectorAll('meter')].filter((m) => Number(m.value) > Number(m.max)).length`);
await shot('hw3-live-busy');

report.errors = logs.filter((l) => ['error', 'exception', 'assert'].includes(l.type)).map((l) => l.text);
report.parity = logs.filter((l) => l.text.startsWith('[commit')).map((l) => l.text).slice(-2);
console.log(JSON.stringify(report, null, 2));
ws.close();
