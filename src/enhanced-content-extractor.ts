import axios from 'axios';
import * as cheerio from 'cheerio';
import { Page } from 'playwright';
import { ContentExtractionOptions, SearchResult } from './types.js';
import { cleanText, getWordCount, getContentPreview, generateTimestamp, isPdfUrl } from './utils.js';
import { BrowserPool } from './browser-pool.js';

export class EnhancedContentExtractor {
  private readonly defaultTimeout: number;
  private readonly maxContentLength: number;
  private browserPool: BrowserPool;
  private fallbackThreshold: number;

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
    
    console.error(`[EnhancedContentExtractor] Configuration: timeout=${this.defaultTimeout}, maxContentLength=${this.maxContentLength}, fallbackThreshold=${this.fallbackThreshold}`);
  }

  async extractContent(options: ContentExtractionOptions): Promise<string> {
    const { url } = options;
    
    console.error(`[EnhancedContentExtractor] Starting extraction for: ${url}`);
    
    // First, try with regular HTTP client (faster)
    try {
      const content = await this.extractWithAxios(options);
      console.error(`[EnhancedContentExtractor] Successfully extracted with axios: ${content.length} chars`);
      return content;
    } catch (error) {
      console.error(`[EnhancedContentExtractor] Axios failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Check if this looks like a case where browser would help
      if (this.shouldUseBrowser(error, url)) {
        console.error(`[EnhancedContentExtractor] Falling back to headless browser for: ${url}`);
        try {
          const content = await this.extractWithBrowser(options);
          console.error(`[EnhancedContentExtractor] Successfully extracted with browser: ${content.length} chars`);
          return content;
        } catch (browserError) {
          console.error(`[EnhancedContentExtractor] Browser extraction also failed:`, browserError);
          throw new Error(`Both axios and browser extraction failed for ${url}`);
        }
      } else {
        throw error;
      }
    }
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
      console.error(`[EnhancedContentExtractor] Content truncated from ${content.length} to ${maxContentLength} characters for ${url}`);
      content = content.substring(0, maxContentLength);
    }
    
    // Check if we got a meaningful response
    if (this.isLowQualityContent(content)) {
      throw new Error('Low quality content detected - likely bot detection');
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
        userAgent: this.getRandomUserAgent(),
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
      console.error(`[BrowserExtractor] Navigating to ${url}`);
      
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', // Don't wait for all resources
          timeout: Math.min(timeout, 8000) // Reduced timeout, max 8 seconds
        });
      } catch (gotoError) {
        // Handle specific protocol errors
        const errorMessage = gotoError instanceof Error ? gotoError.message : String(gotoError);
        
        if (errorMessage.includes('ERR_HTTP2_PROTOCOL_ERROR') || errorMessage.includes('HTTP2')) {
          console.error(`[BrowserExtractor] HTTP/2 error detected, trying with HTTP/1.1`);
          
          // Create a new context with HTTP/1.1 preference
          await context.close();
          const http1Context = await browser.newContext({
            userAgent: this.getRandomUserAgent(),
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
        console.error(`[BrowserExtractor] No main content selector found, proceeding anyway`);
      }

      // Extract content using the same logic as axios version
      const html = await page.content();
      const content = this.parseContent(html);

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
      console.error(`[BrowserExtractor] Behavior simulation failed, continuing`);
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
      error.message?.includes('Low quality content detected'),
      
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

  private isLowQualityContent(content: string): boolean {
    const lowQualityIndicators = [
      content.length < 100,
      content.includes('Please enable JavaScript'),
      content.includes('Access Denied'),
      content.includes('403 Forbidden'),
      content.includes('captcha'),
      content.includes('unusual traffic'),
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

  async extractContentForResults(results: SearchResult[], targetCount: number = results.length): Promise<SearchResult[]> {
    console.error(`[EnhancedContentExtractor] Processing up to ${results.length} results to get ${targetCount} non-PDF results`);
    
    // Filter out PDF files first
    const nonPdfResults = results.filter(result => !isPdfUrl(result.url));
    const resultsToProcess = nonPdfResults.slice(0, Math.min(targetCount * 2, 10)); // Process extra to account for failures
    
    console.error(`[EnhancedContentExtractor] Processing ${resultsToProcess.length} non-PDF results concurrently`);
    
    // Process results concurrently with timeout
    const extractionPromises = resultsToProcess.map(async (result): Promise<SearchResult> => {
      try {
        // Use a race condition with timeout to prevent hanging
        const extractionPromise = this.extractContent({ 
          url: result.url, 
          timeout: 6000 // Reduced timeout to 6 seconds per page
        });
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Content extraction timeout')), 8000);
        });
        
        const content = await Promise.race([extractionPromise, timeoutPromise]);
        const cleanedContent = cleanText(content, this.maxContentLength);
        
        console.error(`[EnhancedContentExtractor] Successfully extracted: ${result.url}`);
        return {
          ...result,
          fullContent: cleanedContent,
          contentPreview: getContentPreview(cleanedContent),
          wordCount: getWordCount(cleanedContent),
          timestamp: generateTimestamp(),
          fetchStatus: 'success' as const,
        };
      } catch (error) {
        console.error(`[EnhancedContentExtractor] Failed to extract: ${result.url} - ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    });
    
    // Wait for all extractions to complete
    const allResults = await Promise.all(extractionPromises);
    
    // Return successful results first, up to targetCount
    const successfulResults = allResults.filter(r => r.fetchStatus === 'success');
    const failedResults = allResults.filter(r => r.fetchStatus === 'error');
    
    // Combine successful and failed results, prioritizing successful ones
    const enhancedResults = [
      ...successfulResults.slice(0, targetCount),
      ...failedResults.slice(0, Math.max(0, targetCount - successfulResults.length))
    ].slice(0, targetCount);
    
    console.error(`[EnhancedContentExtractor] Completed processing ${resultsToProcess.length} results, extracted ${successfulResults.length} successful/${failedResults.length} failed`);
    return enhancedResults;
  }

  private parseContent(html: string): string {
    const $ = cheerio.load(html);
    
    // Remove all script, style, and other non-content elements
    $('script, style, noscript, iframe, img, video, audio, canvas, svg, object, embed, applet, form, input, textarea, select, button, label, fieldset, legend, optgroup, option').remove();
    
    // Remove navigation, header, footer, and other non-content elements
    $('nav, header, footer, .nav, .header, .footer, .sidebar, .menu, .breadcrumb, aside, .ad, .advertisement, .ads, .advertisement-container, .social-share, .share-buttons, .comments, .comment-section, .related-posts, .recommendations, .newsletter-signup, .cookie-notice, .privacy-notice, .terms-notice, .disclaimer, .legal, .copyright, .meta, .metadata, .author-info, .publish-date, .tags, .categories, .navigation, .pagination, .search-box, .search-form, .login-form, .signup-form, .newsletter, .popup, .modal, .overlay, .tooltip, .toolbar, .ribbon, .banner, .promo, .sponsored, .affiliate, .tracking, .analytics, .pixel, .beacon').remove();
    
    // Remove elements with common ad/tracking classes
    $('[class*="ad"], [class*="ads"], [class*="advertisement"], [class*="tracking"], [class*="analytics"], [class*="pixel"], [class*="beacon"], [class*="sponsored"], [class*="affiliate"], [class*="promo"], [class*="banner"], [class*="popup"], [class*="modal"], [class*="overlay"], [class*="tooltip"], [class*="toolbar"], [class*="ribbon"]').remove();
    
    // Remove elements with common non-content IDs
    $('[id*="ad"], [id*="ads"], [id*="advertisement"], [id*="tracking"], [id*="analytics"], [id*="pixel"], [id*="beacon"], [id*="sponsored"], [id*="affiliate"], [id*="promo"], [id*="banner"], [id*="popup"], [id*="modal"], [id*="overlay"], [id*="tooltip"], [id*="toolbar"], [id*="ribbon"], [id*="sidebar"], [id*="navigation"], [id*="menu"], [id*="footer"], [id*="header"]').remove();
    
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
          console.error(`[EnhancedContentExtractor] Found content with selector: ${selector} (${mainContent.length} chars)`);
          break;
        }
      }
    }
    
    // If no main content found, try body content
    if (!mainContent || mainContent.length < 100) {
      console.error(`[EnhancedContentExtractor] No main content found, using body content`);
      mainContent = $('body').text().trim();
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