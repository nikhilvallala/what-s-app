const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const URL = 'http://localhost:5173';
const sfx = Date.now() % 100000;
const errors = [];
const ok = (m) => console.log('ok -', m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function register(browser, user, name) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1200, height: 800 });
  p.on('pageerror', (e) => errors.push(`${user}: ${e.message}`));
  p.on('response', (r) => r.status() >= 400 && errors.push(`${user} HTTP ${r.status()} ${r.url()}`));
  p.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`${user} console: ${m.text()}`));
  await p.goto(URL);
  await p.waitForSelector('.auth-card');
  await p.click('.switch a');
  await p.type('input[placeholder=Username]', user);
  await p.type('input[placeholder="Display name"]', name);
  await p.type('input[type=password]', 'secret1');
  await p.click('.auth-card button');
  await p.waitForSelector('.sidebar');
  return p;
}

const openChat = async (p, name) => {
  await p.evaluate((n) => [...document.querySelectorAll('.contacts li')].find((li) => li.querySelector('.name')?.textContent === n).click(), name);
  await p.waitForFunction((n) => document.querySelector('.chat-header .name')?.textContent === n, {}, name);
};
const waitText = (p, sel, txt) => p.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), { timeout: 8000 }, sel, txt);

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: 'new' });
  try {
    const A = `ua${sfx}`, B = `ub${sfx}`, C = `uc${sfx}`;
    const pa = await register(browser, A, `Ann${sfx}`);
    const pb = await register(browser, B, `Ben${sfx}`);
    const pc = await register(browser, C, `Cat${sfx}`);
    ok('register via UI x3');
    await pa.reload(); await pa.waitForSelector('.sidebar');
    await waitText(pa, '.contacts .name', `Ben${sfx}`);
    ok('session survives reload, contacts listed');

    // direct message
    await openChat(pa, `Ben${sfx}`);
    await pa.type('.composer input:not([type=file])', 'hello from ui');
    await pa.click('.composer button:last-child');
    await waitText(pb, '.contacts .preview', 'hello from ui');
    await waitText(pb, '.badge', '1');
    ok('DM received live with unread badge');
    await openChat(pb, `Ann${sfx}`);
    await waitText(pb, '.bubble.theirs', 'hello from ui');
    await pa.waitForFunction(() => document.querySelector('.bubble.mine .ticks')?.classList.contains('read'), { timeout: 8000 });
    ok('read ticks turn blue in sender UI');

    // typing
    await pb.type('.composer input:not([type=file])', 'x');
    await waitText(pa, '.chat-header .status', 'typing');
    ok('typing indicator in header');

    // image upload
    const img = path.join(__dirname, 'pic.png');
    fs.writeFileSync(img, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const input = await pa.$('.composer input[type=file]');
    await input.uploadFile(img);
    await pb.waitForSelector('.bubble.theirs img.att-img', { timeout: 10000 });
    const loaded = await pb.$eval('.bubble.theirs img.att-img', (i) => i.complete && i.naturalWidth > 0);
    if (!loaded) throw new Error('image did not render');
    ok('image upload renders inline for receiver');

    const txt = path.join(__dirname, 'doc.txt');
    fs.writeFileSync(txt, 'doc');
    await (await pa.$('.composer input[type=file]')).uploadFile(txt);
    await waitText(pb, '.att-file', 'doc.txt');
    ok('file attachment shows as download card');

    // group
    await pa.click('.side-header button[title="New group"]');
    await pa.type('.modal > input', `Grp${sfx}`);
    await pa.evaluate((n) => [...document.querySelectorAll('.member-list label')].filter((l) => l.textContent.includes(n[0]) || l.textContent.includes(n[1])).forEach((l) => l.querySelector('input').click()), [`Ben${sfx}`, `Cat${sfx}`]);
    await pa.click('.modal-actions button:last-child');
    await pa.waitForFunction((n) => document.querySelector('.chat-header .name')?.textContent === n, {}, `Grp${sfx}`);
    await waitText(pc, '.contacts .name', `Grp${sfx}`);
    ok('group created and appears live for member');
    await pa.type('.composer input:not([type=file])', 'hi group');
    await pa.click('.composer button:last-child');
    await waitText(pc, '.contacts .preview', 'hi group');
    await openChat(pc, `Grp${sfx}`);
    await waitText(pc, '.bubble.theirs .sender', `Ann${sfx}`);
    ok('group message shows sender name');
    await openChat(pb, `Grp${sfx}`);
    await pa.waitForFunction(() => [...document.querySelectorAll('.bubble.mine .ticks')].pop()?.classList.contains('read'), { timeout: 8000 });
    ok('group read receipt after all members read');

    // leave group
    pc.on('dialog', (d) => d.accept());
    await pc.click('.chat-header button.link:last-child');
    await pc.waitForFunction((n) => ![...document.querySelectorAll('.contacts .name')].some((e) => e.textContent === n), {}, `Grp${sfx}`);
    await pa.waitForFunction(() => !document.querySelector('.chat-header .status').textContent.includes('Cat'), { timeout: 8000 });
    ok('leave group updates both sides');

    // mobile layout
    await pb.setViewport({ width: 400, height: 800 });
    const sidebarHidden = await pb.$eval('.sidebar', (e) => getComputedStyle(e).display === 'none');
    await pb.click('.back');
    const sidebarShown = await pb.$eval('.sidebar', (e) => getComputedStyle(e).display !== 'none');
    if (!sidebarHidden || !sidebarShown) throw new Error('mobile layout broken');
    ok('mobile layout + back button');

    await pa.screenshot({ path: path.join(__dirname, 'shot.png') });
    if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
    console.log('UI ALL PASSED');
  } catch (e) {
    console.error('FAIL:', e.message, '\nerrors:', errors.join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
