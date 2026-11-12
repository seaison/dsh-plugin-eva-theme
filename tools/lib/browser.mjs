/** Isolated Chrome DevTools pipe; never attaches to the user's DSH browser. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function launchBrowser() {
 const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
 if (!chrome) throw new Error('Chrome / Chromium is required (or set CHROME_PATH).');
 const profile = mkdtempSync(join(tmpdir(), 'eva-browser-'));
 const args = ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--hide-scrollbars', '--remote-debugging-pipe', '--user-data-dir=' + profile];
 // The hosted Linux VM isolates these local fixture pages from the user's browser and files.
 if (process.platform === 'linux' && process.env.RUNNER_ENVIRONMENT === 'github-hosted') args.push('--no-sandbox', '--disable-dev-shm-usage');
 const child = spawn(chrome, args, {stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']});
 let nextId = 0, buffer = '', diagnostics = '', failure = null;
 const pending = new Map();
 const withDiagnostics = message => new Error(diagnostics.trim() ? `${message}\n${diagnostics.trim()}` : message);
 const fail = error => {
  failure ??= withDiagnostics(error.message);
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(failure); }
  pending.clear();
 };
 child.stderr.setEncoding('utf8');
 child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4096); });
 child.on('error', fail); child.on('exit', (code, signal) => fail(new Error(`Chrome exited (${signal || code})`)));
 child.stdio[3].on('error', fail); child.stdio[4].on('error', fail);
 child.stdio[4].setEncoding('utf8');
 child.stdio[4].on('data', chunk => {
  buffer += chunk; let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
   const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!raw) continue;
   const data = JSON.parse(raw), entry = pending.get(data.id); if (!entry) continue;
   pending.delete(data.id); clearTimeout(entry.timer);
   if (data.error) entry.reject(new Error(JSON.stringify(data.error))); else entry.resolve(data.result);
  }
 });
 const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  if (failure) { reject(failure); return; }
  const id = ++nextId, timer = setTimeout(() => {pending.delete(id); reject(withDiagnostics(method + ' timed out'));}, 15000);
  pending.set(id, {resolve, reject, timer}); child.stdio[3].write(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}) + '\0');
 });
 return {
  send,
  async page(width = 1280, height = 800) {
   const {targetId} = await send('Target.createTarget', {url:'about:blank'});
   const {sessionId} = await send('Target.attachToTarget', {targetId, flatten:true});
   const command = (method, params) => send(method, params, sessionId);
   await command('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:false}); await command('Page.enable');
   return {command, async evaluate(expression, awaitPromise = false) {
    const {result, exceptionDetails} = await command('Runtime.evaluate', {expression, returnByValue:true, awaitPromise});
    if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails)); return result.value;
   }, close: () => send('Target.closeTarget', {targetId})};
  },
  async close() { try {await send('Browser.close');} catch {} child.kill(); await wait(200); rmSync(profile, {recursive:true, force:true}); }
 };
}
