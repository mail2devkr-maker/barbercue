#!/usr/bin/env node
/**
 * #212 real-application QA: starts a fresh headless Chrome against the caller's local
 * Next.js + NestJS + synthetic Owner seed. No production origin, cookies, or accounts.
 * Only captures synthetic shop screenshots and non-sensitive geometry.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const [credentialsFile, outputDir] = process.argv.slice(2);
if (!credentialsFile || !outputDir) throw new Error('Usage: node owner-navigation-browser-qa.mjs <synthetic-login.json> <output-directory>');
const { ownerEmail, password, salonId } = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
if (!ownerEmail.endsWith('@fastque-demo.test') || !salonId || !password) throw new Error('Refusing non-synthetic Owner login');
const base = 'http://127.0.0.1:3001';
const port = 19383;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fastque-owner-nav-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async (callback, label, retries = 90) => {
  let error;
  for (let i = 0; i < retries; i++) {
    try {
      const result = await callback();
      if (result) return result;
    } catch (err) { error = err; }
    await delay(300);
  }
  throw new Error('Timed out: ' + label + (error ? ' (' + error.message + ')' : ''));
};
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const chrome = spawn(chromePath, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile, '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' });

let ws;
const pending = new Map();
let nextId = 0;
const cmd = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await cmd('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser JavaScript failed');
  return result.result.value;
};
const navigate = async (pathname) => {
  await cmd('Page.navigate', { url: base + pathname });
  await wait(async () => evaluate('location.pathname') === pathname.split('?')[0], 'navigated to ' + pathname);
  await wait(async () => evaluate("!!document.querySelector('#owner-sidebar')"), 'Owner sidebar on ' + pathname);
  await delay(350);
};
const capture = async (filename) => {
  const image = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(outputDir, filename), Buffer.from(image.data, 'base64'));
};
const measure = async () => evaluate(`(() => {
  const side = document.querySelector('#owner-sidebar');
  const rail = document.querySelector('nav[aria-label="Sections"]');
  const main = document.querySelector('#owner-main');
  if (!side || !main || !rail) return null;
  const asRect = el => { const r=el.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, left:r.left, width:r.width, height:r.height }; };
  return {
    route: location.pathname, width:innerWidth, height:innerHeight, scrollY, scrollMax:document.documentElement.scrollHeight-innerHeight,
    documentOverflowX:document.documentElement.scrollWidth-innerWidth,
    side:asRect(side), rail:asRect(rail), main:asRect(main),
    sideComputed:{position:getComputedStyle(side).position, visibility:getComputedStyle(side).visibility, overflowY:getComputedStyle(side).overflowY},
    sideScrollHeight:side.scrollHeight, sideClientHeight:side.clientHeight,
    navItems:side.querySelectorAll('a').length, lastItem:(side.querySelector('li:last-child')?.innerText||'').trim().slice(0,50)
  };
})()`);
const metrics = [];
let count = 0;
try {
  const target = await wait(async () => {
    const r = await fetch('http://127.0.0.1:' + port + '/json/list');
    if (!r.ok) return null;
    return (await r.json()).find(t => t.type === 'page')?.webSocketDebuggerUrl;
  }, 'isolated Chrome DevTools');
  ws = new WebSocket(target);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  await cmd('Page.enable');
  await cmd('Runtime.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: base + '/owner/login' });
  await wait(async () => evaluate("!!document.querySelector('#workspace-email')"), 'Owner login form');
  await evaluate("document.querySelector('#workspace-email').focus()");
  await cmd('Input.insertText', { text: ownerEmail });
  await evaluate("document.querySelector('#workspace-password').focus()");
  await cmd('Input.insertText', { text: password });
  await evaluate("document.querySelector('button[type=submit]').click()");
  await wait(async () => (await evaluate('location.pathname')).startsWith('/dashboard/'), 'signed-in Owner workspace', 120);
  console.log('Authenticated to locally seeded Owner (redacted synthetic credentials).');

  const cases = [
    { width: 390, height: 900 }, { width: 768, height: 900 },
    { width: 1024, height: 600 }, { width: 1280, height: 600 },
    { width: 1440, height: 900 }, { width: 1740, height: 900 },
    { width: 1440, height: 600 },
  ];
  const routes = ['', '/staff', '/analytics', '/settings'];
  for (const { width, height } of cases) {
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    for (const route of routes) {
      await navigate('/dashboard/salons/' + salonId + route);
      const mobileDrawer = width <= 1180;
      if (mobileDrawer) {
        assert((await measure()).sideComputed.visibility === 'hidden', 'Tablet/mobile drawer unexpectedly visible while closed');
        await evaluate("document.querySelector('button[aria-label=\"Open navigation\"]').click()");
        await wait(async () => (await measure()).sideComputed.visibility === 'visible', 'drawer opened');
      }
      for (const portion of ['top', 'middle', 'bottom']) {
        await evaluate(`window.scrollTo(0, ${portion === 'top' ? 0 : portion === 'middle' ? 'document.documentElement.scrollHeight/2' : 'document.documentElement.scrollHeight'});`);
        await delay(100);
        const m = await measure();
        assert(m && m.navItems > 5, 'Owner navigation missing or empty');
        assert(m.documentOverflowX <= 2, 'Unexpected horizontal document overflow at width ' + width);
        assert(Math.abs(m.side.top) <= 2 && Math.abs(m.side.height - height) <= 2, 'Sidebar is not viewport anchored (' + width + '/' + height + '/' + portion + '): ' + JSON.stringify(m.side));
        if (width > 1180) {
          assert(m.sideComputed.position === 'fixed', 'Desktop navigation is not fixed');
          assert(Math.abs(m.side.left - 84) <= 2, 'Desktop sidebar left offset changed');
          assert(Math.abs(m.rail.top) <= 2 && Math.abs(m.rail.height - height) <= 2, 'Desktop icon rail was clipped');
          assert(m.main.left >= 350, 'Owner content overlaps the navigation');
        }
        metrics.push({ route, portion, ...m });
        count++;
      }
      const reach = await evaluate(`(() => {
        const side = document.querySelector('#owner-sidebar');
        side.scrollTop = side.scrollHeight;
        const links = [...side.querySelectorAll('a,button')].filter(e => e.getBoundingClientRect().height > 0);
        const last = links[links.length - 1];
        return { client:side.clientHeight, total:side.scrollHeight, lastBottom:last?.getBoundingClientRect().bottom, visible: !!last };
      })()`);
      assert(reach.visible && reach.lastBottom <= height + 3, 'Final navigation action inaccessible at width ' + width);
      if (route === '/staff' && (width === 390 || width === 1440 || width === 1740)) await capture('staff-' + width + '-' + height + '.png');
      if (mobileDrawer) {
        await evaluate("document.querySelector('#owner-sidebar a[aria-current=page]')?.focus()");
        await evaluate("document.querySelector('button[aria-label=\"Open navigation\"]').click()");
      }
    }
  }
  fs.writeFileSync(path.join(outputDir, 'geometry.json'), JSON.stringify({ cases: count, details: metrics }, null, 2));
  console.log('PASS: ' + count + ' real-app authenticated Chromium navigation snapshots across four routes and seven viewport profiles.');
} finally {
  if (ws) ws.close();
  chrome.kill('SIGTERM');
  await delay(500);
  fs.rmSync(profile, { recursive: true, force: true });
}
