# AGENTS.md

TypeScript MCP server for multi-engine web search and webpage content extraction using Bing, Brave, DuckDuckGo, Playwright, and Cheerio.

## Scope
- Applies to this repo only.
- Keep changes small, direct, repo-shaped.

## Stack
- TypeScript
- Node.js ESM
- MCP server over stdio
- Playwright for browser-backed search/extraction
- Cheerio for HTML parsing

## Key Files
- `src/index.ts`: MCP server, tool registration, request handling
- `src/search-engine.ts`: Bing/Brave/DuckDuckGo search flow and result parsing
- `src/enhanced-content-extractor.ts`: fetch-first page extraction, browser fallback
- `src/browser-pool.ts`: shared Playwright browser lifecycle
- `src/fetch-utils.ts`: HTTP fetch wrapper and fetch errors
- `src/rate-limiter.ts`: concurrency + request throttling
- `tests/`: ad hoc runtime tests, not a formal test framework

## Commands
- `npm run build`: compile to `dist/`
- `npm run lint`: ESLint; warnings exist, errors should not
- `npm test`: basic search smoke test
- `node tests/test-all-engines.js`: broader end-to-end search smoke test
- `node tests/test-bing.js`
- `node tests/test-brave.js`
- `node tests/test-duckduckgo.js`
- `node tests/test-duckduckgo-fetch.js`

## Change Rules
- Prefer targeted fixes over refactors.
- Preserve public tool names and current MCP behavior unless asked.
- For parser bugs, patch the parser/URL cleaner directly; avoid broader rewrites.
- For extraction failures on third-party sites, prefer clearer failure handling over anti-bot evasion work.
- Keep env vars real: do not document or expose config that has no runtime effect.

## Verification
- Run the narrowest relevant check first.
- For code changes, usually run `npm run build`.
- Run `npm run lint` if touching TypeScript.
- Run only the relevant `tests/test-*.js` script when possible.
- If Playwright/browser behavior differs by environment, state that plainly in the result.

## Notes
- `dist/` is build output. Edit `src/`, not `dist/`.
- Search may succeed even when one engine fails; confirm which engine actually served the result.
- `BROWSER_FALLBACK_THRESHOLD` is per-host in the extractor. Do not assume immediate browser fallback.
