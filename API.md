# Web Search API Documentation

This API provides HTTP endpoints for web search functionality, converted from the MCP server.

## Base URL

By default, the API server runs on:
```
http://localhost:3000
```

You can change the port by setting the `PORT` environment variable:
```bash
PORT=8080 npm run api
```

## Endpoints

### 1. Health Check

**GET** `/health`

Check if the API server is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "web-search-api",
  "version": "0.3.1"
}
```

---

### 2. Full Web Search

**POST** `/api/search`

Search the web and fetch complete page content from top results.

**Request Body:**
```json
{
  "query": "Python web scraping tutorial",
  "limit": 5,
  "includeContent": true,
  "maxContentLength": 5000
}
```

**Parameters:**
- `query` (required, string): Search query to execute
- `limit` (optional, number, default: 5): Number of results to return (1-10)
- `includeContent` (optional, boolean, default: true): Whether to fetch full page content
- `maxContentLength` (optional, number): Maximum characters per result content (0 = no limit)

**Response:**
```json
{
  "success": true,
  "query": "Python web scraping tutorial",
  "total_results": 5,
  "search_time_ms": 1234,
  "status": "Search engine: Browser Bing; 5 result requested/10 obtained; PDF: 2; 8 followed; Successfully extracted: 5; Failed: 0; Results: 5",
  "results": [
    {
      "title": "Web Scraping with Python",
      "url": "https://example.com/tutorial",
      "description": "A comprehensive guide to web scraping...",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "fetchStatus": "success",
      "fullContent": "Full page content here...",
      "wordCount": 1500,
      "contentTruncated": false
    }
  ]
}
```

**Example with cURL:**
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Python web scraping",
    "limit": 3,
    "includeContent": true
  }'
```

---

### 3. Web Search Summaries (Lightweight)

**POST** `/api/search/summaries`

Search the web and return only search result snippets/descriptions without following links.

**Request Body:**
```json
{
  "query": "React hooks best practices",
  "limit": 10
}
```

**Parameters:**
- `query` (required, string): Search query to execute
- `limit` (optional, number, default: 5): Number of search results to return (1-10)

**Response:**
```json
{
  "success": true,
  "query": "React hooks best practices",
  "total_results": 10,
  "search_time_ms": 567,
  "engine": "Browser Bing",
  "results": [
    {
      "title": "React Hooks Best Practices",
      "url": "https://example.com/react-hooks",
      "description": "Learn the best practices for using React hooks...",
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**Example with cURL:**
```bash
curl -X POST http://localhost:3000/api/search/summaries \
  -H "Content-Type: application/json" \
  -d '{
    "query": "React hooks",
    "limit": 5
  }'
```

---

### 4. Single Page Content Extraction

**POST** `/api/content`

Extract and return the full content from a single web page URL.

**Request Body:**
```json
{
  "url": "https://example.com/article",
  "maxContentLength": 3000
}
```

**Parameters:**
- `url` (required, string): The URL of the web page to extract content from
- `maxContentLength` (optional, number): Maximum characters for the extracted content (0 = no limit)

**Response:**
```json
{
  "success": true,
  "url": "https://example.com/article",
  "title": "example.com/article",
  "content": "Extracted page content here...",
  "contentTruncated": false,
  "originalLength": 5000,
  "wordCount": 800,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**Example with cURL:**
```bash
curl -X POST http://localhost:3000/api/content \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "maxContentLength": 5000
  }'
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message"
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (invalid endpoint)
- `500` - Internal Server Error

**Example Error Response:**
```json
{
  "success": false,
  "error": "Invalid request",
  "message": "query is required and must be a string"
}
```

---

## Running the API Server

### Development Mode (with auto-reload):
```bash
npm run api
```

### Production Mode (after building):
```bash
npm run build
npm run api:build
```

### With Custom Port:
```bash
PORT=8080 npm run api
```

---

## CORS

The API includes CORS headers allowing requests from any origin. For production, you may want to restrict this.

---

## Notes

- The API uses the same search engines as the MCP server (Bing, Brave, DuckDuckGo)
- PDF files are automatically skipped during content extraction
- The API automatically handles browser cleanup after requests
- All timestamps are in ISO 8601 format

