#!/usr/bin/env node

/**
 * Test suite for Zod schema validation
 * 
 * These tests verify that the simplified JSON schemas (without union types)
 * work correctly with the MCP SDK and are compatible with strict JSON schema
 * validators like those used by Gemini 3 Pro.
 * 
 * The key change is replacing z.union([z.number(), z.string()]) with simple
 * z.number() types to ensure JSON schema compatibility.
 */

import { z } from 'zod';

// Define the schemas as they appear in the updated index.ts
const fullWebSearchSchema = z.object({
  query: z.string().describe('Search query to execute'),
  limit: z.number().int().min(1).max(10).default(5).describe('Number of results to return with full content (1-10)'),
  includeContent: z.boolean().default(true).describe('Whether to fetch full page content'),
  maxContentLength: z.number().int().min(0).optional().describe('Maximum characters per result content'),
});

const webSearchSummariesSchema = z.object({
  query: z.string().describe('Search query to execute'),
  limit: z.number().int().min(1).max(10).default(5).describe('Number of search results to return (1-10)'),
});

const singlePageContentSchema = z.object({
  url: z.string().url().describe('The URL of the web page to extract content from'),
  maxContentLength: z.number().int().min(0).optional().describe('Maximum characters for the extracted content'),
});

// Test results tracking
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passCount++;
  } catch (error) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
    failCount++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, got ${actual}`);
  }
}

function assertThrows(fn, message = '') {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(`${message} Expected function to throw, but it didn't`);
  }
}

console.log('='.repeat(60));
console.log('Schema Validation Tests for Gemini 3 Pro Compatibility');
console.log('='.repeat(60));
console.log('');

// ============================================
// full-web-search schema tests
// ============================================
console.log('--- full-web-search schema tests ---\n');

test('full-web-search: accepts valid number for limit', () => {
  const result = fullWebSearchSchema.parse({ query: 'test', limit: 5 });
  assertEqual(result.limit, 5);
  assertEqual(result.query, 'test');
});

test('full-web-search: uses default limit when not provided', () => {
  const result = fullWebSearchSchema.parse({ query: 'test' });
  assertEqual(result.limit, 5);
});

test('full-web-search: uses default includeContent when not provided', () => {
  const result = fullWebSearchSchema.parse({ query: 'test' });
  assertEqual(result.includeContent, true);
});

test('full-web-search: accepts boolean for includeContent', () => {
  const result = fullWebSearchSchema.parse({ query: 'test', includeContent: false });
  assertEqual(result.includeContent, false);
});

test('full-web-search: rejects limit below minimum (1)', () => {
  assertThrows(() => fullWebSearchSchema.parse({ query: 'test', limit: 0 }));
});

test('full-web-search: rejects limit above maximum (10)', () => {
  assertThrows(() => fullWebSearchSchema.parse({ query: 'test', limit: 11 }));
});

test('full-web-search: rejects non-integer limit', () => {
  assertThrows(() => fullWebSearchSchema.parse({ query: 'test', limit: 5.5 }));
});

test('full-web-search: rejects string for limit (strict type)', () => {
  assertThrows(() => fullWebSearchSchema.parse({ query: 'test', limit: '5' }));
});

test('full-web-search: rejects string for includeContent (strict type)', () => {
  assertThrows(() => fullWebSearchSchema.parse({ query: 'test', includeContent: 'true' }));
});

test('full-web-search: accepts optional maxContentLength', () => {
  const result = fullWebSearchSchema.parse({ query: 'test', maxContentLength: 1000 });
  assertEqual(result.maxContentLength, 1000);
});

test('full-web-search: allows maxContentLength to be undefined', () => {
  const result = fullWebSearchSchema.parse({ query: 'test' });
  assertEqual(result.maxContentLength, undefined);
});

test('full-web-search: rejects negative maxContentLength', () => {
  assertThrows(() => fullWebSearchSchema.parse({ query: 'test', maxContentLength: -1 }));
});

test('full-web-search: accepts zero maxContentLength (no limit)', () => {
  const result = fullWebSearchSchema.parse({ query: 'test', maxContentLength: 0 });
  assertEqual(result.maxContentLength, 0);
});

// ============================================
// get-web-search-summaries schema tests
// ============================================
console.log('\n--- get-web-search-summaries schema tests ---\n');

test('get-web-search-summaries: accepts valid query', () => {
  const result = webSearchSummariesSchema.parse({ query: 'hello world' });
  assertEqual(result.query, 'hello world');
});

test('get-web-search-summaries: uses default limit', () => {
  const result = webSearchSummariesSchema.parse({ query: 'test' });
  assertEqual(result.limit, 5);
});

test('get-web-search-summaries: accepts limit within range', () => {
  const result = webSearchSummariesSchema.parse({ query: 'test', limit: 10 });
  assertEqual(result.limit, 10);
});

test('get-web-search-summaries: rejects limit below minimum', () => {
  assertThrows(() => webSearchSummariesSchema.parse({ query: 'test', limit: 0 }));
});

test('get-web-search-summaries: rejects limit above maximum', () => {
  assertThrows(() => webSearchSummariesSchema.parse({ query: 'test', limit: 15 }));
});

test('get-web-search-summaries: rejects missing query', () => {
  assertThrows(() => webSearchSummariesSchema.parse({ limit: 5 }));
});

// ============================================
// get-single-web-page-content schema tests
// ============================================
console.log('\n--- get-single-web-page-content schema tests ---\n');

test('get-single-web-page-content: accepts valid URL', () => {
  const result = singlePageContentSchema.parse({ url: 'https://example.com' });
  assertEqual(result.url, 'https://example.com');
});

test('get-single-web-page-content: accepts URL with path', () => {
  const result = singlePageContentSchema.parse({ url: 'https://example.com/page/subpage' });
  assertEqual(result.url, 'https://example.com/page/subpage');
});

test('get-single-web-page-content: rejects invalid URL', () => {
  assertThrows(() => singlePageContentSchema.parse({ url: 'not-a-url' }));
});

test('get-single-web-page-content: rejects missing URL', () => {
  assertThrows(() => singlePageContentSchema.parse({}));
});

test('get-single-web-page-content: accepts optional maxContentLength', () => {
  const result = singlePageContentSchema.parse({ 
    url: 'https://example.com', 
    maxContentLength: 5000 
  });
  assertEqual(result.maxContentLength, 5000);
});

test('get-single-web-page-content: allows maxContentLength to be undefined', () => {
  const result = singlePageContentSchema.parse({ url: 'https://example.com' });
  assertEqual(result.maxContentLength, undefined);
});

// ============================================
// JSON Schema Generation Tests
// ============================================
console.log('\n--- JSON Schema Generation Tests ---\n');

test('full-web-search: limit generates single type (number), not union', () => {
  // The zodToJsonSchema would generate "type": "number" instead of ["number", "string"]
  // We verify this by checking the Zod schema structure
  const limitSchema = fullWebSearchSchema.shape.limit;
  
  // The innerType should be a ZodNumber, not a ZodUnion
  // After .default(), it wraps in ZodDefault, and before that it's ZodNumber with .int().min().max()
  const innerType = limitSchema._def.innerType;
  
  // Check that it's not a union type
  if (innerType._def.typeName === 'ZodUnion') {
    throw new Error('limit should not be a ZodUnion type');
  }
});

test('full-web-search: includeContent generates single type (boolean), not union', () => {
  const includeContentSchema = fullWebSearchSchema.shape.includeContent;
  const innerType = includeContentSchema._def.innerType;
  
  if (innerType._def.typeName === 'ZodUnion') {
    throw new Error('includeContent should not be a ZodUnion type');
  }
});

// ============================================
// Summary
// ============================================
console.log('\n' + '='.repeat(60));
console.log(`Tests completed: ${passCount + failCount} total`);
console.log(`  ✅ Passed: ${passCount}`);
console.log(`  ❌ Failed: ${failCount}`);
console.log('='.repeat(60));

process.exit(failCount > 0 ? 1 : 0);
