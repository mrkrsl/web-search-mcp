#!/usr/bin/env node

/**
 * Comprehensive test script for all search engines
 * Tests Bing, Brave, and DuckDuckGo search functionality
 */

import { SearchEngine } from '../dist/search-engine.js';
import { runMultiBrowserTest } from './test-utilities.js';

async function testSearchEngine(channel, query = 'javascript programming', numResults = 3) {
  console.log(`🔍 Testing Web Search MCP Server - All Engines (${channel || 'chromium'})`);
  console.log('===============================================');
  console.log(`Query: "${query}"`);
  console.log(`Expected results: ${numResults}`);
  console.log('');

  const searchEngine = new SearchEngine({ channel });

  try {
    const startTime = Date.now();
    const result = await searchEngine.search({
      query,
      numResults,
      timeout: 15000, // 15 second timeout
    });
    const endTime = Date.now();

    console.log(`⚡ Search completed in ${endTime - startTime}ms`);
    console.log(`🎯 Engine used: ${result.engine}`);
    console.log(`📊 Results found: ${result.results.length}`);
    console.log('');

    if (result.results.length === 0) {
      console.log('❌ No results found!');
      return false;
    }

    console.log('📋 Results:');
    console.log('===========');

    result.results.forEach((item, index) => {
      console.log(`${index + 1}. ${item.title}`);
      console.log(`   🔗 ${item.url}`);
      console.log(`   📝 ${item.description.substring(0, 100)}${item.description.length > 100 ? '...' : ''}`);
      console.log('');
    });

    // Validate results
    const validResults = result.results.filter(
      r =>
        r.title &&
        r.title !== 'No title' &&
        r.url &&
        r.url.startsWith('http') &&
        r.description &&
        r.description !== 'No description available'
    );

    console.log(`✅ Valid results: ${validResults.length}/${result.results.length}`);

    if (validResults.length === 0) {
      console.log('❌ No valid results found!');
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Search failed:', error.message);
    return false;
  } finally {
    await searchEngine.closeAll();
  }
}

async function runTests(channel) {
  console.log(`🧪 Running comprehensive search engine tests (${channel || 'chromium'})...`);
  console.log('================================================');

  const testQueries = ['javascript programming', 'climate change effects', 'machine learning basics'];

  let passedTests = 0;
  const totalTests = testQueries.length;

  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    console.log(`\n🔍 Test ${i + 1}/${totalTests}: "${query}"`);
    console.log('─'.repeat(50));

    const success = await testSearchEngine(channel, query, 5);
    if (success) {
      passedTests++;
      console.log('✅ Test PASSED');
    } else {
      console.log('❌ Test FAILED');
    }

    if (i < testQueries.length - 1) {
      console.log('\n⏳ Waiting 2 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n🏁 Test Summary');
  console.log('===============');
  console.log(`Tests passed: ${passedTests}/${totalTests}`);
  console.log(`Success rate: ${Math.round((passedTests / totalTests) * 100)}%`);

  if (passedTests === totalTests) {
    console.log('🎉 All tests passed!');
    return true;
  } else {
    console.log('⚠️  Some tests failed');
    return false;
  }
}

// Run tests across all browsers
runMultiBrowserTest(runTests, 'ALL ENGINES');

export { testSearchEngine, runTests };
