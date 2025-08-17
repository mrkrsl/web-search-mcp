# Web Search MCP Server - API Documentation

## Overview

The Web Search MCP Server provides three tools for web searching and content extraction:

1. **`full-web-search`** - Comprehensive web search with full content extraction (primary tool)
2. **`get-web-search-summaries`** - Lightweight search returning only result snippets
3. **`get-single-web-page-content`** - Extract content from a single web page URL

## Tool: full-web-search

### Description

Search the web and fetch complete page content from top results. This is the most comprehensive web search tool. It searches the web and then follows the resulting links to extract their full page content, providing the most detailed and complete information available.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query to execute (recommended for comprehensive research)"
    },
    "limit": {
      "type": "number",
      "description": "Number of results to return with full content (1-10, default 5)",
      "minimum": 1,
      "maximum": 10,
      "default": 5
    },
    "includeContent": {
      "type": "boolean",
      "description": "Whether to fetch full page content (default: true)",
      "default": true
    },
    "maxContentLength": {
      "type": "number",
      "description": "Maximum characters per result content (0 = no limit). Usually not needed - content length is automatically optimized.",
      "optional": true
    }
  },
  "required": ["query"]
}
```

### Output Schema

Returns formatted text content containing search results with full page content:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Search completed for \"[query]\" with [N] results:\n\n**1. [Title]**\nURL: [url]\nDescription: [description]\n\n**Full Content:**\n[extracted content]\n\n---\n\n..."
    }
  ]
}
```

### Usage Examples

#### Basic Search

```json
{
  "name": "full-web-search",
  "arguments": {
    "query": "TypeScript MCP server"
  }
}
```

#### Search with Custom Parameters

```json
{
  "name": "full-web-search",
  "arguments": {
    "query": "web development best practices",
    "limit": 8,
    "includeContent": true,
    "maxContentLength": 3000
  }
}
```

## Tool: get-web-search-summaries

### Description

Search the web and return only the search result snippets/descriptions without following links to extract full page content. This is a lightweight alternative to full-web-search for when you only need brief search results.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query to execute (lightweight alternative)"
    },
    "limit": {
      "type": "number",
      "description": "Number of search results to return (1-10, default 5)",
      "minimum": 1,
      "maximum": 10,
      "default": 5
    }
  },
  "required": ["query"]
}
```

### Output Schema

Returns formatted text content containing search result summaries:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Search summaries for \"[query]\" with [N] results:\n\n**1. [Title]**\nURL: [url]\nDescription: [description]\n\n---\n\n..."
    }
  ]
}
```

### Usage Examples

#### Basic Summary Search

```json
{
  "name": "get-web-search-summaries",
  "arguments": {
    "query": "machine learning tutorials"
  }
}
```

#### Summary Search with Custom Limit

```json
{
  "name": "get-web-search-summaries",
  "arguments": {
    "query": "React best practices",
    "limit": 3
  }
}
```

## Tool: get-single-web-page-content

### Description

Extract and return the full content from a single web page URL. This tool follows a provided URL and extracts the main page content. Useful for getting detailed content from a specific webpage without performing a search.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri",
      "description": "The URL of the web page to extract content from"
    },
    "maxContentLength": {
      "type": "number",
      "description": "Maximum characters for the extracted content (0 = no limit, undefined = use default limit). Usually not needed - content length is automatically optimized.",
      "optional": true
    }
  },
  "required": ["url"]
}
```

### Output Schema

Returns formatted text content from the specified web page:

```json
{
  "content": [
    {
      "type": "text",
      "text": "**Page Content from: [url]**\n\n**Title:** [title]\n**Word Count:** [count]\n**Content Length:** [length] characters\n\n**Content:**\n[extracted content]"
    }
  ]
}
```

### Usage Examples

#### Basic Page Content Extraction

```json
{
  "name": "get-single-web-page-content",
  "arguments": {
    "url": "https://example.com/article"
  }
}
```

#### Page Content with Length Limit

```json
{
  "name": "get-single-web-page-content",
  "arguments": {
    "url": "https://example.com/long-article",
    "maxContentLength": 2000
  }
}
```

## Response Examples

### full-web-search Response

```json
{
  "content": [
    {
      "type": "text",
      "text": "Search completed for \"TypeScript MCP server\" with 2 results:\n\n**1. Getting Started with TypeScript**\nURL: https://www.typescriptlang.org/docs/\nDescription: TypeScript is a strongly typed programming language that builds on JavaScript...\n\n**Full Content:**\nTypeScript is a strongly typed programming language that builds on JavaScript, giving you better tooling at any scale. This tutorial will help you get started with TypeScript...\n\n---\n\n**2. Model Context Protocol Documentation**\nURL: https://modelcontextprotocol.io/\nDescription: The Model Context Protocol (MCP) is a protocol for AI assistants to connect to external data sources...\n\n**Full Content:**\nThe Model Context Protocol (MCP) enables AI assistants to connect to external data sources and tools...\n\n---\n"
    }
  ]
}
```

### get-web-search-summaries Response

```json
{
  "content": [
    {
      "type": "text",
      "text": "Search summaries for \"machine learning tutorials\" with 3 results:\n\n**1. Machine Learning Crash Course**\nURL: https://developers.google.com/machine-learning/crash-course\nDescription: Google's fast-paced, practical introduction to machine learning...\n\n---\n\n**2. Introduction to Machine Learning**\nURL: https://www.coursera.org/learn/machine-learning\nDescription: Learn about the most effective machine learning techniques...\n\n---\n"
    }
  ]
}
```

### get-single-web-page-content Response

```json
{
  "content": [
    {
      "type": "text",
      "text": "**Page Content from: https://example.com/article**\n\n**Title:** example.com/article\n**Word Count:** 1250\n**Content Length:** 8500 characters\n\n**Content:**\nThis is the extracted content from the web page...\n[full page content continues]"
    }
  ]
}
```

## Error Handling

### Common Error Types

1. **Network Errors**
   - Timeout errors
   - Connection refused
   - DNS resolution failures

2. **Search Errors**
   - Invalid search queries
   - Rate limiting by Google
   - CAPTCHA challenges

3. **Content Extraction Errors**
   - Page access denied (403, 404)
   - Content encoding issues
   - Malformed HTML

### Error Response Format

```json
{
  "error": {
    "message": "Error description",
    "type": "error_type",
    "details": "Additional error information"
  }
}
```

## Rate Limiting

The server implements rate limiting to respect Google's terms of service:

- Maximum 10 requests per minute
- Maximum 5 concurrent content extractions
- Automatic retry with exponential backoff

## Performance Considerations

### Response Times

- Search execution: 1-5 seconds
- Content extraction: 2-10 seconds per URL
- Total response time: 3-15 seconds (depending on result count)

### Content Limits

- Maximum content length: 50KB per page
- Maximum concurrent requests: 5
- Request timeout: 10 seconds

## Integration Examples

### LM Studio Configuration

```json
{
  "mcpServers": {
    "web-search": {
      "command": "web-search-mcp",
      "args": [],
      "env": {
        "GOOGLE_SEARCH_TIMEOUT": "15000",
        "MAX_CONTENT_LENGTH": "75000"
      }
    }
  }
}
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "web-search": {
      "command": "/usr/local/bin/web-search-mcp",
      "args": []
    }
  }
}
```

## Best Practices

### Query Optimization

- Use specific, descriptive queries
- Include relevant keywords
- Avoid overly broad searches

### Result Handling

- Check for content extraction errors
- Handle partial failures gracefully
- Consider result relevance

### Error Recovery

- Implement retry logic for transient errors
- Provide fallback content when extraction fails
- Log errors for debugging

## Troubleshooting

### Common Issues

1. **No Results Returned**
   - Check query validity
   - Verify network connectivity
   - Check for rate limiting

2. **Content Extraction Failures**
   - Verify URL accessibility
   - Check content encoding
   - Review error messages

3. **Performance Issues**
   - Reduce concurrent requests
   - Increase timeout values
   - Check system resources

### Debug Mode

Enable debug logging by setting the environment variable:

```bash
export DEBUG=web-search-mcp:*
```

## Support

For issues and questions, please log an issue on GitHub.
