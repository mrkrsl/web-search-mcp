# HTTP Mode Usage

## Starting the Server

### HTTP Mode (for Python agents, web clients)
```bash
# Start on default port 8000
npm run start:http

# Or with custom port
node ./dist/index.js --http --port=3000

# Development mode with hot reload
npm run dev:http
```

### Stdio Mode (for MCP clients like LM Studio, LibreChat)
```bash
# Default stdio mode
npm start

# Development mode
npm run dev
```

## Endpoints

When running in HTTP mode, the server provides:

- **Health Check**: `GET http://127.0.0.1:8000/health`
- **MCP Endpoint**: `http://127.0.0.1:8000/mcp` (supports both GET for SSE and POST for direct requests)

Here is a curl command to test

```bash
curl -X POST http://127.0.0.1:8000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get-web-search-summaries",
      "arguments": {
        "query": "AI news 2024",
        "limit": 2
      }
    }
  }'
```


## Run LocalLLM with LMStudio Python Example

Install [LMStudio](https://lmstudio.ai/home)

Then run a tool enabled model. For example: [gpt-oss](https://lmstudio.ai/models/openai/gpt-oss-20b)

After starting the MCP server locally, then run `python test_openai_websearch.py`

The example uses [openai-agents](https://github.com/openai/openai-agents-python)

## Available Tools

1. **`full-web-search`** - Comprehensive web search with full page content
2. **`get-web-search-summaries`** - Lightweight search results without full content  
3. **`get-single-web-page-content`** - Extract content from a specific webpage

## Configuration

The server supports both transport modes:
- **Stdio**: Traditional MCP communication via stdin/stdout
- **HTTP**: RESTful API with Server-Sent Events (SSE) support

Use HTTP mode when integrating with web applications, Python agents, or any system that can make HTTP requests. Use stdio mode for traditional MCP clients.