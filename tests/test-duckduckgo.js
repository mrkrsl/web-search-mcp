#!/usr/bin/env node

// Test DuckDuckGo search independently
import { chromium } from 'playwright';

async function testDuckDuckGo() {
  console.log('=== TESTING DUCKDUCKGO SEARCH ===');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  
  const page = await context.newPage();
  
  try {
    const query = 'javascript tutorial';
    
    // Test both URLs
    const urls = [
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&ia=web`,
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    ];
    
    for (let i = 0; i < urls.length; i++) {
      const searchUrl = urls[i];
      const urlType = i === 0 ? 'Main DDG' : 'HTML DDG';
      
      console.log(`\n--- Testing ${urlType} ---`);
      console.log(`Navigating to: ${searchUrl}`);
      
      try {
        const startTime = Date.now();
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        const loadTime = Date.now() - startTime;
        
        await page.waitForTimeout(2000); // Wait for any dynamic content
        
        const html = await page.content();
        console.log(`✓ Page loaded successfully in ${loadTime}ms`);
        console.log(`✓ HTML length: ${html.length} characters`);
        
        // Check for bot detection or error messages
        const title = await page.title();
        console.log(`✓ Page title: ${title}`);
        
        if (html.includes('error-lite') || html.includes('email us') || 
            html.length < 1000 || title === '') {
          console.log('❌ Error page or bot detection detected');
          console.log('Sample HTML:', html.substring(0, 500));
          continue;
        }
        
        // Try multiple selectors for results
        const resultSelectors = [
          '[data-result="result"]',
          '.result',
          '.web-result',
          'article[data-testid="result"]',
          '.results_links'
        ];
        
        let resultElements = [];
        
        for (const selector of resultSelectors) {
          resultElements = await page.$$(selector);
          console.log(`✓ Found ${resultElements.length} elements with selector: ${selector}`);
          if (resultElements.length > 0) {
            break;
          }
        }
        
        if (resultElements.length > 0) {
          console.log(`\n--- SAMPLE RESULTS (${urlType}) ---`);
          for (let j = 0; j < Math.min(3, resultElements.length); j++) {
            // Try multiple title selectors
            const titleSelectors = ['h2 a', '.result__title a', 'a[data-testid="result-title-a"]', 'h3 a'];
            const snippetSelectors = ['[data-result="snippet"]', '.result__snippet', '.result-snippet'];
            
            let title = 'No title';
            let url = 'No URL';
            let snippet = 'No snippet';
            
            for (const titleSel of titleSelectors) {
              const titleElement = await resultElements[j].$(titleSel);
              if (titleElement) {
                title = await titleElement.textContent() || 'No title';
                url = await titleElement.getAttribute('href') || 'No URL';
                break;
              }
            }
            
            for (const snippetSel of snippetSelectors) {
              const snippetElement = await resultElements[j].$(snippetSel);
              if (snippetElement) {
                snippet = await snippetElement.textContent() || 'No snippet';
                break;
              }
            }
            
            console.log(`${j + 1}. ${title.trim()}`);
            console.log(`   URL: ${url}`);
            console.log(`   Snippet: ${snippet.trim().substring(0, 100)}...`);
            console.log('');
          }
          
          console.log(`✅ DUCKDUCKGO SEARCH (${urlType}): SUCCESS`);
          return true;
        } else {
          console.log(`❌ No results found with ${urlType}`);
        }
        
      } catch (error) {
        console.log(`❌ ${urlType} failed: ${error.message}`);
      }
    }
    
    console.log('❌ All DuckDuckGo variants failed');
    return false;

  } catch (error) {
    console.log(`❌ DUCKDUCKGO SEARCH FAILED: ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

testDuckDuckGo().then(success => {
  console.log(`\nDUCKDUCKGO RESULT: ${success ? 'WORKING ✅' : 'FAILED ❌'}`);
  process.exit(success ? 0 : 1);
});
