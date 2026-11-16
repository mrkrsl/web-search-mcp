# Web Search MCP Server for use with Local LLMs

A TypeScript MCP (Model Context Protocol) server that provides comprehensive web search capabilities using direct connections (no API keys required) with multiple tools for different use cases.

## Features

- **Multi-Engine Web Search**: Prioritises configured API providers (SearXNG / Serper / Brave API / Tavily) over the free engines, then DuckDuckGo > Bing > Brave
- **Full Page Content Extraction**: Fetches and extracts complete page content from search results
- **Multiple Search Tools**: Three specialised tools for different use cases
- **Smart Request Strategy**: Switches between playwright browesrs and fast axios requests to ensure results are returned
- **Concurrent Processing**: Extracts content from multiple pages simultaneously

## How It Works

The server provides three specialised tools for different web search needs:

### 1. `full-web-search` (Main Tool)
When a comprehensive search is requested, the server uses an **optimised search strategy**:
1. **Provider APIs** - SearXNG, Serper, Brave Search API or Tavily, used when the matching
   environment variable is set (results are taken as-is, no relevance heuristic)
2. **DuckDuckGo Search** - `POST` to `html.duckduckgo.com` / `lite.duckduckgo.com` after warming up
   a session cookie; `GET` is answered with a bot challenge, `POST` usually is not
3. **DuckDuckGo Browser** - the same URL in real Chrome; used when the HTTP path is walled, since
   DuckDuckGo's JS check passes in a browser but not in axios
4. **Browser-based Bing Search** - Chrome instance (Bing serves poisoned SERPs to the bundled
   headless shell, see `BROWSER_CHANNEL`); the relevance heuristic rejects unrelated results
5. **Browser-based Brave Search** - Chrome first, Firefox on retry (Brave intermittently answers
   with a challenge from datacenter IPs)
5. **Dedicated browser isolation**: Each search engine gets its own browser instance with automatic cleanup
6. **Content extraction**: Tries axios first, then falls back to browser with human behavior simulation
7. **Concurrent processing**: Extracts content from multiple pages simultaneously with timeout protection
8. **HTTP/2 error recovery**: Automatically falls back to HTTP/1.1 when protocol errors occur

### 2. `get-web-search-summaries` (Lightweight Alternative)
For quick search results without full content extraction:
1. Performs the same optimised multi-engine search as `full-web-search`
2. Returns only the search result snippets/descriptions
3. Does not follow links to extract full page content

### 3. `get-single-web-page-content` (Utility Tool)
For extracting content from a specific webpage:
1. Takes a single URL as input
2. Follows the URL and extracts the main page content
3. Removes navigation, ads, and other non-content elements

## Compatibility

This MCP server has been developed and tested with **LM Studio** and **LibreChat**. It has not been tested with other MCP clients.

### Model Compatibility
**Important:** Prioritise using more recent models designated for tool use. 

Older models (even those with tool use specified) may not work or may work erratically. This seems to be the case with Llama and Deepseek. Qwen3 and Gemma 3 currently have the best restults.

- ✅ Works well with: **Qwen3**
- ✅ Works well with: **Gemma 3**
- ✅ Works with: **Llama 3.2**
- ✅ Works with: Recent **Llama 3.1** (e.g 3.1 swallow-8B)
- ✅ Works with: Recent **Deepseek R1** (e.g 0528 works)
- ⚠️ May have issues with: Some versions of **Llama** and **Deepseek R1**
- ❌ May not work with: Older versions of **Llama** and **Deepseek R1**

## Installation (Recommended)

**Requirements:**
- Node.js 18.0.0 or higher
- npm 8.0.0 or higher

1. Download the latest release zip file from the [Releases page](https://github.com/mrkrsl/web-search-mcp/releases)
2. Extract the zip file to a location on your system (e.g., `~/mcp-servers/web-search-mcp/`)
3. **Open a terminal in the extracted folder and run:**
   ```bash
   npm install
   npx playwright install
   npm run build
   ```
   This will create a `node_modules` folder with all required dependencies, install Playwright browsers, and build the project.

   **Note:** You must run `npm install` in the root of the extracted folder (not in `dist/`).
4. Configure your `mcp.json` to point to the extracted `dist/index.js` file:

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/path/to/extracted/web-search-mcp/dist/index.js"]
    }
  }
}
```
**Example paths:**
- macOS/Linux: `~/mcp-servers/web-search-mcp/dist/index.js`
- Windows: `C:\\mcp-servers\\web-search-mcp\\dist\\index.js`

In LibreChat, you can include the MCP server in the librechat.yaml. If you are running LibreChat in Docker, you must first mount your local directory in docker-compose.override.yml.

in `docker-compose.override.yml`:
```yaml
services:
  api:
    volumes:
    - type: bind
      source: /path/to/your/mcp/directory
      target: /app/mcp
```
in `librechat.yaml`:
```yaml
mcpServers:
  web-search:
    type: stdio
    command: node
    args:
    - /app/mcp/web-search-mcp/dist/index.js
    serverInstructions: true
```

**Troubleshooting:**
- If `npm install` fails, try updating Node.js to version 18+ and npm to version 8+
- If `npm run build` fails, ensure you have the latest Node.js version installed
- For older Node.js versions, you may need to use an older release of this project
- **Content Length Issues:** If you experience odd behavior due to content length limits, try setting `"MAX_CONTENT_LENGTH": "10000"`, or another value, in your `mcp.json` environment variables:

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/path/to/web-search-mcp/dist/index.js"],
      "env": {
        "MAX_CONTENT_LENGTH": "10000",
        "BROWSER_HEADLESS": "true",
        "MAX_BROWSERS": "3",
        "BROWSER_FALLBACK_THRESHOLD": "3"
      }
    }
  }
}
```

## Environment Variables

The server supports several environment variables for configuration:

- **`MAX_CONTENT_LENGTH`**: Maximum content length in characters (default: 500000)
- **`DEFAULT_TIMEOUT`**: Default timeout for requests in milliseconds (default: 6000)
- **`MAX_BROWSERS`**: Maximum number of browser instances to maintain (default: 3)
- **`BROWSER_TYPES`**: Comma-separated list of browser types to use (default: 'chromium,firefox', options: chromium, firefox, webkit)
- **`BROWSER_FALLBACK_THRESHOLD`**: Number of axios failures before using browser fallback (default: 3)
- **`BROWSER_CHANNEL`**: Which Chromium build the browser engines launch (default `auto`)
  - `auto` - use the installed Google Chrome when one is found (`/opt/google/chrome/chrome`,
    `/usr/bin/google-chrome`, `chromium`, ...), otherwise the bundled build
  - `chrome` / `msedge` / `brave` - Playwright channel names; an absolute path is also accepted
  - `off` (or `bundled`/`chromium`) - force Playwright's own headless shell

  This matters more than it looks: search engines fingerprint Playwright's bundled headless shell
  and answer it with CAPTCHAs (DuckDuckGo, Brave) or a deliberately unrelated SERP (Bing), while
  the *same IP* through the real Chrome is served normally. Measured on one host, one moment:
  `axios POST html.duckduckgo.com -> HTTP 202 challenge`, `real Chrome GET same URL -> 10 results`.
  User agents are now derived from the launched browser version instead of a hardcoded Chrome/121
  string, because a UA that contradicts the engine is itself a detection signal.
- **`BROWSER_EXTRA_ARGS`**: space separated extra switches appended to every browser launch
  (content-extraction pool and all browser search engines)
- **`FIREFOX_DISABLE_DOH`**: set to `true` to launch Firefox with `network.trr.mode=5` and
  `network.dns.echconfig.enabled=false`

### Censored or middleboxed networks

On networks where middleboxes interfere with TLS to specific hosts, two knobs help:

- Firefox enables DNS-over-HTTPS by default, which makes it negotiate Encrypted Client Hello; if
  those sessions get reset, set `FIREFOX_DISABLE_DOH=true`. Chromium is unaffected here as long as
  it does not use secure DNS (Playwright launches do not).
- `BROWSER_EXTRA_ARGS` appends raw switches. Note Chrome evaluates only one `--disable-features`
  switch and the last occurrence replaces Playwright's own list, so use it deliberately.

Check which layer is actually broken before reaching for these. A measured example: `owasp.org`
resolved to `216.150.16.129` (Vercel) and the TCP handshake to :443 simply timed out, with ICMP
100% loss - that is IP/SNI level filtering, so no browser switch fixes it, while a plain `curl`
request without any ECH support hung identically. Large Cloudflare downloads (1.3 MB) and
`cdnjs` transfers went through the same path fine, so a "response capped after N KiB" symptom should
be tested with a big download before concluding the browser is at fault.

### Search Quality and Engine Selection

- **`ENABLE_RELEVANCE_CHECKING`**: Enable/disable search result quality validation (default: true)
- **`RELEVANCE_THRESHOLD`**: Minimum quality score for search results (0.0-1.0, default: 0.3)
- **`FORCE_MULTI_ENGINE_SEARCH`**: Try all search engines and return best results (default: false)
- **`DEBUG_BROWSER_LIFECYCLE`**: Enable detailed browser lifecycle logging for debugging (default: false)

### Search Providers (recommended)

The free HTML engines (DuckDuckGo, Bing, Brave) are tried without any configuration, but they
frequently refuse requests from hosting/VPS egress IPs: DuckDuckGo answers `HTTP 202` with an
image challenge, Bing returns a poisoned SERP (unrelated links), Brave answers `HTTP 429`.
Configuring one of the providers below makes search deterministic, because the SERP is fetched
by the provider's infrastructure instead of your IP. Engines that have a key are tried **first**
and their results are used as-is (the relevance heuristic is skipped, so credits are not wasted).

| Variable | Provider | Notes |
| --- | --- | --- |
| `SEARXNG_URL` | Self-hosted [SearXNG](https://docs.searxng.org/) | No key. The instance must allow JSON: `search.formats: [html, json]` in `settings.yml` |
| `SERPER_API_KEY` | [Serper.dev](https://serper.dev) Google SERP API | 2 500 free credits, POST `https://google.serper.dev/search` |
| `BRAVE_API_KEY` | [Brave Search API](https://brave.com/search/api/) | 2 000 free queries/month, 1 req/s, `X-Subscription-Token` header |
| `TAVILY_API_KEY` | [Tavily](https://tavily.com) | 1 000 free credits, LLM-oriented results |

```json
"websearch": {
  "command": "node",
  "args": ["/path/to/web-search-mcp/dist/index.js"],
  "env": {
    "BRAVE_API_KEY": "BSA..."
  }
}
```

When DuckDuckGo returns a bot challenge the engine is put on a 15-minute cooldown inside the
server process, so a broken search does not keep hammering the endpoint and deepen the flag.

## Troubleshooting

### Slow Response Times
- **Optimised timeouts**: Default timeout reduced to 6 seconds with concurrent processing for faster results
- **Concurrent extraction**: Content is now extracted from multiple pages simultaneously
- **Reduce timeouts further**: Set `DEFAULT_TIMEOUT=4000` for even faster responses (may reduce success rate)
- **Use fewer browsers**: Set `MAX_BROWSERS=1` to reduce memory usage

### Search Failures
- **"0 results" / "Search engine: None"**: every free engine refused this IP. The tool response
  now includes the reason and the providers you can configure - see
  [Search Providers](#search-providers-recommended). Check with `DEBUG_BROWSER_LIFECYCLE=true`
  and watch the server stderr for the per-engine log lines
- **Check browser installation**: Run `npx playwright install` to ensure browsers are available
- **Try headless mode**: Ensure `BROWSER_HEADLESS=true` (default) for server environments
- **Network restrictions**: Some networks block browser automation - try different network or VPN
- **HTTP/2 issues**: The server automatically handles HTTP/2 protocol errors with fallback to HTTP/1.1

### Search Quality Issues
- **Enable quality checking**: Set `ENABLE_RELEVANCE_CHECKING=true` (enabled by default)
- **Adjust quality threshold**: Set `RELEVANCE_THRESHOLD=0.5` for stricter quality requirements
- **Force multi-engine search**: Set `FORCE_MULTI_ENGINE_SEARCH=true` to try all engines and return the best results

### Memory Usage
- **Automatic cleanup**: Browsers are automatically cleaned up after each operation to prevent memory leaks
- **Limit browsers**: Reduce `MAX_BROWSERS` (default: 3)
- **EventEmitter warnings**: Fixed - browsers are properly closed to prevent listener accumulation

## For Development
```bash
git clone https://github.com/mrkrsl/web-search-mcp.git
cd web-search-mcp
npm install
npx playwright install
npm run build
```

## Development

```bash
npm run dev    # Development with hot reload
npm run build  # Build TypeScript to JavaScript
npm run lint   # Run ESLint
npm run format # Run Prettier
```

## MCP Tools

This server provides three specialised tools for different web search needs:

### 1. `full-web-search` (Main Tool)
The most comprehensive web search tool that:
1. Takes a search query and optional number of results (1-10, default 5)
2. Performs a web search (configured API providers first, then DuckDuckGo, Bing, Brave)
3. Fetches full page content from each result URL with concurrent processing
4. Returns structured data with search results and extracted content
5. **Enhanced reliability**: HTTP/2 error recovery, reduced timeouts, and better error handling

**Example Usage:**
```json
{
  "name": "full-web-search",
  "arguments": {
    "query": "TypeScript MCP server",
    "limit": 3,
    "includeContent": true
  }
}
```

### 2. `get-web-search-summaries` (Lightweight Alternative)
A lightweight alternative for quick search results:
1. Takes a search query and optional number of results (1-10, default 5)
2. Performs the same optimised multi-engine search as `full-web-search`
3. Returns only search result snippets/descriptions (no content extraction)
4. Faster and more efficient for quick research

**Example Usage:**
```json
{
  "name": "get-web-search-summaries",
  "arguments": {
    "query": "TypeScript MCP server",
    "limit": 5
  }
}
```

### 3. `get-single-web-page-content` (Utility Tool)
A utility tool for extracting content from a specific webpage:
1. Takes a single URL as input
2. Follows the URL and extracts the main page content
3. Removes navigation, ads, and other non-content elements
4. Useful for getting detailed content from a known webpage

**Example Usage:**
```json
{
  "name": "get-single-web-page-content",
  "arguments": {
    "url": "https://example.com/article",
    "maxContentLength": 5000
  }
}
```

## Standalone Usage

You can also run the server directly:
```bash
# If running from source
npm start
```

## Documentation

See [API.md](./docs/API.md) for complete technical details.

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Feedback

This is an open source project and we welcome feedback! If you encounter any issues or have suggestions for improvements, please:

- Open an issue on GitHub
- Submit a pull request
