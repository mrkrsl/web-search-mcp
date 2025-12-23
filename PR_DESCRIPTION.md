# Add HTTP API Server

## Summary

This PR converts the MCP (Model Context Protocol) server into an HTTP REST API, making it accessible via standard HTTP endpoints while maintaining all existing functionality.

## Changes

### New Files
- **`src/api.ts`** - Express HTTP server with REST API endpoints
- **`API.md`** - Complete API documentation with examples

### Modified Files
- **`package.json`** - Added Express dependencies and new npm scripts

## Features

### API Endpoints

1. **`GET /health`** - Health check endpoint
2. **`POST /api/search`** - Full web search with content extraction
3. **`POST /api/search/summaries`** - Lightweight search summaries (no content extraction)
4. **`POST /api/content`** - Single page content extraction

### Key Features
- ✅ RESTful API with JSON responses
- ✅ CORS enabled for cross-origin requests
- ✅ Error handling middleware
- ✅ Request validation
- ✅ Same search engine functionality (Bing, Brave, DuckDuckGo)
- ✅ Automatic browser cleanup
- ✅ Graceful shutdown handling

## Dependencies Added

- `express` - Web framework
- `@types/express` - TypeScript types for Express

## New NPM Scripts

- `npm run api` - Run API server in development mode
- `npm run api:build` - Build and run API server in production mode

## Usage

### Development
```bash
npm install
npm run api
```

### Production
```bash
npm run build
npm run api:build
```

### Custom Port
```bash
PORT=8080 npm run api
```

## API Base URL

Default: `http://localhost:3000`

## Example Request

```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Python tutorial",
    "limit": 5,
    "includeContent": true
  }'
```

## Backward Compatibility

The original MCP server (`src/index.ts`) remains unchanged and fully functional. This PR adds the API as an additional interface option.

## Testing

- [x] API server starts successfully
- [x] Health check endpoint works
- [x] All three main endpoints implemented
- [x] Error handling implemented
- [x] CORS headers configured
- [x] Request validation added

## Documentation

Complete API documentation is available in `API.md` with:
- Endpoint descriptions
- Request/response examples
- Error handling details
- cURL examples

