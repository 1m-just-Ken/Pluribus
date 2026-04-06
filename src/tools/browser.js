// ============================================================
// PLURIBUS — Browser Tool v2
// Playwright-powered. Now with auth session support.
// ============================================================

import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const COOKIE_DIR = join(process.cwd(), '.pluribus', 'cookies');

export class BrowserTool {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async launch() {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    // Load saved cookies if available
    await this._loadCookies();
    this.page = await this.context.newPage();
  }

  // ─── AUTH / COOKIES ─────────────────────────────────────

  async setCookies(cookies) {
    await this.launch();
    try {
      const parsed = typeof cookies === 'string' ? JSON.parse(cookies) : cookies;
      await this.context.addCookies(parsed);
      return { success: true, count: parsed.length };
    } catch (err) {
      return { success: false, error: `Invalid cookies: ${err.message}` };
    }
  }

  async saveCookies(domain) {
    await this.launch();
    const cookies = await this.context.cookies();
    const filtered = domain ? cookies.filter(c => c.domain.includes(domain)) : cookies;
    const { mkdirSync } = await import('fs');
    mkdirSync(COOKIE_DIR, { recursive: true });
    const file = join(COOKIE_DIR, `${(domain || 'all').replace(/\./g, '_')}.json`);
    writeFileSync(file, JSON.stringify(filtered, null, 2));
    return { success: true, saved: filtered.length, file };
  }

  async _loadCookies() {
    try {
      const { readdirSync } = await import('fs');
      const { mkdirSync } = await import('fs');
      mkdirSync(COOKIE_DIR, { recursive: true });
      const files = readdirSync(COOKIE_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const cookies = JSON.parse(readFileSync(join(COOKIE_DIR, file), 'utf-8'));
        if (cookies.length > 0) await this.context.addCookies(cookies);
      }
    } catch {}
  }

  // ─── NAVIGATION ─────────────────────────────────────────

  async navigate(url) {
    await this.launch();
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const title = await this.page.title();
      const currentUrl = this.page.url();
      const text = await this.extractText();
      return { success: true, url: currentUrl, title, text: text.slice(0, 8000) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async click(selector) {
    await this.launch();
    try {
      // Try exact selector first, then text-based
      let el = await this.page.$(selector).catch(() => null);
      if (!el) {
        el = await this.page.$(`text="${selector}"`).catch(() => null);
      }
      if (!el) {
        el = await this.page.$(`[aria-label="${selector}"]`).catch(() => null);
      }
      if (!el) return { success: false, error: `Element not found: "${selector}"` };

      await el.click({ timeout: 5000 });
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      return { success: true, clicked: selector };
    } catch (err) {
      return { success: false, error: `Click failed "${selector}": ${err.message}` };
    }
  }

  async type(selector, text) {
    await this.launch();
    try {
      let el = await this.page.$(selector).catch(() => null);
      if (!el) el = await this.page.$(`[placeholder*="${selector}" i]`).catch(() => null);
      if (!el) el = await this.page.$(`[name="${selector}"]`).catch(() => null);
      if (!el) el = await this.page.$(`[aria-label*="${selector}" i]`).catch(() => null);
      if (!el) return { success: false, error: `Input not found: "${selector}"` };

      await el.fill(text, { timeout: 5000 });
      return { success: true, selector, typed: text };
    } catch (err) {
      return { success: false, error: `Type failed "${selector}": ${err.message}` };
    }
  }

  async screenshot() {
    await this.launch();
    const buffer = await this.page.screenshot({ type: 'png', fullPage: false });
    return { success: true, base64: buffer.toString('base64'), size: buffer.length };
  }

  async extractText() {
    await this.launch();
    return this.page.evaluate(() => {
      const rm = ['script','style','noscript','iframe','svg'];
      rm.forEach(t => document.querySelectorAll(t).forEach(e => e.remove()));
      return document.body?.innerText?.replace(/\n{3,}/g, '\n\n').trim() || '';
    });
  }

  async extractLinks() {
    await this.launch();
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ text: a.innerText.trim().slice(0, 100), href: a.href }))
        .filter(l => l.text && l.href.startsWith('http'))
        .slice(0, 50)
    );
  }

  async search(query) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const nav = await this.navigate(url);
    if (!nav.success) return nav;

    const links = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll('div.g a')).map(a => {
        const title = a.querySelector('h3')?.innerText || '';
        const href = a.href;
        const snippet = a.closest('div.g')?.querySelector('[data-sncf]')?.innerText ||
                        a.closest('div.g')?.querySelector('.VwiC3b')?.innerText || '';
        return { title, href, snippet: snippet.slice(0, 200) };
      }).filter(l => l.title && l.href.startsWith('http')).slice(0, 10)
    );

    return { success: true, query, results: links };
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null; this.context = null; this.page = null;
    }
  }

  getToolDescriptions() {
    return [
      { name: 'browser_navigate', description: 'Open a URL and read the page', params: ['url'] },
      { name: 'browser_search', description: 'Google search', params: ['query'] },
      { name: 'browser_click', description: 'Click element (CSS selector or visible text)', params: ['selector'] },
      { name: 'browser_type', description: 'Type into form field', params: ['selector', 'text'] },
      { name: 'browser_screenshot', description: 'Screenshot current page', params: [] },
      { name: 'browser_extract_text', description: 'Get all visible page text', params: [] },
      { name: 'browser_extract_links', description: 'Get all page links', params: [] },
      { name: 'browser_set_cookies', description: 'Load auth cookies for a site', params: ['cookies'] },
      { name: 'browser_save_cookies', description: 'Save current cookies for reuse', params: ['domain'] },
    ];
  }

  async execute(toolName, args) {
    switch (toolName) {
      case 'browser_navigate': return this.navigate(args.url);
      case 'browser_search': return this.search(args.query);
      case 'browser_click': return this.click(args.selector);
      case 'browser_type': return this.type(args.selector, args.text);
      case 'browser_screenshot': return this.screenshot();
      case 'browser_extract_text': return { success: true, text: await this.extractText() };
      case 'browser_extract_links': return { success: true, links: await this.extractLinks() };
      case 'browser_set_cookies': return this.setCookies(args.cookies);
      case 'browser_save_cookies': return this.saveCookies(args.domain);
      default: return { success: false, error: `Unknown: ${toolName}` };
    }
  }
}
