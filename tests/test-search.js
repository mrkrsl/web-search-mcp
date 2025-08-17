#!/usr/bin/env node

// Simple test script to verify search functionality
import { SearchEngine } from '../dist/search-engine.js';
import { runMultiBrowserTest } from './test-utilities.js';

const searchEngine = new SearchEngine();

async function testSearch(channel) {
  console.log(`Testing search functionality (${channel || 'chromium'})...`);
  const searchEngine = new SearchEngine({ channel });
  
  try {
    const result = await searchEngine.search({
      query: 'test search',
      numResults: 3,
      timeout: 15000  // 15 second timeout for testing
    });
    
    console.log(`Search completed with engine: ${result.engine}`);
    console.log(`Found ${result.results.length} results:`);
    
    result.results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.title}`);
      console.log(`   URL: ${r.url}`);
      console.log(`   Description: ${r.description.substring(0, 100)}...`);
      console.log('');
    });
    
    // Clean up
    await searchEngine.closeAll();
    
    return result.results.length > 0;
  } catch (error) {
    console.error('Search test failed:', error);
    await searchEngine.closeAll();
    return false;
  }
}

runMultiBrowserTest(testSearch, 'SEARCH');
