import axios from 'axios';
import * as cheerio from 'cheerio';
import { Page } from 'playwright';
import { ContentExtractionOptions, SearchResult } from './types.js';
import { cleanText, getWordCount, getContentPreview, generateTimestamp, isPdfUrl, userAgentFor, normalizeForDedupe, envInt, envTtlMinutes } from './utils.js';
import { BrowserPool } from './browser-pool.js';
import { TtlCache, SingleFlight } from './cache.js';

export class EnhancedContentExtractor {
  private readonly defaultTimeout: number;
  private readonly maxContentLength: number;
  private browserPool: BrowserPool;
  private fallbackThreshold: number;
  /**
   * Extracted pages, keyed by the de-duplicated URL. `full-web-search` and a follow-up
   * `get-single-web-page-content` on the same article used to fetch it twice, and asking a
   * bot-protected site the same question twice in a row is how a soft block becomes a hard one.
   */
  private readonly pageCache: TtlCache<string>;
  /** Recently failed URLs, kept briefly so a retry storm does not hammer a walled host. */
  private readonly failureCache: TtlCache<string>;
  private readonly inflight = new SingleFlight();

  constructor() {
    this.defaultTimeout = parseInt(process.env.DEFAULT_TIMEOUT || '6000', 10);
    
    // Read MAX_CONTENT_LENGTH from environment variable, fallback to 500KB
    const envMaxLength = process.env.MAX_CONTENT_LENGTH;
    this.maxContentLength = envMaxLength ? parseInt(envMaxLength, 10) : 500000;
    
    // Validate the parsed value
    if (isNaN(this.maxContentLength) || this.maxContentLength < 0) {
      console.warn(`[EnhancedContentExtractor] Invalid MAX_CONTENT_LENGTH value: ${envMaxLength}, using default 500000`);
      this.maxContentLength = 500000;
    }
    
    this.browserPool = new BrowserPool();
    this.fallbackThreshold = parseInt(process.env.BROWSER_FALLBACK_THRESHOLD || '3', 10);
    const maxEntries = envInt('CACHE_MAX_ENTRIES', 200);
    const pageTtlMs = envTtlMinutes('CONTENT_CACHE_TTL_MINUTES', 30);
    this.pageCache = new TtlCache<string>(maxEntries, pageTtlMs);
    this.failureCache = new TtlCache<string>(maxEntries, envTtlMinutes('FAILED_EXTRACTION_CACHE_TTL_MINUTES', 5));

    console.log(`[EnhancedContentExtractor] Configuration: timeout=${this.defaultTimeout}, maxContentLength=${this.maxContentLength}, fallbackThreshold=${this.fallbackThreshold}`);
    console.log(`[EnhancedContentExtractor] Page cache: ${this.pageCache.enabled ? `${Math.round(pageTtlMs / 60000)} min TTL, ${maxEntries} entries max` : 'disabled'}`);
  }

  /** One line for the tool status so the caller can tell a refetch from a cache hit. */
  getCacheSummary(): string {
    if (!this.pageCache.enabled) return 'page cache disabled';
    return `page cache ${this.pageCache.summary()}, failures ${this.failureCache.summary()}`;
  }

  /** Cache key: the same article under two tracking URLs is one entry. */
  private cacheKey(url: string): string {
    return normalizeForDedupe(url);
  }

  private capTo(text: string, maxContentLength?: number): string {
    return maxContentLength && maxContentLength > 0 && text.length > maxContentLength
      ? text.substring(0, maxContentLength)
      : text;
  }

  /**
   * Cached wrapper around the actual extraction.
   *
   * The cache stores the page at the configured ceiling (MAX_CONTENT_LENGTH) and truncates per
   * request, so one fetch serves callers asking for different lengths. A caller who explicitly
   * asks for more than the ceiling bypasses the cache rather than getting a short copy of a page
   * it asked in full for.
   */
  async extractContent(options: ContentExtractionOptions): Promise<string> {
    const { url, maxContentLength } = options;
    const key = this.cacheKey(url);
    const cacheable = maxContentLength === undefined || maxContentLength <= 0 || maxContentLength <= this.maxContentLength;

    if (cacheable) {
      const hit = this.pageCache.get(key);
      if (hit !== undefined) {
        console.log(`[EnhancedContentExtractor] Cache hit for ${url} (${hit.length} chars, ${this.pageCache.summary()})`);
        return this.capTo(hit, maxContentLength);
      }

      const failure = this.failureCache.get(key);
      if (failure !== undefined) {
        // Deliberately an error again: the site refused it minutes ago and will refuse it now.
        // The reason is preserved so index.ts still categorises it identically.
        const left = this.failureCache.remainingFor(key);
        console.log(`[EnhancedContentExtractor] Reusing cached failure for ${url} (${left}s left in cache)`);
        throw new Error(`${failure} (same failure ${left}s ago; FAILED_EXTRACTION_CACHE_TTL_MINUTES controls this)`);
      }
    }

    try {
      const content = await this.inflight.run(key, () =>
        this.extractUncached(cacheable ? { ...options, maxContentLength: undefined } : options),
      );
      if (cacheable) this.pageCache.set(key, content);
      return this.capTo(content, maxContentLength);
    } catch (error) {
      if (cacheable) this.failureCache.set(key, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async extractUncached(options: ContentExtractionOptions): Promise<string> {
    const { url } = options;
    
    console.log(`[EnhancedContentExtractor] Starting extraction for: ${url}`);
    
    // First, try with regular HTTP client (faster)
    try {
      const content = await this.extractWithAxios(options);
      console.log(`[EnhancedContentExtractor] Successfully extracted with axios: ${content.length} chars`);
      return content;
    } catch (error) {
      const axiosReason = this.describeError(error);
      console.log(`[EnhancedContentExtractor] Axios failed: ${axiosReason}`);
      
      // Check if this looks like a case where browser would help
      if (this.shouldUseBrowser(error, url)) {
        console.log(`[EnhancedContentExtractor] Falling back to headless browser for: ${url}`);
        try {
          const content = await this.extractWithBrowser(options);
          console.log(`[EnhancedContentExtractor] Successfully extracted with browser: ${content.length} chars`);
          return content;
        } catch (browserError) {
          const browserReason = this.describeError(browserError);
          console.error(`[EnhancedContentExtractor] Browser extraction also failed:`, browserError);

          // The caller only ever sees this string, and the previous "Both axios and browser
          // extraction failed for <url>" told it nothing: a bot-protection wall, a DNS failure and
          // a page with no text all looked identical.
          const blocked = `${axiosReason} ${browserReason}`.toLowerCase().includes('interstitial');
          const hint = blocked
            ? ' The site is serving a bot-protection page instead of the article - try a different source.'
            : '';

          throw new Error(`Could not extract content from ${url}: HTTP said "${axiosReason}"; browser said "${browserReason}".${hint}`);
        }
      } else {
        // No browser fallback was warranted (404, DNS failure, TLS error, ...). Keep the reason -
        // categorizeError() keys off it - but name the URL so the caller is not left guessing.
        throw new Error(`Could not fetch ${url}: ${axiosReason}`);
      }
    }
  }

  /** Stable marker used both when rejecting low quality content and when deciding on a fallback. */
  private static readonly LOW_QUALITY_PREFIX = 'low-quality content';

  /**
   * One-line, length-bounded description of a failure - axios errors can carry whole response
   * bodies, which must not end up in an MCP tool response.
   */
  private describeError(error: unknown): string {
    let reason: string;

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status) {
        reason = `HTTP ${status} ${error.response?.statusText ?? ''}`.trim();
      } else {
        // Network-level failures carry a code only. Spelling it out also lets index.ts
        // categorise them - before this, "getaddrinfo ENOTFOUND host" matched nothing and came
        // back as "Other error".
        reason = this.describeNetworkCode(error.code, error.message);
      }
    } else {
      reason = error instanceof Error ? error.message : String(error);
    }

    const clean = reason.replace(/\s+/g, ' ').replace(/^error:\s*/i, '').trim();
    return clean.length > 180 ? `${clean.slice(0, 177)}...` : (clean || 'unknown error');
  }

  /** Translate axios network error codes into phrases that name the actual problem. */
  private describeNetworkCode(code: string | undefined, message: string): string {
    switch (code) {
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return `DNS lookup failed (${code})`;
      case 'ECONNREFUSED':
        return 'connection refused (ECONNREFUSED)';
      case 'ECONNRESET':
      case 'EPIPE':
        return 'connection reset by peer';
      case 'ETIMEDOUT':
      case 'ECONNABORTED':
        return `timed out (${code})`;
      case 'ERR_NETWORK':
        return 'network error';
      default:
        // TLS codes vary a lot (CERT_HAS_EXPIRED, ERR_TLS_CERT_ALTNAME_INVALID,
        // DEPTH_ZERO_SELF_SIGNED_CERT, UNABLE_TO_VERIFY_LEAF_SIGNATURE...). Name them as TLS so the
        // failure is not classified by an accidental substring of the hostname (e.g. badssl.com).
        if (code && /CERT|TLS|SSL|SELF_SIGNED|UNKNOWN_CA/i.test(code)) {
          return `TLS certificate error (${code})`;
        }
        return code || message || 'request failed';
    }
  }

  /** Why the extracted text was rejected, phrased so the caller can act on it. */
  private describeRejection(content: string): string {
    if (this.isBlockPage(content)) {
      return 'bot-protection interstitial (no article content)';
    }
    return `no usable article text (${content.trim().length} characters extracted)`;
  }

  private async extractWithAxios(options: ContentExtractionOptions): Promise<string> {
    const { url, timeout = this.defaultTimeout, maxContentLength = this.maxContentLength } = options;
    
    const response = await axios.get(url, {
      headers: this.getRandomHeaders(),
      timeout,
      // Remove maxContentLength from axios config - handle truncation manually
      validateStatus: (status: number) => status < 400,
    });

    let content = this.parseContent(response.data);
    
    // Truncate content if it exceeds the limit (instead of axios throwing an error)
    if (maxContentLength && content.length > maxContentLength) {
      console.log(`[EnhancedContentExtractor] Content truncated from ${content.length} to ${maxContentLength} characters for ${url}`);
      content = content.substring(0, maxContentLength);
    }
    
    // Check if we got a meaningful response
    if (this.isLowQualityContent(content)) {
      throw new Error(`${EnhancedContentExtractor.LOW_QUALITY_PREFIX}: ${this.describeRejection(content)}`);
    }
    
    return content;
  }

  private async extractWithBrowser(options: ContentExtractionOptions): Promise<string> {
    const { url, timeout = this.defaultTimeout } = options;
    
    const browser = await this.browserPool.getBrowser();
    const browserType = this.browserPool.getLastUsedBrowserType();
    
    try {
      // Create context options based on browser capabilities
      const baseContextOptions = {
        userAgent: await this.resolveUserAgent(browser),
        viewport: this.getRandomViewport(),
        locale: 'en-US',
        timezoneId: this.getRandomTimezone(),
        // Simulate real device characteristics
        deviceScaleFactor: Math.random() > 0.5 ? 1 : 2,
        hasTouch: Math.random() > 0.7,
      };

      // Firefox doesn't support isMobile option - check multiple ways to ensure detection
      const isFirefox = browserType === 'firefox' || 
                       browserType.includes('firefox') || 
                       browser.constructor.name.toLowerCase().includes('firefox');
      
      const contextOptions = isFirefox
        ? baseContextOptions 
        : { ...baseContextOptions, isMobile: Math.random() > 0.8 };

      // Create a new context for each request (isolation)
      const context = await browser.newContext(contextOptions);

      // Add stealth scripts to avoid detection
      await context.addInitScript(() => {
        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });

        // Mock plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        // Mock languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });

        // Mock permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: 'default' } as unknown as PermissionStatus) :
            originalQuery(parameters)
        );

        // Remove automation indicators
        const windowWithChrome = window as any;
        if (windowWithChrome.chrome) {
          delete windowWithChrome.chrome.app;
          delete windowWithChrome.chrome.runtime;
        }
      });

      const page = await context.newPage();
      
      // Set up request interception to block unnecessary resources
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        
        // Block images, fonts, and other non-essential resources for faster loading
        if (['image', 'font', 'media'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      // Navigate with realistic options and better error handling
      console.log(`[BrowserExtractor] Navigating to ${url}`);
      
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', // Don't wait for all resources
          timeout: Math.min(timeout, 8000) // Reduced timeout, max 8 seconds
        });
      } catch (gotoError) {
        // Handle specific protocol errors
        const errorMessage = gotoError instanceof Error ? gotoError.message : String(gotoError);
        
        if (errorMessage.includes('ERR_HTTP2_PROTOCOL_ERROR') || errorMessage.includes('HTTP2')) {
          console.log(`[BrowserExtractor] HTTP/2 error detected, trying with HTTP/1.1`);
          
          // Create a new context with HTTP/1.1 preference
          await context.close();
          const http1Context = await browser.newContext({
            userAgent: await this.resolveUserAgent(browser),
            viewport: this.getRandomViewport(),
            locale: 'en-US',
            timezoneId: this.getRandomTimezone(),
            extraHTTPHeaders: {
              'Connection': 'keep-alive',
              'Upgrade-Insecure-Requests': '1'
            }
          });
          
          const http1Page = await http1Context.newPage();
          
          // Disable HTTP/2 by intercepting requests
          await http1Page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (['image', 'font', 'media'].includes(resourceType)) {
              route.abort();
            } else {
              route.continue();
            }
          });
          
          await http1Page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: Math.min(timeout, 6000)
          });
          
          // Quick content extraction
          const html = await http1Page.content();
          const content = this.parseContent(html);
          await http1Context.close();
          return content;
        } else {
          throw gotoError;
        }
      }

      // Quick human simulation - reduced time
      await page.mouse.move(Math.random() * 100, Math.random() * 100);
      
      // Reduced wait time for dynamic content
      await page.waitForTimeout(500 + Math.random() * 1000);

      // Quick check for main content without long wait
      try {
        await page.waitForSelector('article, main, .content, .post-content, .entry-content', {
          timeout: 2000
        });
      } catch {
        console.log(`[BrowserExtractor] No main content selector found, proceeding anyway`);
      }

      // Extract content using the same logic as axios version
      const html = await page.content();
      const content = this.parseContent(html);

      // The axios path already rejects bot-protection pages; the browser path did not, so a
      // Cloudflare interstitial was returned as if it were the article (observed as a 516 char
      // "Why have I been blocked?" body reported as a successful extraction).
      if (this.isBlockPage(content)) {
        await context.close();
        throw new Error(`Bot protection interstitial detected for ${url} - the page was not extracted`);
      }

      await context.close();
      return content;

    } catch (error) {
      console.error(`[BrowserExtractor] Browser extraction failed for ${url}:`, error);
      throw error;
    }
  }

  private async simulateHumanBehavior(page: Page): Promise<void> {
    try {
      // Random mouse movements
      await page.mouse.move(
        Math.random() * 800,
        Math.random() * 600
      );

      // Random scroll (common human behavior)
      const scrollY = Math.random() * 500;
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);

      // Small random delay
      await page.waitForTimeout(500 + Math.random() * 1000);

      // Sometimes click somewhere innocuous
      if (Math.random() > 0.7) {
        try {
          await page.click('body', { timeout: 1000 });
        } catch {
          // Ignore click failures
        }
      }
    } catch {
      // Ignore simulation errors
      console.log(`[BrowserExtractor] Behavior simulation failed, continuing`);
    }
  }

  private shouldUseBrowser(error: any, url: string): boolean {
    // Conditions where browser is likely to succeed where axios failed
    const indicators = [
      // HTTP status codes that suggest bot detection
      error.response?.status === 403,
      error.response?.status === 429,
      error.response?.status === 503,
      
      // Error messages suggesting JS requirement
      error.message?.includes('timeout'),
      error.message?.includes('Access denied'),
      error.message?.includes('Forbidden'),
      error.message?.includes(EnhancedContentExtractor.LOW_QUALITY_PREFIX),
      
      // Response content suggesting bot detection
      error.response?.data?.includes('Please enable JavaScript'),
      error.response?.data?.includes('captcha'),
      error.response?.data?.includes('unusual traffic'),
      error.response?.data?.includes('robot'),
      
      // Sites known to be JS-heavy
      url.includes('twitter.com'),
      url.includes('facebook.com'),
      url.includes('instagram.com'),
      url.includes('linkedin.com'),
      url.includes('reddit.com'),
      url.includes('medium.com'),
    ];

    return indicators.some(indicator => indicator === true);
  }

  /**
   * Fingerprints of anti-bot interstitials (Cloudflare, Akamai, Wordfence...). Phrases, not bare
   * words: "captcha"/"robot" appear constantly in legitimate security documentation, and short
   * matches there would reject real articles.
   */
  private isBlockPage(content: string): boolean {
    const text = content.toLowerCase();

    const markers = [
      'why have i been blocked',
      'security service to protect itself',
      'triggered the security solution',
      'attention required! this website',
      'verifying you are human',
      'checking your browser before connecting',
      'enable javascript and cookies to continue',
      'pardon our interruption',
      'blocked by network security',
      'access denied',
      '403 forbidden',
      'please enable javascript',
      'unusual traffic',
      'select all squares',
      'enter the code you see above',
    ];

    return markers.some((marker) => text.includes(marker));
  }

  private isLowQualityContent(content: string): boolean {
    if (this.isBlockPage(content)) {
      console.log(`[EnhancedContentExtractor] Detected a bot-protection interstitial, not article content`);
      return true;
    }

    const lowQualityIndicators = [
      content.length < 100,
      content.includes('captcha'),
      content.includes('robot'),
      content.trim() === '',
    ];

    return lowQualityIndicators.some(indicator => indicator === true);
  }

  private getRandomHeaders(): Record<string, string> {
    const browsers = [
      {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-platform': '"Windows"',
      },
      {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-platform': '"macOS"',
      },
      {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-platform': '"Linux"',
      }
    ];

    const browser = browsers[Math.floor(Math.random() * browsers.length)];
    
    return {
      ...browser,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'sec-ch-ua-mobile': '?0',
    };
  }

  /**
   * A UA that contradicts the engine actually running (Chrome/121 string on Chrome/156, or a
   * Chrome UA on Firefox) is itself a detection signal, so when the browser reports its version
   * build a matching UA and only fall back to the random list otherwise.
   */
  private async resolveUserAgent(browser: { browserType: () => { name: () => string }; version: () => string }): Promise<string> {
    try {
      return userAgentFor(browser.browserType().name(), browser.version());
    } catch {
      return this.getRandomUserAgent();
    }
  }

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  private getRandomViewport(): { width: number; height: number } {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1536, height: 864 },
      { width: 1280, height: 720 },
    ];
    
    return viewports[Math.floor(Math.random() * viewports.length)];
  }

  private getRandomTimezone(): string {
    const timezones = [
      'America/New_York',
      'America/Los_Angeles',
      'America/Chicago',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo',
    ];
    
    return timezones[Math.floor(Math.random() * timezones.length)];
  }

  /**
   * Decide which SERP entries are worth a fetch.
   *
   * PDFs are skipped (they are not parsed here) and results whose URLs describe the same page -
   * `http`/`https`, `www.`, a trailing slash, a fragment, an `utm_` parameter - collapse into the
   * highest ranked variant. Up to `targetCount * 3` candidates (never more than 10) stay queued:
   * room to replace failures, without the old two-pages-per-request fan-out that fetched six pages
   * for `limit: 2` even when the first two were fine.
   */
  planFollows(results: SearchResult[], targetCount: number): { nonPdf: number; unique: number; queue: SearchResult[] } {
    const nonPdfResults = results.filter((result) => !isPdfUrl(result.url));

    const seen = new Set<string>();
    const uniqueResults = nonPdfResults.filter((result) => {
      const key = this.cacheKey(result.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueResults.length !== nonPdfResults.length) {
      console.log(`[EnhancedContentExtractor] Collapsed ${nonPdfResults.length - uniqueResults.length} duplicate result URL(s), ${uniqueResults.length} unique left`);
    }

    const cap = Math.min(Math.max(targetCount * 3, targetCount + 1), 10);
    return { nonPdf: nonPdfResults.length, unique: uniqueResults.length, queue: uniqueResults.slice(0, cap) };
  }

  /** Extract one result, with the per-page deadline that keeps a slow host from stalling a batch. */
  private async extractOne(result: SearchResult): Promise<SearchResult> {
    try {
      // Use a race condition with timeout to prevent hanging
      const extractionPromise = this.extractContent({
        url: result.url,
        timeout: 6000 // Reduced timeout to 6 seconds per page
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Content extraction timeout')), 8000);
        // do not let a lost race keep the event loop (and a browser) alive for another 8 seconds
        timer.unref?.();
      });

      const content = await Promise.race([extractionPromise, timeoutPromise]);
      const cleanedContent = cleanText(content, this.maxContentLength);

      console.log(`[EnhancedContentExtractor] Successfully extracted: ${result.url}`);
      return {
        ...result,
        fullContent: cleanedContent,
        contentPreview: getContentPreview(cleanedContent),
        wordCount: getWordCount(cleanedContent),
        timestamp: generateTimestamp(),
        fetchStatus: 'success' as const,
      };
    } catch (error) {
      console.log(`[EnhancedContentExtractor] Failed to extract: ${result.url} - ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        ...result,
        fullContent: '',
        contentPreview: '',
        wordCount: 0,
        timestamp: generateTimestamp(),
        fetchStatus: 'error' as const,
        error: this.getSpecificErrorMessage(error),
      };
    }
  }

  async extractContentForResults(results: SearchResult[], targetCount: number = results.length): Promise<SearchResult[]> {
    return (await this.extractContentForResultsDetailed(results, targetCount)).results;
  }

  /** Same as extractContentForResults, plus what it actually cost, for the tool status line. */
  async extractContentForResultsDetailed(
    results: SearchResult[],
    targetCount: number = results.length,
  ): Promise<{ results: SearchResult[]; stats: { candidates: number; fetched: number; succeeded: number; failed: number; cache: string } }> {
    const { nonPdf, unique, queue } = this.planFollows(results, targetCount);
    console.log(`[EnhancedContentExtractor] ${results.length} results → ${nonPdf} non-PDF → ${unique} unique; will fetch at most ${queue.length} to get ${targetCount}`);

    const fetched: SearchResult[] = [];
    let cursor = 0;

    // Batches instead of a fan-out: the next batch only runs when the previous one came back short,
    // so a healthy SERP costs exactly targetCount page loads.
    while (cursor < queue.length) {
      const succeeded = fetched.filter((r) => r.fetchStatus === 'success').length;
      if (succeeded >= targetCount) break;

      const batch = queue.slice(cursor, cursor + Math.max(1, targetCount - succeeded));
      cursor += batch.length;
      fetched.push(...(await Promise.all(batch.map((result) => this.extractOne(result)))));
    }

    // Preserve SERP rank; successes first, failures only as fillers up to targetCount.
    const rank = new Map(queue.map((result, index) => [result.url, index]));
    const byRank = (a: SearchResult, b: SearchResult) => (rank.get(a.url) ?? 0) - (rank.get(b.url) ?? 0);
    const successfulResults = fetched.filter((r) => r.fetchStatus === 'success').sort(byRank);
    const failedResults = fetched.filter((r) => r.fetchStatus === 'error').sort(byRank);

    const enhancedResults = [
      ...successfulResults.slice(0, targetCount),
      ...failedResults.slice(0, Math.max(0, targetCount - successfulResults.length)),
    ].slice(0, targetCount);

    const stats = {
      candidates: queue.length,
      fetched: fetched.length,
      // succeeded/failed count the pages that were fetched; only targetCount of them are returned
      succeeded: successfulResults.length,
      failed: failedResults.length,
      cache: this.getCacheSummary(),
    };

    console.log(`[EnhancedContentExtractor] Fetched ${fetched.length} of ${queue.length} candidates: ${stats.succeeded} successful/${stats.failed} failed; ${stats.cache}`);
    return { results: enhancedResults, stats };
  }

  /**
   * Words that mark a class/ID as page chrome rather than article text. Matched against whole
   * tokens (split on -, _, space, camelCase boundaries), so `mw-header` is dropped but a class
   * like `download-links` or `grade-scale` is not.
   */
  private static readonly NOISE_TOKENS = new Set([
    'ad', 'ads', 'advert', 'advertisement', 'advertisements', 'adunit', 'adsense', 'tracking', 'tracker',
    'analytics', 'pixel', 'beacon', 'sponsored', 'affiliate', 'affiliates', 'promo', 'promotion',
    'banner', 'banners', 'popup', 'popups', 'modal', 'overlay', 'tooltip', 'toolbar', 'ribbon',
    'sidebar', 'sidebars', 'navigation', 'nav', 'menu', 'menubar', 'footer', 'header', 'topbar',
    'breadcrumb', 'breadcrumbs', 'share', 'sharing', 'social', 'newsletter', 'subscribe', 'subscription',
    'comment', 'comments', 'disclaimer', 'cookie', 'cookies', 'privacy', 'terms', 'legal', 'copyright',
    'login', 'signin', 'signup', 'search', 'searchbox', 'pagination', 'pager', 'related', 'recommendations',
    'metadata', 'byline', 'tags', 'categories'
  ]);

  private tokenizeClass(value: string): string[] {
    return value
      .toLowerCase()
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  /**
   * Token-aware removal of ad/navigation chrome. Safe by construction:
   *  - only whole tokens are compared (no `*="ad"` substring matching)
   *  - structural/root elements are never removed
   *  - an element carrying more than 40% of the page text is kept (it is the article wrapper,
   *    not an ad slot)
   */
  private removeNoiseElements($: cheerio.CheerioAPI): void {
    const bodyTextLength = $('body').text().trim().length || $('html').text().trim().length || 1;

    for (const attribute of ['class', 'id'] as const) {
      $(`[${attribute}]`).each((_index, element) => {
        const $element = $(element);
        const raw = $element.attr(attribute);
        if (!raw) return;
        if (!this.tokenizeClass(raw).some(token => EnhancedContentExtractor.NOISE_TOKENS.has(token))) return;

        const tagName = (element as any).tagName?.toString().toLowerCase() ?? '';
        if (tagName === 'html' || tagName === 'body') return;
        if ($element.is('main, article, [role="main"]')) return;

        const elementTextLength = $element.text().trim().length;
        if (elementTextLength / bodyTextLength > 0.4) return; // wraps the real content

        $element.remove();
      });
    }
  }

  /**
   * Fallback extraction: re-parse the raw HTML and return the text of the container with the
   * highest amount of readable text (classic readability heuristic, link-density penalised).
   */
  private extractDensestTextBlock(html: string): string {
    try {
      const $ = cheerio.load(html);
      $('script, style, noscript, template, svg, code, kbd').remove();

      let best = '';
      let bestScore = 0;
      let considered = 0;

      $('article, main, [role="main"], section, div, td').each((_index, element) => {
        if (considered++ > 3000) return false;
        const $element = $(element);
        const text = $element.text().replace(/\s+/g, ' ').trim();
        if (text.length < 200) return;

        const linkText = $element.find('a').toArray().reduce((sum, a) => sum + $(a).text().trim().length, 0);
        const linkDensity = Math.min(linkText / text.length, 1);
        const score = text.length * (1 - linkDensity);

        if (score > bestScore) {
          bestScore = score;
          best = text;
        }
      });

      if (best) {
        console.log(`[EnhancedContentExtractor] Densest text block: ${best.length} chars (score ${Math.round(bestScore)})`);
      }
      return best;
    } catch {
      return '';
    }
  }

  private parseContent(html: string): string {
    const $ = cheerio.load(html);
    
    // Remove all script, style, and other non-content elements
    $('script, style, noscript, iframe, img, video, audio, canvas, svg, object, embed, applet, form, input, textarea, select, button, label, fieldset, legend, optgroup, option').remove();
    
    // Remove block-level navigation chrome (tag level). Class/ID based noise is handled by
    // removeNoiseElements() below, which is token-aware and protects content wrappers.
    $('nav, header, footer').remove();
    
    // Remove elements whose class/ID *tokens* mark them as ad/tracking/chrome noise.
    // NOTE: this deliberately does NOT use `[class*="ad"]` style substring matching: the
    // substring "ad" also occurs in totally innocent names ("header", "grade", "download"...),
    // which used to delete whole sites (e.g. every Wikipedia article, because `mw-header-*`
    // wraps the page). Matching is per word/token and never removes an element that holds
    // most of the page text.
    this.removeNoiseElements($);
    
    // Remove image-related elements and attributes
    $('picture, source, figure, figcaption, .image, .img, .photo, .picture, .media, .gallery, .slideshow, .carousel').remove();
    $('[data-src*="image"], [data-src*="img"], [data-src*="photo"], [data-src*="picture"]').remove();
    $('[style*="background-image"]').remove();
    
    // Remove empty elements and whitespace-only elements
    $('*').each(function() {
      const $this = $(this);
      if ($this.children().length === 0 && $this.text().trim() === '') {
        $this.remove();
      }
    });
    
    // Try to find the main content area first
    let mainContent = '';
    
    // Priority selectors for main content
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.story-content',
      '.news-content',
      '.main-content',
      '.page-content',
      '.text-content',
      '.body-content',
      '.copy',
      '.text',
      '.body'
    ];
    
    for (const selector of contentSelectors) {
      const $content = $(selector).first();
      if ($content.length > 0) {
        mainContent = $content.text().trim();
        if (mainContent.length > 100) { // Ensure we have substantial content
          console.log(`[EnhancedContentExtractor] Found content with selector: ${selector} (${mainContent.length} chars)`);
          break;
        }
      }
    }
    
    // If no main content found, try body content
    if (!mainContent || mainContent.length < 100) {
      console.log(`[EnhancedContentExtractor] No main content found, using body content`);
      mainContent = $('body').text().trim();
    }

    // Last resort: the filters above (or a weird DOM) left us with nothing usable - re-parse the
    // untouched HTML and take the densest text block instead of returning an empty page.
    if (!mainContent || mainContent.length < 100) {
      console.log(`[EnhancedContentExtractor] Body content unusable, falling back to densest text block`);
      mainContent = this.extractDensestTextBlock(html);
    }
    
    // Clean up the text
    const cleanedContent = this.cleanTextContent(mainContent);
    
    return cleanText(cleanedContent, this.maxContentLength);
  }
  
  private cleanTextContent(text: string): string {
    // Remove excessive whitespace
    text = text.replace(/\s+/g, ' ');
    
    // Remove image-related text and data URLs
    text = text.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, ''); // Remove base64 image data
    text = text.replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff)(\?[^\s]*)?/gi, ''); // Remove image URLs
    text = text.replace(/\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff)/gi, ''); // Remove image file extensions
    text = text.replace(/image|img|photo|picture|gallery|slideshow|carousel/gi, ''); // Remove image-related words
    text = text.replace(/click to enlarge|click for full size|view larger|download image/gi, ''); // Remove image action text
    
    // Remove common non-content patterns
    text = text.replace(/cookie|privacy|terms|conditions|disclaimer|legal|copyright|all rights reserved/gi, '');
    
    // Remove excessive line breaks and spacing
    text = text.replace(/\n\s*\n/g, '\n');
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\r/g, '\n');
    
    // Remove leading/trailing whitespace
    text = text.trim();
    
    return text;
  }

  private getSpecificErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        return 'Request timeout';
      }
      if (error.response?.status === 403) {
        return '403 Forbidden - Access denied';
      }
      if (error.response?.status === 404) {
        return '404 Not found';
      }
      if (error.message.includes('maxContentLength')) {
        return 'Content too long';
      }
      if (error.response?.status) {
        return `HTTP ${error.response.status}: ${error.message}`;
      }
      return `Network error: ${error.message}`;
    }
    
    return error instanceof Error ? error.message : 'Unknown error';
  }

  async closeAll(): Promise<void> {
    await this.browserPool.closeAll();
  }
}