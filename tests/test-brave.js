#!/usr/bin/env node

// Test Brave search independently
import { chromium } from 'playwright';
import { runMultiBrowserTest } from './test-utilities.js';

async function testBrave(channel) {
  console.log(`=== TESTING BRAVE SEARCH (${channel || 'chromium'}) ===`);
  const launchOptions = { headless: true };
  if (channel) launchOptions.channel = channel;
  
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  
  const page = await context.newPage();
  
  try {
    const query = 'javascript tutorial';
    const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
    console.log(`Navigating to: ${searchUrl}`);
    
    const startTime = Date.now();
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const loadTime = Date.now() - startTime;
    
    await page.waitForTimeout(2000); // Wait for any dynamic content
    
    const html = await page.content();
    console.log(`✓ Page loaded successfully in ${loadTime}ms`);
    console.log(`✓ HTML length: ${html.length} characters`);
    
    // Check for bot detection
    const title = await page.title();
    console.log(`✓ Page title: ${title}`);
    
    if (title.includes('Access Denied') || title.includes('Captcha') || 
        html.includes('unusual traffic') || html.includes('blocked') ||
        html.length < 1000) {
      console.log('❌ Bot detection detected');
      console.log('Sample HTML:', html.substring(0, 500));
      return false;
    }
    
    // Try multiple selectors for Brave results
    const resultSelectors = [
      '[data-type="web"]',     // Brave specific
      '.result',               // Generic
      '.fdb',                  // Brave format
      '.snippet',              // Alternative
      'div[data-pos]'          // Position-based
    ];
    
    let resultElements = [];
    let workingSelector = '';
    
    for (const selector of resultSelectors) {
      resultElements = await page.$$(selector);
      console.log(`✓ Found ${resultElements.length} elements with selector: ${selector}`);
      if (resultElements.length > 0) {
        workingSelector = selector;
        break;
      }
    }
    
    if (resultElements.length > 0) {
      console.log('\n--- SAMPLE RESULTS ---');
      for (let i = 0; i < Math.min(3, resultElements.length); i++) {
        // Try multiple title selectors for Brave
        const titleSelectors = [
          'h2 a',              // Common format
          '.title a',          // Brave specific
          '.result-title a',   // Alternative
          'a[data-testid]',    // Test ID format
          'h3 a'               // Fallback
        ];
        
        const snippetSelectors = [
          '.snippet-content',   // Brave specific
          '.snippet',          // Generic
          '.description',      // Alternative
          'p'                  // Fallback
        ];
        
        let title = 'No title';
        let url = 'No URL';
        let snippet = 'No snippet';
        
        for (const titleSel of titleSelectors) {
          const titleElement = await resultElements[i].$(titleSel);
          if (titleElement) {
            title = await titleElement.textContent() || 'No title';
            url = await titleElement.getAttribute('href') || 'No URL';
            break;
          }
        }
        
        for (const snippetSel of snippetSelectors) {
          const snippetElement = await resultElements[i].$(snippetSel);
          if (snippetElement) {
            snippet = await snippetElement.textContent() || 'No snippet';
            break;
          }
        }
        
        console.log(`${i + 1}. ${title.trim()}`);
        console.log(`   URL: ${url}`);
        console.log(`   Snippet: ${snippet.trim().substring(0, 100)}...`);
        console.log('');
      }
      
      console.log('✅ BRAVE SEARCH: SUCCESS');
      return true;
    } else {
      console.log('❌ No results found');
      console.log('Sample HTML:', html.substring(0, 1000));
      return false;
    }

  } catch (error) {
    console.log(`❌ BRAVE SEARCH FAILED: ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

runMultiBrowserTest(testBrave, 'BRAVE');
