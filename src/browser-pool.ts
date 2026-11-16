import { chromium, firefox, webkit, Browser } from 'playwright';
import { getChromiumLaunchOptions, getFirefoxLaunchOptions, getExtraBrowserArgs, getFirefoxUserPrefs } from './utils.js';

export class BrowserPool {
  private browsers: Map<string, Browser> = new Map();
  private maxBrowsers: number;
  private browserTypes: string[];
  private currentBrowserIndex = 0;
  private headless: boolean;
  private lastUsedBrowserType: string = '';

  constructor() {
    // Read configuration from environment variables
    this.maxBrowsers = parseInt(process.env.MAX_BROWSERS || '3', 10);
    this.headless = process.env.BROWSER_HEADLESS !== 'false'; // Default to true
    
    // Configure browser types based on environment
    const browserTypesEnv = process.env.BROWSER_TYPES || 'chromium,firefox';
    this.browserTypes = browserTypesEnv.split(',').map(type => type.trim());
    
    console.log(`[BrowserPool] Configuration: maxBrowsers=${this.maxBrowsers}, headless=${this.headless}, types=${this.browserTypes.join(',')}`);
  }

  async getBrowser(): Promise<Browser> {
    // Rotate between browser types for variety
    const browserType = this.browserTypes[this.currentBrowserIndex % this.browserTypes.length];
    this.currentBrowserIndex++;
    this.lastUsedBrowserType = browserType;

    if (this.browsers.has(browserType)) {
      const browser = this.browsers.get(browserType)!;
      
      // Check if browser is still connected and healthy
      try {
        if (browser.isConnected()) {
          // Quick health check by trying to create and close a context
          // Use minimal options to avoid Firefox isMobile issues
          const testContext = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
          });
          await testContext.close();
          return browser;
        }
      } catch (error) {
        console.log(`[BrowserPool] Browser ${browserType} health check failed:`, error);
        // Browser is unhealthy, remove it and close if possible
        this.browsers.delete(browserType);
        try {
          await browser.close();
        } catch (closeError) {
          console.log(`[BrowserPool] Error closing unhealthy browser:`, closeError);
        }
      }
    }

    // Launch new browser
    console.log(`[BrowserPool] Launching new ${browserType} browser`);
    
    // These switches are Chromium-specific. Firefox accepts them at launch and then starts in a
    // broken state where the browser object looks connected but newPage()/navigation hang until
    // timeout - measured here as 235 s vs 2 s with the flags removed. So each browser type gets
    // only the arguments that mean something for it, plus whatever the operator asked for.
    const chromiumArgs = [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      ...getExtraBrowserArgs(),
    ];

    const launchOptions = {
      headless: this.headless,
      args: chromiumArgs,
    };

    const nonChromiumOptions = {
      headless: this.headless,
      args: getExtraBrowserArgs(),
    };

    let browser: Browser;
    try {
      switch (browserType) {
        case 'chromium':
          try {
            // Prefer the installed Google Chrome (see getChromiumLaunchOptions): sites that
            // fingerprint the Playwright headless shell refuse it while accepting real Chrome.
            browser = await chromium.launch({ ...getChromiumLaunchOptions(), ...launchOptions });
          } catch (chromeError) {
            console.log(`[BrowserPool] Real Chrome unavailable (${chromeError instanceof Error ? chromeError.message.split('\n')[0] : 'unknown'}), using bundled Chromium`);
            browser = await chromium.launch(launchOptions);
          }
          break;
        case 'firefox': {
          const firefoxPrefs = getFirefoxUserPrefs();
          const firefoxOverride = getFirefoxLaunchOptions();
          const firefoxOptions = {
            ...nonChromiumOptions,
            ...(firefoxPrefs ? { firefoxUserPrefs: firefoxPrefs } : {}),
          };
          try {
            // A wrong custom path must fail fast: Playwright's default launch timeout is 180 s,
            // which would stall the whole search on a bad environment variable.
            browser = await firefox.launch({ ...firefoxOptions, ...firefoxOverride, ...(firefoxOverride.executablePath ? { timeout: 20000 } : {}) });
          } catch (customError) {
            if (!firefoxOverride.executablePath) throw customError;
            console.log(`[BrowserPool] FIREFOX_EXECUTABLE_PATH=${firefoxOverride.executablePath} could not be launched (${customError instanceof Error ? customError.message.split('\n')[0] : 'unknown'}); Playwright only drives Firefox builds patched with its juggler pipe. Retrying with the bundled Firefox.`);
            browser = await firefox.launch(firefoxOptions);
          }
          break;
        }
        case 'webkit':
          browser = await webkit.launch(nonChromiumOptions);
          break;
        default:
          browser = await chromium.launch(launchOptions);
      }

      this.browsers.set(browserType, browser);
      
      // Clean up old browsers if we have too many
      if (this.browsers.size > this.maxBrowsers) {
        const oldestBrowser = this.browsers.entries().next().value;
        if (oldestBrowser) {
          try {
            await oldestBrowser[1].close();
          } catch (error) {
            console.error(`[BrowserPool] Error closing old browser:`, error);
          }
          this.browsers.delete(oldestBrowser[0]);
        }
      }

      return browser;
    } catch (error) {
      console.error(`[BrowserPool] Failed to launch ${browserType} browser:`, error);
      throw error;
    }
  }

  async closeAll(): Promise<void> {
    console.log(`[BrowserPool] Closing ${this.browsers.size} browsers`);
    
    const closePromises = Array.from(this.browsers.values()).map(browser => 
      browser.close().catch(error => 
        console.error('Error closing browser:', error)
      )
    );
    
    await Promise.all(closePromises);
    this.browsers.clear();
  }

  getLastUsedBrowserType(): string {
    return this.lastUsedBrowserType;
  }
}