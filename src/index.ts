#!/usr/bin/env node
console.log('Web Search MCP Server starting...');

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { SearchEngine } from './search-engine.js';
import { EnhancedContentExtractor } from './enhanced-content-extractor.js';
import { WebSearchToolInput, WebSearchToolOutput, SearchResult } from './types.js';
import { isPdfUrl } from './utils.js';

class WebSearchMCPServer {
  private server: McpServer;
  private searchEngine: SearchEngine;
  private contentExtractor: EnhancedContentExtractor;

  constructor() {
    this.server = new McpServer({
      name: 'web-search-mcp',
      version: '0.3.1',
    });

    this.searchEngine = new SearchEngine();
    this.contentExtractor = new EnhancedContentExtractor();

    this.setupTools();
    this.setupGracefulShutdown();
  }

  private setupTools(): void {
    // Register the main web search tool (primary choice for comprehensive searches)
    this.server.tool(
      'full-web-search',
      'Search the web and fetch complete page content from top results. This is the most comprehensive web search tool. It searches the web and then follows the resulting links to extract their full page content, providing the most detailed and complete information available. Use get-web-search-summaries for a lightweight alternative.',
      {
        query: z.string().describe('Search query to execute (recommended for comprehensive research)'),
        limit: z.union([z.number(), z.string()]).transform((val) => {
          const num = typeof val === 'string' ? parseInt(val, 10) : val;
          if (isNaN(num) || num < 1 || num > 10) {
            throw new Error('Invalid limit: must be a number between 1 and 10');
          }
          return num;
        }).default(5).describe('Number of results to return with full content (1-10)'),
        includeContent: z.union([z.boolean(), z.string()]).transform((val) => {
          if (typeof val === 'string') {
            return val.toLowerCase() === 'true';
          }
          return Boolean(val);
        }).default(true).describe('Whether to fetch full page content (default: true)'),
        maxContentLength: z.union([z.number(), z.string()]).transform((val) => {
          const num = typeof val === 'string' ? parseInt(val, 10) : val;
          if (isNaN(num) || num < 0) {
            throw new Error('Invalid maxContentLength: must be a non-negative number');
          }
          return num;
        }).optional().describe('Maximum characters per result content (0 = no limit). Usually not needed - content length is automatically optimized.'),
      },
      async (args: unknown) => {
        console.log(`[MCP] Tool call received: full-web-search`);
        console.log(`[MCP] Raw arguments:`, JSON.stringify(args, null, 2));

        try {
          // Convert and validate arguments
          const validatedArgs = this.validateAndConvertArgs(args);
          
          // Auto-detect model types based on parameter formats
          // Llama models often send string parameters and struggle with large responses
          const isLikelyLlama = typeof args === 'object' && args !== null && (
            ('limit' in args && typeof (args as Record<string, unknown>).limit === 'string') ||
            ('includeContent' in args && typeof (args as Record<string, unknown>).includeContent === 'string')
          );
          
          // Detect models that handle large responses well (Qwen, Gemma, recent Deepseek)
          const isLikelyRobustModel = typeof args === 'object' && args !== null && (
            ('limit' in args && typeof (args as Record<string, unknown>).limit === 'number') &&
            ('includeContent' in args && typeof (args as Record<string, unknown>).includeContent === 'boolean')
          );
          
          // Only apply auto-limit if maxContentLength is not explicitly set (including 0)
          const hasExplicitMaxLength = typeof args === 'object' && args !== null && 'maxContentLength' in args;
          
          if (!hasExplicitMaxLength && isLikelyLlama) {
            console.log(`[MCP] Detected potential Llama model (string parameters), applying content length limit`);
            validatedArgs.maxContentLength = 2000; // Reasonable limit for Llama
          }
          
          // For robust models (Qwen, Gemma, recent Deepseek), remove maxContentLength if it's set to a low value
          if (isLikelyRobustModel && validatedArgs.maxContentLength && validatedArgs.maxContentLength < 5000) {
            console.log(`[MCP] Detected robust model (numeric parameters), removing unnecessary content length limit`);
            validatedArgs.maxContentLength = undefined;
          }
          
          console.log(`[MCP] Validated args:`, JSON.stringify(validatedArgs, null, 2));
          
          console.log(`[MCP] Starting web search...`);
          const result = await this.handleWebSearch(validatedArgs);
          
          console.log(`[MCP] Search completed, found ${result.results.length} results`);
          
          // Format the results as a comprehensive text response
          let responseText = `Search completed for "${result.query}" with ${result.total_results} results:\n\n`;
          
          // Add status line if available
          if (result.status) {
            responseText += `**Status:** ${result.status}\n\n`;
          }
          
          const maxLength = validatedArgs.maxContentLength;
          
          result.results.forEach((searchResult, idx) => {
            responseText += `**${idx + 1}. ${searchResult.title}**\n`;
            responseText += `URL: ${searchResult.url}\n`;
            responseText += `Description: ${searchResult.description}\n`;
            
            if (searchResult.fullContent && searchResult.fullContent.trim()) {
              let content = searchResult.fullContent;
              if (maxLength && maxLength > 0 && content.length > maxLength) {
                content = content.substring(0, maxLength) + `\n\n[Content truncated at ${maxLength} characters]`;
              }
              responseText += `\n**Full Content:**\n${content}\n`;
            } else if (searchResult.contentPreview && searchResult.contentPreview.trim()) {
              let content = searchResult.contentPreview;
              if (maxLength && maxLength > 0 && content.length > maxLength) {
                content = content.substring(0, maxLength) + `\n\n[Content truncated at ${maxLength} characters]`;
              }
              responseText += `\n**Content Preview:**\n${content}\n`;
            } else if (searchResult.fetchStatus === 'error') {
              responseText += `\n**Content Extraction Failed:** ${searchResult.error}\n`;
            }
            
            responseText += `\n---\n\n`;
          });
          
          return {
            content: [
              {
                type: 'text' as const,
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error(`[MCP] Error in tool handler:`, error);
          throw error;
        }
      }
    );

    // Register the lightweight web search summaries tool (secondary choice for quick results)
    this.server.tool(
      'get-web-search-summaries',
      'Search the web and return only the search result snippets/descriptions without following links to extract full page content. This is a lightweight alternative to full-web-search for when you only need brief search results. For comprehensive information, use full-web-search instead.',
      {
        query: z.string().describe('Search query to execute (lightweight alternative)'),
        limit: z.union([z.number(), z.string()]).transform((val) => {
          const num = typeof val === 'string' ? parseInt(val, 10) : val;
          if (isNaN(num) || num < 1 || num > 10) {
            throw new Error('Invalid limit: must be a number between 1 and 10');
          }
          return num;
        }).default(5).describe('Number of search results to return (1-10)'),
      },
      async (args: unknown) => {
        console.log(`[MCP] Tool call received: get-web-search-summaries`);
        console.log(`[MCP] Raw arguments:`, JSON.stringify(args, null, 2));

        try {
          // Validate arguments
          if (typeof args !== 'object' || args === null) {
            throw new Error('Invalid arguments: args must be an object');
          }
          const obj = args as Record<string, unknown>;
          
          if (!obj.query || typeof obj.query !== 'string') {
            throw new Error('Invalid arguments: query is required and must be a string');
          }

          let limit = 5; // default
          if (obj.limit !== undefined) {
            const limitValue = typeof obj.limit === 'string' ? parseInt(obj.limit, 10) : obj.limit;
            if (typeof limitValue !== 'number' || isNaN(limitValue) || limitValue < 1 || limitValue > 10) {
              throw new Error('Invalid limit: must be a number between 1 and 10');
            }
            limit = limitValue;
          }

          console.log(`[MCP] Starting web search summaries...`);
          
          try {
            // Use existing search engine to get results with snippets
            const searchResponse = await this.searchEngine.search({
              query: obj.query,
              numResults: limit,
            });

            // const searchTime = Date.now() - startTime; // Unused for now

            // Convert to summary format (no content extraction)
            const summaryResults = searchResponse.results.map(item => ({
              title: item.title,
              url: item.url,
              description: item.description,
              timestamp: item.timestamp,
            }));

            console.log(`[MCP] Search summaries completed, found ${summaryResults.length} results`);
            
            // Format the results as text
            let responseText = `Search summaries for "${obj.query}" with ${summaryResults.length} results:\n\n`;
            
            summaryResults.forEach((summary, i) => {
              responseText += `**${i + 1}. ${summary.title}**\n`;
              responseText += `URL: ${summary.url}\n`;
              responseText += `Description: ${summary.description}\n`;
              responseText += `\n---\n\n`;
            });

            return {
              content: [
                {
                  type: 'text' as const,
                  text: responseText,
                },
              ],
            };
          } finally {
            // Ensure browsers are cleaned up after search-only operations
            // This prevents EventEmitter memory leaks when browsers accumulate listeners
            try {
              await this.searchEngine.closeAll();
            } catch (cleanupError) {
              console.error(`[MCP] Error during browser cleanup:`, cleanupError);
            }
          }
        } catch (error) {
          console.error(`[MCP] Error in get-web-search-summaries tool handler:`, error);
          throw error;
        }
      }
    );

    // Register the single page content extraction tool
    this.server.tool(
      'get-single-web-page-content',
      'Extract and return the full content from a single web page URL. This tool follows a provided URL and extracts the main page content. Useful for getting detailed content from a specific webpage without performing a search.',
      {
        url: z.string().url().describe('The URL of the web page to extract content from'),
        maxContentLength: z.union([z.number(), z.string()]).transform((val) => {
          const num = typeof val === 'string' ? parseInt(val, 10) : val;
          if (isNaN(num) || num < 0) {
            throw new Error('Invalid maxContentLength: must be a non-negative number');
          }
          return num;
        }).optional().describe('Maximum characters for the extracted content (0 = no limit, undefined = use default limit). Usually not needed - content length is automatically optimized.'),
      },
      async (args: unknown) => {
        console.log(`[MCP] Tool call received: get-single-web-page-content`);
        console.log(`[MCP] Raw arguments:`, JSON.stringify(args, null, 2));

        try {
          // Validate arguments
          if (typeof args !== 'object' || args === null) {
            throw new Error('Invalid arguments: args must be an object');
          }
          const obj = args as Record<string, unknown>;
          
          if (!obj.url || typeof obj.url !== 'string') {
            throw new Error('Invalid arguments: url is required and must be a string');
          }

          let maxContentLength: number | undefined;
          if (obj.maxContentLength !== undefined) {
            const maxLengthValue = typeof obj.maxContentLength === 'string' ? parseInt(obj.maxContentLength, 10) : obj.maxContentLength;
            if (typeof maxLengthValue !== 'number' || isNaN(maxLengthValue) || maxLengthValue < 0) {
              throw new Error('Invalid maxContentLength: must be a non-negative number');
            }
            // If maxContentLength is 0, treat it as "no limit" (undefined)
            maxContentLength = maxLengthValue === 0 ? undefined : maxLengthValue;
          }

          console.log(`[MCP] Starting single page content extraction for: ${obj.url}`);
          
          // Use existing content extractor to get page content
          const content = await this.contentExtractor.extractContent({
            url: obj.url,
            maxContentLength,
          });

          // Get page title from URL (simple extraction)
          const urlObj = new URL(obj.url);
          const title = urlObj.hostname + urlObj.pathname;

          // Create content preview and word count
          // const contentPreview = content.length > 200 ? content.substring(0, 200) + '...' : content; // Unused for now
          const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;

          console.log(`[MCP] Single page content extraction completed, extracted ${content.length} characters`);

          // Format the result as text
          let responseText = `**Page Content from: ${obj.url}**\n\n`;
          responseText += `**Title:** ${title}\n`;
          responseText += `**Word Count:** ${wordCount}\n`;
          responseText += `**Content Length:** ${content.length} characters\n\n`;
          
          if (maxContentLength && maxContentLength > 0 && content.length > maxContentLength) {
            responseText += `**Content (truncated at ${maxContentLength} characters):**\n${content.substring(0, maxContentLength)}\n\n[Content truncated at ${maxContentLength} characters]`;
          } else {
            responseText += `**Content:**\n${content}`;
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error(`[MCP] Error in get-single-web-page-content tool handler:`, error);
          throw error;
        }
      }
    );
  }

  private validateAndConvertArgs(args: unknown): WebSearchToolInput {
    if (typeof args !== 'object' || args === null) {
      throw new Error('Invalid arguments: args must be an object');
    }
    const obj = args as Record<string, unknown>;
    // Ensure query is a string
    if (!obj.query || typeof obj.query !== 'string') {
      throw new Error('Invalid arguments: query is required and must be a string');
    }

    // Convert limit to number if it's a string
    let limit = 5; // default
    if (obj.limit !== undefined) {
      const limitValue = typeof obj.limit === 'string' ? parseInt(obj.limit, 10) : obj.limit;
      if (typeof limitValue !== 'number' || isNaN(limitValue) || limitValue < 1 || limitValue > 10) {
        throw new Error('Invalid limit: must be a number between 1 and 10');
      }
      limit = limitValue;
    }

    // Convert includeContent to boolean if it's a string
    let includeContent = true; // default
    if (obj.includeContent !== undefined) {
      if (typeof obj.includeContent === 'string') {
        includeContent = obj.includeContent.toLowerCase() === 'true';
      } else {
        includeContent = Boolean(obj.includeContent);
      }
    }

    return {
      query: obj.query,
      limit,
      includeContent,
    };
  }

  private async handleWebSearch(input: WebSearchToolInput): Promise<WebSearchToolOutput> {
    const startTime = Date.now();
    const { query, limit = 5, includeContent = true } = input;
    
    console.error(`[web-search-mcp] DEBUG: handleWebSearch called with limit=${limit}, includeContent=${includeContent}`);

    try {
      // Request extra search results to account for potential PDF files that will be skipped
      // Request up to 2x the limit or at least 5 extra results, capped at 10 (Google's max)
      const searchLimit = includeContent ? Math.min(limit * 2 + 2, 10) : limit;
      
      console.log(`[web-search-mcp] DEBUG: Requesting ${searchLimit} search results to get ${limit} non-PDF content results`);
      
      // Perform the search
      const searchResponse = await this.searchEngine.search({
        query,
        numResults: searchLimit,
      });
      const searchResults = searchResponse.results;
      
      // Log search summary
      const pdfCount = searchResults.filter(result => isPdfUrl(result.url)).length;
      const followedCount = searchResults.length - pdfCount;
      console.error(`[web-search-mcp] DEBUG: Search engine: ${searchResponse.engine}; ${limit} requested/${searchResults.length} obtained; PDF: ${pdfCount}; ${followedCount} followed.`);

      // Extract content from each result if requested, with target count
      const enhancedResults = includeContent 
        ? await this.contentExtractor.extractContentForResults(searchResults, limit)
        : searchResults.slice(0, limit); // If not extracting content, just take the first 'limit' results
      
      // Log extraction summary with failure reasons and generate combined status
      let combinedStatus = `Search engine: ${searchResponse.engine}; ${limit} result requested/${searchResults.length} obtained; PDF: ${pdfCount}; ${followedCount} followed`;
      
      if (includeContent) {
        const successCount = enhancedResults.filter(r => r.fetchStatus === 'success').length;
        const failedResults = enhancedResults.filter(r => r.fetchStatus === 'error');
        const failedCount = failedResults.length;
        
        const failureReasons = this.categorizeFailureReasons(failedResults);
        const failureReasonText = failureReasons.length > 0 ? ` (${failureReasons.join(', ')})` : '';
        
        console.error(`[web-search-mcp] DEBUG: Links requested: ${limit}; Successfully extracted: ${successCount}; Failed: ${failedCount}${failureReasonText}; Results: ${enhancedResults.length}.`);
        
        // Add extraction info to combined status
        combinedStatus += `; Successfully extracted: ${successCount}; Failed: ${failedCount}; Results: ${enhancedResults.length}`;
      }

      const searchTime = Date.now() - startTime;

      return {
        results: enhancedResults,
        total_results: enhancedResults.length,
        search_time_ms: searchTime,
        query,
        status: combinedStatus,
      };
    } catch (error) {
      console.error('Web search error:', error);
      throw new Error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private categorizeFailureReasons(failedResults: SearchResult[]): string[] {
    const reasonCounts = new Map<string, number>();
    
    failedResults.forEach(result => {
      if (result.error) {
        const category = this.categorizeError(result.error);
        reasonCounts.set(category, (reasonCounts.get(category) || 0) + 1);
      }
    });
    
    return Array.from(reasonCounts.entries()).map(([reason, count]) => 
      count > 1 ? `${reason} (${count})` : reason
    );
  }

  private categorizeError(errorMessage: string): string {
    const lowerError = errorMessage.toLowerCase();
    
    if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
      return 'Timeout';
    }
    if (lowerError.includes('403') || lowerError.includes('forbidden')) {
      return 'Access denied';
    }
    if (lowerError.includes('404') || lowerError.includes('not found')) {
      return 'Not found';
    }
    if (lowerError.includes('bot') || lowerError.includes('captcha') || lowerError.includes('unusual traffic')) {
      return 'Bot detection';
    }
    if (lowerError.includes('too large') || lowerError.includes('content length') || lowerError.includes('maxcontentlength')) {
      return 'Content too long';
    }
    if (lowerError.includes('ssl') || lowerError.includes('certificate') || lowerError.includes('tls')) {
      return 'SSL error';
    }
    if (lowerError.includes('network') || lowerError.includes('connection') || lowerError.includes('econnrefused')) {
      return 'Network error';
    }
    if (lowerError.includes('dns') || lowerError.includes('hostname')) {
      return 'DNS error';
    }
    
    return 'Other error';
  }

  private setupGracefulShutdown(): void {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't exit on unhandled rejections, just log them
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      // Don't exit on uncaught exceptions in MCP context
    });

    // Graceful shutdown - close browsers when process exits
    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');
      try {
        await Promise.all([
          this.contentExtractor.closeAll(),
          this.searchEngine.closeAll()
        ]);
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
      }
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Shutting down gracefully...');
      try {
        await Promise.all([
          this.contentExtractor.closeAll(),
          this.searchEngine.closeAll()
        ]);
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
      }
      process.exit(0);
    });
  }

  async run(transportType: 'stdio' | 'http' = 'stdio', port: number = 8000): Promise<void> {
    console.log('Setting up MCP server...');
    
    if (transportType === 'http') {
      // HTTP transport using StreamableHTTPServerTransport
      const app = express();
      
      // CORS middleware
      app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
          res.sendStatus(200);
        } else {
          next();
        }
      });
      
      app.use(express.json());
      
      // Health check endpoint
      app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
      });
      
      // Create streamable HTTP transport (stateless mode for easier testing)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode - no session management
      });
      
      console.log('Connecting to HTTP transport...');
      await this.server.connect(transport);
      
      // Handle MCP requests (both GET for SSE and POST for direct requests)
      app.all('/mcp', async (req, res) => {
        try {
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          console.error('HTTP MCP error:', error);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
          }
        }
      });
      
      app.listen(port, '127.0.0.1', () => {
        console.log(`Web Search MCP Server (HTTP) started on http://127.0.0.1:${port}/mcp`);
        console.log('Server timestamp:', new Date().toISOString());
        console.log('Available tools: full-web-search, get-web-search-summaries, get-single-web-page-content');
        console.log('Waiting for MCP HTTP requests...');
      });
      
    } else {
      // Stdio transport (original behavior)
      const transport = new StdioServerTransport();
      
      console.log('Connecting to stdio transport...');
      await this.server.connect(transport);
      console.log('Web Search MCP Server (stdio) started');
      console.log('Server timestamp:', new Date().toISOString());
      console.log('Waiting for MCP messages...');
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const transportType = args.includes('--http') ? 'http' : 'stdio';
const portArg = args.find(arg => arg.startsWith('--port='));
const port = portArg ? parseInt(portArg.split('=')[1], 10) : 8000;

console.log(`Starting in ${transportType} mode${transportType === 'http' ? ` on port ${port}` : ''}...`);

// Start the server
const server = new WebSearchMCPServer();
server.run(transportType, port).catch((error: unknown) => {
  if (error instanceof Error) {
    console.error('Server error:', error.message);
  } else {
    console.error('Server error:', error);
  }
  process.exit(1);
});
