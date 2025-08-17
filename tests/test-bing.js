#!/usr/bin/env node

// Test Bing search independently
import { chromium } from 'playwright';
import { runMultiBrowserTest } from './test-utilities.js';

async function testBingWithChannel(channel) {
  const label = channel || 'chromium';
  console.log(`=== TESTING BING SEARCH (${label}) ===`);

  const launchOptions = { headless: true };
  if (channel) launchOptions.channel = channel;

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();

  try {
    const query = 'javascript tutorial';
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=5`;
    console.log(`Navigating to: ${searchUrl}`);

    const startTime = Date.now();
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    const loadTime = Date.now() - startTime;

    const html = await page.content();
    console.log(`✓ Page loaded successfully in ${loadTime}ms`);
    console.log(`✓ HTML length: ${html.length} characters`);

    // Check for bot detection
    const title = await page.title();
    console.log(`✓ Page title: ${title}`);

    if (title.includes('Access Denied') || title.includes('Captcha') || html.includes('unusual traffic')) {
      console.log('❌ Bot detection detected');
      return false;
    }

    // Parse results
    const resultElements = await page.$$('.b_algo');
    console.log(`✓ Found ${resultElements.length} .b_algo elements`);

    if (resultElements.length > 0) {
      console.log('\n--- SAMPLE RESULTS ---');
      for (let i = 0; i < Math.min(3, resultElements.length); i++) {
        const titleElement = await resultElements[i].$('h2 a');
        const snippetElement = await resultElements[i].$('.b_caption p');

        const title = titleElement ? await titleElement.textContent() : 'No title';
        const url = titleElement ? await titleElement.getAttribute('href') : 'No URL';
        const snippet = snippetElement ? await snippetElement.textContent() : 'No snippet';

        console.log(`${i + 1}. ${title?.trim()}`);
        console.log(`   URL: ${url}`);
        console.log(`   Snippet: ${snippet?.trim().substring(0, 100)}...`);
        console.log('');
      }

      console.log(`✅ BING SEARCH (${label}): SUCCESS`);
      return true;
    } else {
      console.log('❌ No results found');
      return false;
    }
  } catch (error) {
    console.log(`❌ BING SEARCH FAILED (${label}): ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

runMultiBrowserTest(testBingWithChannel, 'BING');
