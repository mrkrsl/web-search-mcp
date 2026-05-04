#!/usr/bin/env node

// Test DuckDuckGo search independently using the same fetch-based path as production
import * as cheerio from 'cheerio';

async function testDuckDuckGoFetch() {
  console.log('=== TESTING DUCKDUCKGO FETCH SEARCH ===');

  try {
    const query = 'javascript tutorial';
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    console.log(`Fetching: ${searchUrl}`);

    const startTime = Date.now();
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    const html = await response.text();
    const loadTime = Date.now() - startTime;

    console.log(`✓ Response status: ${response.status}`);
    console.log(`✓ Page loaded successfully in ${loadTime}ms`);
    console.log(`✓ HTML length: ${html.length} characters`);

    if (!response.ok || html.includes('error-lite') || html.length < 1000) {
      console.log('❌ Error page or bot detection detected');
      console.log('Sample HTML:', html.substring(0, 500));
      return false;
    }

    const $ = cheerio.load(html);
    const resultElements = $('.result');
    console.log(`✓ Found ${resultElements.length} result elements`);

    if (resultElements.length === 0) {
      console.log('❌ No results found');
      console.log('Sample HTML:', html.substring(0, 1000));
      return false;
    }

    console.log('\n--- SAMPLE RESULTS ---');
    resultElements.slice(0, 3).each((index, element) => {
      const titleElement = $(element).find('.result__title a').first();
      const snippetElement = $(element).find('.result__snippet').first();

      const title = titleElement.text().trim() || 'No title';
      const url = titleElement.attr('href') || 'No URL';
      const snippet = snippetElement.text().trim() || 'No snippet';

      console.log(`${index + 1}. ${title}`);
      console.log(`   URL: ${url}`);
      console.log(`   Snippet: ${snippet.substring(0, 100)}...`);
      console.log('');
    });

    console.log('✅ DUCKDUCKGO FETCH SEARCH: SUCCESS');
    return true;
  } catch (error) {
    console.log(`❌ DUCKDUCKGO FETCH SEARCH FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

testDuckDuckGoFetch().then(success => {
  console.log(`\nDUCKDUCKGO FETCH RESULT: ${success ? 'WORKING ✅' : 'FAILED ❌'}`);
  process.exit(success ? 0 : 1);
});
