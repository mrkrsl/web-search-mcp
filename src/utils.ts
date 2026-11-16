import {
  existsSync,
} from 'node:fs';

/**
 * Utility functions for the web search MCP server
 */

export function cleanText(text: string, maxLength: number = 10000): string {
  return text
    .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
    .replace(/\n\s*\n/g, '\n') // Replace multiple newlines with single newline
    .trim()
    .substring(0, maxLength);
}

export function getWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

export function getContentPreview(text: string, maxLength: number = 500): string {
  const cleaned = cleanText(text, maxLength);
  return cleaned.length === maxLength ? cleaned + '...' : cleaned;
}

export function generateTimestamp(): string {
  return new Date().toISOString();
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeQuery(query: string): string {
  return query.trim().substring(0, 1000); // Limit query length
}

export function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Playwright ships a separate "chromium headless shell", and search engines detect it quickly
 * (HeadlessChrome UA, no real plugins/widevine, driver-typical viewport). The Google Chrome
 * installed on the machine passes those checks - Bing, Brave and DuckDuckGo all answer normally
 * through it while they wall the bundled shell from the very same IP.
 *
 * BROWSER_CHANNEL: 'auto' (default, use installed Chrome when found) | 'chrome' | 'msedge' |
 * 'chromium' | 'off' / 'bundled' (force Playwright's own build) | an absolute executable path
 */
export function getChromiumLaunchOptions(): { channel?: string; executablePath?: string } {
  const setting = (process.env.BROWSER_CHANNEL || 'auto').trim().toLowerCase();

  if (setting === 'off' || setting === 'bundled' || setting === 'chromium' || setting === 'none') {
    return {};
  }

  if (setting !== 'auto') {
    return setting.includes('/') ? { executablePath: setting } : { channel: setting };
  }

  const chromePaths = [
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/lib/chromium/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];

  if (chromePaths.some((candidate) => existsSync(candidate))) {
    return { channel: 'chrome' };
  }

  return {};
}

/**
 * Extra Chromium/Firefox command-line arguments, space separated.
 *
 * Motivation: on some networks middleboxes reset TLS sessions whose ClientHello carries an
 * Encrypted Client Hello extension, and they also cap large Cloudflare responses (observed on
 * Russian TSPU since June 2025). Chromium only sends ECH when secure DNS is in use, so the
 * workaround is opt-in rather than always on:
 *   "BROWSER_EXTRA_ARGS": "--disable-features=EncryptedClientHello"
 * For Playwright's Firefox use FIREFOX_DISABLE_DOH=true (Firefox enables DoH+ECH by default).
 */
export function getExtraBrowserArgs(): string[] {
  const args = (process.env.BROWSER_EXTRA_ARGS || '').split(/\s+/).map((arg) => arg.trim()).filter(Boolean);

  // Chrome keeps a single --disable-features switch (the last occurrence replaces Playwright's own
  // list), so passing one here silently drops Playwright's defaults. Warn instead of pretending it
  // merged cleanly - for Firefox use FIREFOX_DISABLE_DOH, which needs no switch at all.
  if (args.some((arg) => arg.startsWith('--disable-features'))) {
    console.log(`[web-search-mcp] BROWSER_EXTRA_ARGS contains --disable-features: this replaces Playwright's own feature list rather than extending it`);
  }

  return args;
}

/**
 * Firefox preferences for hostile networks. `network.trr.mode=5` disables DoH, which in turn
 * stops Firefox from negotiating ECH, and the explicit ECH switch covers builds where the
 * default changed.
 */
export function getFirefoxUserPrefs(): Record<string, string | number | boolean> | undefined {
  if (process.env.FIREFOX_DISABLE_DOH !== 'true') return undefined;
  return {
    'network.trr.mode': 5,
    'network.dns.echconfig.enabled': false,
    'network.dns.http3_h3_alt_svc_cache_enabled': false,
  };
}

/**
 * Build a user agent that matches the browser we actually launched. Overriding the UA with a
 * hardcoded Chrome/121 string while the engine is Chrome/156 is itself an inconsistency that
 * bot detection scores, so derive it from the browser version instead.
 */
export function userAgentFor(browserName: string, version: string): string {
  const major = (version || '').split('.')[0] || '126';
  const isMac = process.platform === 'darwin';

  if (/firefox/i.test(browserName)) {
    const platform = isMac ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64';
    return `Mozilla/5.0 (${platform}) Gecko/20100101 Firefox/${major}.0`;
  }

  return `Mozilla/5.0 (${isMac ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version || `${major}.0.0.0`} Safari/537.36`;
}
export function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    // If URL parsing fails, check the raw string as fallback
    return url.toLowerCase().endsWith('.pdf');
  }
}

const SEARCH_PROVIDERS = ['SEARXNG_URL', 'SERPER_API_KEY', 'BRAVE_API_KEY', 'TAVILY_API_KEY'];

/**
 * Explanation appended when every engine came back empty, so the caller learns what to do
 * instead of retrying the same query into another bot wall.
 */
export function getNoResultsGuidance(): string {
  const configured = SEARCH_PROVIDERS.filter((name) => Boolean(process.env[name]));
  const missing = SEARCH_PROVIDERS.filter((name) => !process.env[name]);

  const lines = [
    '',
    '**No results.** Every engine refused this host. From datacenter IPs the free endpoints answer with an HTTP 202 "are you a bot?" challenge (DuckDuckGo), an empty or poisoned SERP (Bing), or HTTP 429 (Brave) - this is IP reputation, not a query problem.',
    configured.length
      ? `Configured providers: ${configured.join(', ')}.`
      : 'No search provider is configured, so only the free HTML engines were tried.',
    `For reliable results add one of these to the "env" block of the websearch server in mcp.json: ${missing.join(' | ')}.`,
    'Free tiers: Brave Search API 2 000 req/month, Serper.dev 2 500 credits, Tavily 1 000 credits, SearXNG self-hosted (no key, needs `json` in search.formats).',
    'DuckDuckGo challenges are cached per IP for a while - wait ~15 minutes before retrying the free path.',
  ];

  return lines.join('\n');
} 