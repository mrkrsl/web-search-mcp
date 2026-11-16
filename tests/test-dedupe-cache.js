#!/usr/bin/env node

/**
 * Offline regression tests for the parts of the server that do not need the network:
 * URL de-duplication, the TTL caches, single-flight, the batched link-following plan, and the
 * per-engine throttle. These run in milliseconds and never touch a search engine, so they catch a
 * broken heuristic before it costs an hour of bot walls.
 */

import assert from 'node:assert/strict';
import { normalizeForDedupe, envInt, envTtlMinutes } from '../dist/utils.js';
import { TtlCache, SingleFlight } from '../dist/cache.js';
import { SearchEngine } from '../dist/search-engine.js';
import { EnhancedContentExtractor } from '../dist/enhanced-content-extractor.js';
import { BrowserPool } from '../dist/browser-pool.js';

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ❌ ${name}\n     ${error instanceof Error ? error.message : error}`);
  }
}

const result = (url) => ({ title: `page ${url}`, url, description: 'snippet' });

console.log('🧪 Offline tests: de-duplication, caching, batching, throttling');
console.log('===============================================================');

// ---------------------------------------------------------------- URL normalisation
console.log('\nURL normalisation');

await test('collapses scheme, www, trailing slash and fragment', () => {
  const canonical = normalizeForDedupe('https://example.com/a/b');
  for (const variant of [
    'http://example.com/a/b',
    'https://www.example.com/a/b',
    'https://example.com/a/b/',
    'https://example.com/a/b/#section',
    'https://example.com:443/a/b',
  ]) {
    assert.equal(normalizeForDedupe(variant), canonical, variant);
  }
});

await test('drops tracking parameters, keeps meaningful ones', () => {
  const canonical = normalizeForDedupe('https://example.com/search?q=ssrf');
  assert.equal(normalizeForDedupe('https://example.com/search?q=ssrf&utm_source=nl&fbclid=abc&ref=twitter'), canonical);
  assert.notEqual(normalizeForDedupe('https://example.com/search?q=sqli'), canonical, 'a different q= must stay a different page');
});

await test('keeps genuinely different pages apart', () => {
  assert.notEqual(normalizeForDedupe('https://example.com/a'), normalizeForDedupe('https://example.com/b'));
  assert.notEqual(normalizeForDedupe('https://a.example.com/x'), normalizeForDedupe('https://b.example.com/x'));
  assert.notEqual(normalizeForDedupe('https://example.com/blog'), normalizeForDedupe('https://example.com/blogg'));
});

await test('unparsable input is returned untouched (never collapses into another URL)', () => {
  assert.equal(normalizeForDedupe('not a url'), 'not a url');
  assert.equal(normalizeForDedupe('ftp://example.com/x'), 'ftp://example.com/x');
});

await test('env helpers ignore garbage instead of producing NaN', () => {
  process.env.TS_INT = '12';
  assert.equal(envInt('TS_INT', 5), 12);
  process.env.TS_INT = 'abc';
  assert.equal(envInt('TS_INT', 5), 5);
  process.env.TS_INT = '-3';
  assert.equal(envInt('TS_INT', 7), 7);
  process.env.TS_TTL = '2';
  assert.equal(envTtlMinutes('TS_TTL', 30), 120000);
  process.env.NO_CACHE = 'true';
  assert.equal(envTtlMinutes('TS_TTL', 30), 0, 'NO_CACHE=true must disable caching');
  delete process.env.NO_CACHE;
  delete process.env.TS_INT;
  delete process.env.TS_TTL;
});

// ---------------------------------------------------------------- TtlCache / SingleFlight
console.log('\nTtlCache');

await test('hit, expiry and re-read', async () => {
  const cache = new TtlCache(10, 40);
  cache.set('k', 'v');
  assert.equal(cache.get('k'), 'v');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(cache.get('k'), undefined, 'entry must expire');
});

await test('ttl 0 means caching is off', () => {
  const cache = new TtlCache(10, 0);
  cache.set('k', 'v');
  assert.equal(cache.enabled, false);
  assert.equal(cache.get('k'), undefined);
});

await test('per-entry TTL overrides the default (empty SERPs expire fast)', async () => {
  const cache = new TtlCache(10, 60000);
  cache.set('quick', [], 15);
  cache.set('slow', [], 60000);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(cache.get('quick'), undefined, 'the short TTL must have expired');
  assert.deepEqual(cache.get('slow'), [], 'the default TTL must still be live');
});

await test('LRU bound evicts the least recently used entry', () => {
  const cache = new TtlCache(2, 60000);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // touch 'a' so 'b' becomes the oldest
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined, "'b' should have been evicted");
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

console.log('\nSingleFlight');

await test('concurrent calls with one key run the work once', async () => {
  const flight = new SingleFlight();
  let calls = 0;
  const work = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return 'x';
  };
  const [a, b, c] = await Promise.all([flight.run('k', work), flight.run('k', work), flight.run('k', work)]);
  assert.deepEqual([a, b, c], ['x', 'x', 'x']);
  assert.equal(calls, 1, `work ran ${calls} times`);
});

await test('a settled key is not sticky: the next call does the work again', async () => {
  const flight = new SingleFlight();
  let calls = 0;
  const work = async () => ++calls;
  await flight.run('k', work);
  await flight.run('k', work);
  assert.equal(calls, 2);
});

await test('rejections are shared and do not poison the key', async () => {
  const flight = new SingleFlight();
  const boom = async () => { throw new Error('nope'); };
  await assert.rejects(() => flight.run('k', boom));
  assert.equal(await flight.run('k', async () => 'ok'), 'ok');
});

// ---------------------------------------------------------------- search-level caching + dedup
console.log('\nSearchEngine de-duplication and result cache (stubbed engine chain)');

await test('duplicate SERP entries collapse to the highest ranked variant', async () => {
  const engine = new SearchEngine();
  engine.runEngineChain = async () => ({
    engine: 'Stub',
    results: [
      result('https://portswigger.net/web-security/ssrf'),
      result('http://www.portswigger.net/web-security/ssrf/'),
      result('https://portswigger.net/web-security/ssrf#how-to-bypass'),
      result('https://owasp.org/www-community/attacks/Server_Side_Request_Forgery?utm_source=ddg'),
    ],
  });

  const out = await engine.search({ query: 'stub dedupe query', numResults: 5 });
  assert.equal(out.results.length, 2, `expected 2 unique results, got ${out.results.length}`);
  assert.equal(out.results[0].url, 'https://portswigger.net/web-security/ssrf');
  await engine.closeAll();
});

await test('a repeated query is answered from cache without walking the engines again', async () => {
  const engine = new SearchEngine();
  let chainRuns = 0;
  engine.runEngineChain = async () => {
    chainRuns++;
    return { engine: 'Stub', results: [result('https://example.com/a')] };
  };

  const first = await engine.search({ query: 'stub cache query', numResults: 3 });
  const second = await engine.search({ query: 'STUB CACHE QUERY', numResults: 3 });
  assert.equal(chainRuns, 1, `engine chain ran ${chainRuns} times`);
  assert.equal(second.engine, 'Stub (cached)');
  assert.equal(second.results.length, first.results.length);
  await engine.closeAll();
});

await test('concurrent identical queries share one engine run', async () => {
  const engine = new SearchEngine();
  let chainRuns = 0;
  engine.runEngineChain = async () => {
    chainRuns++;
    await new Promise((r) => setTimeout(r, 25));
    return { engine: 'Stub', results: [result('https://example.com/b')] };
  };

  const out = await Promise.all([
    engine.search({ query: 'stub flight query', numResults: 2 }),
    engine.search({ query: 'stub flight query', numResults: 2 }),
  ]);
  assert.equal(chainRuns, 1, `engine chain ran ${chainRuns} times`);
  assert.equal(out[1].results.length, 1);
  await engine.closeAll();
});

await test('NO_CACHE=true makes every call go to the engines', async () => {
  process.env.NO_CACHE = 'true';
  const engine = new SearchEngine();
  let chainRuns = 0;
  engine.runEngineChain = async () => {
    chainRuns++;
    return { engine: 'Stub', results: [result('https://example.com/c')] };
  };
  await engine.search({ query: 'stub nocache query', numResults: 2 });
  await engine.search({ query: 'stub nocache query', numResults: 2 });
  assert.equal(chainRuns, 2, 'nothing may be cached under NO_CACHE=true');
  delete process.env.NO_CACHE;
  await engine.closeAll();
});

// ---------------------------------------------------------------- follow planning + batching
console.log('\nLink following plan (stubbed extractor)');

const mixedResults = [
  result('https://example.com/one'),
  result('https://example.com/one?utm_campaign=x'),
  result('https://whitepaper.example.com/report.pdf'),
  result('http://www.example.com/one/'),
  result('https://example.com/two'),
  result('https://example.com/three'),
  result('https://example.com/four'),
  result('https://example.com/five'),
  result('https://example.com/six'),
  result('https://example.com/seven'),
];

await test('planFollows drops PDFs and URL variants of the same page', () => {
  const extractor = new EnhancedContentExtractor();
  const plan = extractor.planFollows(mixedResults, 2);
  assert.equal(plan.nonPdf, 9, 'one PDF result filtered');
  assert.equal(plan.unique, 7, 'three variants of /one collapsed into one');
  assert.equal(plan.queue.length, 6, 'candidate cap for targetCount=2 is 3x');
  assert.deepEqual(plan.queue.map((r) => r.url).slice(0, 3), [
    'https://example.com/one',
    'https://example.com/two',
    'https://example.com/three',
  ]);
});

await test('a healthy SERP costs exactly `limit` page loads, not 2x', async () => {
  const extractor = new EnhancedContentExtractor();
  const fetched = [];
  extractor.extractContent = async ({ url }) => {
    fetched.push(url);
    return 'content '.repeat(50);
  };

  const out = await extractor.extractContentForResultsDetailed(mixedResults, 2);
  assert.equal(out.stats.fetched, 2, `fetched ${out.stats.fetched} pages for limit=2`);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].url, 'https://example.com/one');
  assert.equal(out.results[1].url, 'https://example.com/two');
  assert.equal(out.results.every((r) => r.fetchStatus === 'success'), true);
});

await test('failures are backfilled from the rest of the queue, in rank order', async () => {
  const extractor = new EnhancedContentExtractor();
  const fetched = [];
  extractor.extractContent = async ({ url }) => {
    fetched.push(url);
    if (url.endsWith('/one') || url.endsWith('/two')) throw new Error('HTTP 403 Blocked');
    return 'good content here';
  };

  const out = await extractor.extractContentForResultsDetailed(mixedResults, 2);
  assert.equal(out.stats.fetched, 4, `expected 2 failed + 2 backfill fetches, got ${out.stats.fetched}`);
  assert.equal(out.results.length, 2);
  assert.deepEqual(out.results.map((r) => r.url), ['https://example.com/three', 'https://example.com/four']);
});

await test('the queue is the backstop: a long batch of failures stops at the candidate cap', async () => {
  const extractor = new EnhancedContentExtractor();
  let calls = 0;
  extractor.extractContent = async () => {
    calls++;
    throw new Error('Bot protection interstitial detected');
  };

  const out = await extractor.extractContentForResultsDetailed(mixedResults, 2);
  assert.equal(calls, out.stats.candidates, `followed ${calls} links, candidates were ${out.stats.candidates}`);
  assert.equal(calls, 6, 'the queue cap bounds how far a failing SERP is chased');
  assert.equal(out.results.length, 2, 'failed results are still reported so the caller sees why');
  assert.equal(out.stats.failed, 6, 'stats count the pages fetched, not the pages returned');
  assert.equal(out.results.every((r) => r.fetchStatus === 'error'), true);
});

await test('targetCount 0 fetches nothing', async () => {
  const extractor = new EnhancedContentExtractor();
  let calls = 0;
  extractor.extractContent = async () => {
    calls++;
    return 'x';
  };
  const out = await extractor.extractContentForResultsDetailed(mixedResults, 0);
  assert.equal(calls, 0);
  assert.equal(out.results.length, 0);
});

// ---------------------------------------------------------------- page cache
console.log('\nPage cache (stubbed extraction)');

await test('the same page is fetched once, whatever URL variant asked for it', async () => {
  const extractor = new EnhancedContentExtractor();
  let calls = 0;
  extractor.extractUncached = async ({ url }) => {
    calls++;
    return `body of ${url}`;
  };

  const first = await extractor.extractContent({ url: 'https://example.com/article?utm_source=x' });
  const second = await extractor.extractContent({ url: 'http://www.example.com/article/' });
  assert.equal(calls, 1, `extraction ran ${calls} times for one page`);
  assert.equal(first, second);
});

await test('a per-request maxContentLength truncates the cached copy, the cache keeps the full one', async () => {
  const extractor = new EnhancedContentExtractor();
  let calls = 0;
  extractor.extractUncached = async () => {
    calls++;
    return 'abcdefghij'.repeat(10);
  };

  const short = await extractor.extractContent({ url: 'https://example.com/len1', maxContentLength: 20 });
  const whole = await extractor.extractContent({ url: 'https://example.com/len1' });
  assert.equal(short.length, 20);
  assert.ok(whole.length > 20, 'cached entry must not be shortened by the first caller');
  assert.equal(calls, 1, `extraction ran ${calls} times`);
});

await test('a request above MAX_CONTENT_LENGTH bypasses the cache instead of returning a short copy', async () => {
  const extractor = new EnhancedContentExtractor();
  let calls = 0;
  extractor.extractUncached = async () => {
    calls++;
    return 'x'.repeat(10);
  };

  await extractor.extractContent({ url: 'https://example.com/big' });
  await extractor.extractContent({ url: 'https://example.com/big', maxContentLength: 900000 });
  assert.equal(calls, 2, 'the oversized request must not be served from the capped cache entry');
});

await test('a failed URL is remembered briefly and reported with its original reason', async () => {
  const extractor = new EnhancedContentExtractor();
  let calls = 0;
  extractor.extractUncached = async ({ url }) => {
    calls++;
    throw new Error(`Could not extract content from ${url}: bot protection interstitial`);
  };

  const url = 'https://www.reddit.com/r/netsec/top.json';
  await assert.rejects(() => extractor.extractContent({ url }));
  await assert.rejects(
    () => extractor.extractContent({ url }),
    (error) => {
      assert.match(error.message, /interstitial/, 'the reason must survive the cache');
      assert.match(error.message, /same failure \d+s ago/);
      return true;
    },
  );
  assert.equal(calls, 1, 'the wall was hit once, not twice');
});

await test('NO_CACHE=true refetches the page on every call', async () => {
  process.env.NO_CACHE = 'true';
  const extractor = new EnhancedContentExtractor();
  let calls = 0;
  extractor.extractUncached = async () => {
    calls++;
    return 'body';
  };
  await extractor.extractContent({ url: 'https://example.com/nocache' });
  await extractor.extractContent({ url: 'https://example.com/nocache' });
  assert.equal(calls, 2);
  delete process.env.NO_CACHE;
});

// ---------------------------------------------------------------- browser idle close
console.log('\nBrowserPool idle close (fake browsers, nothing launched)');

const fakeBrowser = (log, name) => ({
  isConnected: () => true,
  close: async () => { log.push(name); },
});

await test('a browser unused past BROWSER_IDLE_TIMEOUT_SECONDS is released, a fresh one is kept', async () => {
  process.env.BROWSER_IDLE_TIMEOUT_SECONDS = '1';
  const pool = new BrowserPool();
  const closed = [];
  pool.browsers.set('chromium', fakeBrowser(closed, 'chromium'));
  pool.browsers.set('firefox', fakeBrowser(closed, 'firefox'));
  pool.lastUsedAt.set('chromium', Date.now() - 5000); // stale
  pool.lastUsedAt.set('firefox', Date.now());         // just used

  const n = await pool.closeIdleBrowsers();
  assert.equal(n, 1, `closed ${n}, expected only the stale one`);
  assert.deepEqual(closed, ['chromium']);
  assert.equal(pool.size, 1, 'the busy browser must stay in the pool');
  await pool.closeAll();
  assert.equal(pool.size, 0, 'closeAll empties the pool');
  delete process.env.BROWSER_IDLE_TIMEOUT_SECONDS;
});

await test('BROWSER_IDLE_TIMEOUT_SECONDS=0 switches idle close off', async () => {
  process.env.BROWSER_IDLE_TIMEOUT_SECONDS = '0';
  const pool = new BrowserPool();
  const closed = [];
  pool.browsers.set('chromium', fakeBrowser(closed, 'chromium'));
  pool.lastUsedAt.set('chromium', Date.now() - 3_600_000);
  assert.equal(pool.idleTimer, undefined, 'no sweeper may be scheduled when disabled');
  assert.equal(await pool.closeIdleBrowsers(), 0);
  assert.deepEqual(closed, []);
  await pool.closeAll();
  delete process.env.BROWSER_IDLE_TIMEOUT_SECONDS;
});

await test('the default idle window is 30 minutes', () => {
  const pool = new BrowserPool();
  assert.equal(pool.idleTimeoutMs, 1_800_000, `idleTimeoutMs=${pool.idleTimeoutMs}`);
  // the sweep timer is unref'd, so it cannot keep the server alive on its own
  assert.ok(pool.idleTimer && pool.idleTimer.hasRef?.() === false, 'idle timer must be unref\'d');
  void pool.closeAll();
});

// ---------------------------------------------------------------- throttle
console.log('\nEngine throttle');

await test('ENGINE_MIN_INTERVAL_MS spaces repeat requests to the same engine', async () => {
  process.env.ENGINE_MIN_INTERVAL_MS = '150';
  const engine = new SearchEngine();
  await engine.throttleEngine('DuckDuckGo Browser');
  const start = Date.now();
  await engine.throttleEngine('DuckDuckGo Browser');
  const waited = Date.now() - start;
  assert.ok(waited >= 100, `second request waited only ${waited}ms`);

  // a different engine is not held back by an unrelated one
  const beforeOther = Date.now();
  await engine.throttleEngine('Browser Bing');
  assert.ok(Date.now() - beforeOther < 100, 'a fresh engine should not wait');
  delete process.env.ENGINE_MIN_INTERVAL_MS;
  await engine.closeAll();
});

await test('ENGINE_MIN_INTERVAL_MS=0 disables waiting', async () => {
  process.env.ENGINE_MIN_INTERVAL_MS = '0';
  const engine = new SearchEngine();
  await engine.throttleEngine('Stub');
  const start = Date.now();
  await engine.throttleEngine('Stub');
  assert.ok(Date.now() - start < 50);
  delete process.env.ENGINE_MIN_INTERVAL_MS;
  await engine.closeAll();
});

// ---------------------------------------------------------------- summary
console.log('\n🏁 Summary');
console.log('============');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failures.length}`);
if (failures.length) {
  failures.forEach(({ name, error }) => console.error(`\n❌ ${name}\n${error instanceof Error ? error.stack : error}`));
  process.exit(1);
}
console.log('🎉 All offline tests passed!');
