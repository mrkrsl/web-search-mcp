# Web Search MCP Server for use with Local LLMs

A TypeScript MCP (Model Context Protocol) server that provides comprehensive web search capabilities using direct connections (no API keys required) with multiple tools for different use cases.

## Fork Changes

This fork includes a few targeted changes:

- Replaced `axios` with native `fetch`
- Logs are routed away from stdout so `StdioServerTransport` does not corrupt MCP responses
- `full-web-search` now respects the `maxContentLength` argument
- Timed-out extractions now cancel underlying work and clean up browser contexts properly
- Browser fallback is now gated per host via `BROWSER_FALLBACK_THRESHOLD` instead of jumping to Playwright immediately
- Browser engines that fail to launch are disabled for the rest of the process so search can fall back cleanly
- Bing redirect URLs are decoded more reliably before content extraction
- Rate limiting now runs inside the concurrency gate, avoiding races under parallel load
- Search result URL validation is stricter to avoid junk/internal links
- Added `npm test` plus a fetch-based DuckDuckGo test path

## Features

- **Multi-Engine Web Search**: Prioritises Bing > Brave > DuckDuckGo for optimal reliability and performance
- **Full Page Content Extraction**: Fetches and extracts complete page content from search results
- **Multiple Search Tools**: Three specialised tools for different use cases
- **Smart Request Strategy**: Uses fast native `fetch` requests first, then falls back to browser-based extraction if bot detection is encountered
- **Concurrent Processing**: Extracts content from multiple pages simultaneously

## How It Works

The server provides three specialised tools for different web search needs:

### 1. `full-web-search` (Main Tool)
When a comprehensive search is requested, the server uses an **optimised search strategy**:
1. **Browser-based Bing Search** - Primary method using dedicated Chromium instance
2. **Browser-based Brave Search** - Secondary option using dedicated Firefox instance
3. **Fetch DuckDuckGo Search** - Final fallback using traditional HTTP
4. **Dedicated browser isolation**: Each search engine gets its own browser instance with automatic cleanup
5. **Content extraction**: Tries `fetch` first, then falls back to browser with human behavior simulation
6. **Concurrent processing**: Extracts content from multiple pages simultaneously with timeout protection
7. **HTTP/2 error recovery**: Automatically falls back to HTTP/1.1 when protocol errors occur

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
- **`BROWSER_FALLBACK_THRESHOLD`**: Per-host number of qualifying fetch failures before using browser fallback (default: 3)

### Search Quality and Engine Selection

- **`ENABLE_RELEVANCE_CHECKING`**: Enable/disable search result quality validation (default: true)
- **`RELEVANCE_THRESHOLD`**: Minimum quality score for search results (0.0-1.0, default: 0.3)
- **`FORCE_MULTI_ENGINE_SEARCH`**: Try all search engines and return best results (default: false)
- **`DEBUG_BROWSER_LIFECYCLE`**: Enable detailed browser lifecycle logging for debugging (default: false)

## Troubleshooting

### Slow Response Times
- **Optimised timeouts**: Default timeout reduced to 6 seconds with concurrent processing for faster results
- **Concurrent extraction**: Content is now extracted from multiple pages simultaneously
- **Reduce timeouts further**: Set `DEFAULT_TIMEOUT=4000` for even faster responses (may reduce success rate)
- **Use fewer browsers**: Set `MAX_BROWSERS=1` to reduce memory usage

### Search Failures
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
2. Performs a web search (tries Bing, then Brave, then DuckDuckGo if needed)
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
