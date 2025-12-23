#!/usr/bin/env node
console.log('Web Search API Server starting...');

import express, { Request, Response, NextFunction } from 'express';
import { SearchEngine } from './search-engine.js';
import { EnhancedContentExtractor } from './enhanced-content-extractor.js';
import { WebSearchToolInput, WebSearchToolOutput, SearchResult } from './types.js';
import { isPdfUrl } from './utils.js';

class WebSearchAPIServer {
  private app: express.Application;
  private searchEngine: SearchEngine;
  private contentExtractor: EnhancedContentExtractor;
  private port: number;

  constructor(port: number = 3000) {
    this.app = express();
    this.port = port;
    this.searchEngine = new SearchEngine();
    this.contentExtractor = new EnhancedContentExtractor();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupGracefulShutdown();
  }

  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json());

    // CORS middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`[API] ${req.method} ${req.path} - ${new Date().toISOString()}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'web-search-api',
        version: '0.3.1',
      });
    });

    // Full web search endpoint
    this.app.post('/api/search', async (req: Request, res: Response, next: NextFunction) => {
      try {
        console.log(`[API] POST /api/search - Body:`, JSON.stringify(req.body, null, 2));

        const { query, limit = 5, includeContent = true, maxContentLength } = req.body;

        // Validate query
        if (!query || typeof query !== 'string') {
          return res.status(400).json({
            error: 'Invalid request',
            message: 'query is required and must be a string',
          });
        }

        // Validate limit
        let validatedLimit = limit;
        if (limit !== undefined) {
          const limitValue = typeof limit === 'string' ? parseInt(limit, 10) : limit;
          if (typeof limitValue !== 'number' || isNaN(limitValue) || limitValue < 1 || limitValue > 10) {
            return res.status(400).json({
              error: 'Invalid request',
              message: 'limit must be a number between 1 and 10',
            });
          }
          validatedLimit = limitValue;
        }

        // Validate includeContent
        let validatedIncludeContent = includeContent;
        if (includeContent !== undefined) {
          if (typeof includeContent === 'string') {
            validatedIncludeContent = includeContent.toLowerCase() === 'true';
          } else {
            validatedIncludeContent = Boolean(includeContent);
          }
        }

        // Validate maxContentLength
        let validatedMaxContentLength: number | undefined = maxContentLength;
        if (maxContentLength !== undefined) {
          const maxLengthValue = typeof maxContentLength === 'string' ? parseInt(maxContentLength, 10) : maxContentLength;
          if (typeof maxLengthValue !== 'number' || isNaN(maxLengthValue) || maxLengthValue < 0) {
            return res.status(400).json({
              error: 'Invalid request',
              message: 'maxContentLength must be a non-negative number',
            });
          }
          validatedMaxContentLength = maxLengthValue === 0 ? undefined : maxLengthValue;
        }

        const validatedArgs: WebSearchToolInput = {
          query,
          limit: validatedLimit,
          includeContent: validatedIncludeContent,
          maxContentLength: validatedMaxContentLength,
        };

        console.log(`[API] Starting web search with validated args:`, JSON.stringify(validatedArgs, null, 2));

        const result = await this.handleWebSearch(validatedArgs);

        // Format response
        const response = {
          success: true,
          query: result.query,
          total_results: result.total_results,
          search_time_ms: result.search_time_ms,
          status: result.status,
          results: result.results.map((searchResult) => {
            const formattedResult: any = {
              title: searchResult.title,
              url: searchResult.url,
              description: searchResult.description,
              timestamp: searchResult.timestamp,
              fetchStatus: searchResult.fetchStatus,
            };

            if (searchResult.fullContent && searchResult.fullContent.trim()) {
              let content = searchResult.fullContent;
              if (validatedMaxContentLength && validatedMaxContentLength > 0 && content.length > validatedMaxContentLength) {
                content = content.substring(0, validatedMaxContentLength);
                formattedResult.fullContent = content;
                formattedResult.contentTruncated = true;
                formattedResult.originalLength = searchResult.fullContent.length;
              } else {
                formattedResult.fullContent = content;
              }
              formattedResult.wordCount = searchResult.wordCount;
            } else if (searchResult.contentPreview && searchResult.contentPreview.trim()) {
              formattedResult.contentPreview = searchResult.contentPreview;
            }

            if (searchResult.fetchStatus === 'error' && searchResult.error) {
              formattedResult.error = searchResult.error;
            }

            return formattedResult;
          }),
        };

        res.json(response);
      } catch (error) {
        next(error);
      }
    });

    // Web search summaries endpoint (lightweight)
    this.app.post('/api/search/summaries', async (req: Request, res: Response, next: NextFunction) => {
      try {
        console.log(`[API] POST /api/search/summaries - Body:`, JSON.stringify(req.body, null, 2));

        const { query, limit = 5 } = req.body;

        // Validate query
        if (!query || typeof query !== 'string') {
          return res.status(400).json({
            error: 'Invalid request',
            message: 'query is required and must be a string',
          });
        }

        // Validate limit
        let validatedLimit = limit;
        if (limit !== undefined) {
          const limitValue = typeof limit === 'string' ? parseInt(limit, 10) : limit;
          if (typeof limitValue !== 'number' || isNaN(limitValue) || limitValue < 1 || limitValue > 10) {
            return res.status(400).json({
              error: 'Invalid request',
              message: 'limit must be a number between 1 and 10',
            });
          }
          validatedLimit = limitValue;
        }

        console.log(`[API] Starting web search summaries...`);

        const startTime = Date.now();
        const searchResponse = await this.searchEngine.search({
          query,
          numResults: validatedLimit,
        });

        const searchTime = Date.now() - startTime;

        // Convert to summary format
        const summaryResults = searchResponse.results.map((item) => ({
          title: item.title,
          url: item.url,
          description: item.description,
          timestamp: item.timestamp,
        }));

        console.log(`[API] Search summaries completed, found ${summaryResults.length} results`);

        const response = {
          success: true,
          query,
          total_results: summaryResults.length,
          search_time_ms: searchTime,
          engine: searchResponse.engine,
          results: summaryResults,
        };

        res.json(response);
      } catch (error) {
        next(error);
      } finally {
        // Clean up browsers
        try {
          await this.searchEngine.closeAll();
        } catch (cleanupError) {
          console.error(`[API] Error during browser cleanup:`, cleanupError);
        }
      }
    });

    // Single page content extraction endpoint
    this.app.post('/api/content', async (req: Request, res: Response, next: NextFunction) => {
      try {
        console.log(`[API] POST /api/content - Body:`, JSON.stringify(req.body, null, 2));

        const { url, maxContentLength } = req.body;

        // Validate URL
        if (!url || typeof url !== 'string') {
          return res.status(400).json({
            error: 'Invalid request',
            message: 'url is required and must be a string',
          });
        }

        // Validate URL format
        try {
          new URL(url);
        } catch {
          return res.status(400).json({
            error: 'Invalid request',
            message: 'url must be a valid URL',
          });
        }

        // Validate maxContentLength
        let validatedMaxContentLength: number | undefined = maxContentLength;
        if (maxContentLength !== undefined) {
          const maxLengthValue = typeof maxContentLength === 'string' ? parseInt(maxContentLength, 10) : maxContentLength;
          if (typeof maxLengthValue !== 'number' || isNaN(maxLengthValue) || maxLengthValue < 0) {
            return res.status(400).json({
              error: 'Invalid request',
              message: 'maxContentLength must be a non-negative number',
            });
          }
          validatedMaxContentLength = maxLengthValue === 0 ? undefined : maxLengthValue;
        }

        console.log(`[API] Starting single page content extraction for: ${url}`);

        const content = await this.contentExtractor.extractContent({
          url,
          maxContentLength: validatedMaxContentLength,
        });

        // Get page title from URL
        const urlObj = new URL(url);
        const title = urlObj.hostname + urlObj.pathname;
        const wordCount = content.split(/\s+/).filter((word) => word.length > 0).length;

        console.log(`[API] Single page content extraction completed, extracted ${content.length} characters`);

        const response = {
          success: true,
          url,
          title,
          content: validatedMaxContentLength && validatedMaxContentLength > 0 && content.length > validatedMaxContentLength
            ? content.substring(0, validatedMaxContentLength)
            : content,
          contentTruncated: validatedMaxContentLength && validatedMaxContentLength > 0 && content.length > validatedMaxContentLength,
          originalLength: content.length,
          wordCount,
          timestamp: new Date().toISOString(),
        };

        res.json(response);
      } catch (error) {
        next(error);
      }
    });

    // Error handling middleware
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      console.error(`[API] Error:`, err);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message || 'An unexpected error occurred',
      });
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: 'Not found',
        message: `Route ${req.method} ${req.path} not found`,
      });
    });
  }

  private async handleWebSearch(input: WebSearchToolInput): Promise<WebSearchToolOutput> {
    const startTime = Date.now();
    const { query, limit = 5, includeContent = true } = input;

    console.log(`[API] handleWebSearch called with limit=${limit}, includeContent=${includeContent}`);

    try {
      // Request extra search results to account for potential PDF files that will be skipped
      const searchLimit = includeContent ? Math.min(limit * 2 + 2, 10) : limit;

      console.log(`[API] Requesting ${searchLimit} search results to get ${limit} non-PDF content results`);

      // Perform the search
      const searchResponse = await this.searchEngine.search({
        query,
        numResults: searchLimit,
      });
      const searchResults = searchResponse.results;

      // Log search summary
      const pdfCount = searchResults.filter((result) => isPdfUrl(result.url)).length;
      const followedCount = searchResults.length - pdfCount;
      console.log(`[API] Search engine: ${searchResponse.engine}; ${limit} requested/${searchResults.length} obtained; PDF: ${pdfCount}; ${followedCount} followed.`);

      // Extract content from each result if requested
      const enhancedResults = includeContent
        ? await this.contentExtractor.extractContentForResults(searchResults, limit)
        : searchResults.slice(0, limit);

      // Log extraction summary
      let combinedStatus = `Search engine: ${searchResponse.engine}; ${limit} result requested/${searchResults.length} obtained; PDF: ${pdfCount}; ${followedCount} followed`;

      if (includeContent) {
        const successCount = enhancedResults.filter((r) => r.fetchStatus === 'success').length;
        const failedResults = enhancedResults.filter((r) => r.fetchStatus === 'error');
        const failedCount = failedResults.length;

        const failureReasons = this.categorizeFailureReasons(failedResults);
        const failureReasonText = failureReasons.length > 0 ? ` (${failureReasons.join(', ')})` : '';

        console.log(`[API] Links requested: ${limit}; Successfully extracted: ${successCount}; Failed: ${failedCount}${failureReasonText}; Results: ${enhancedResults.length}.`);

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
      console.error('[API] Web search error:', error);
      throw new Error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private categorizeFailureReasons(failedResults: SearchResult[]): string[] {
    const reasonCounts = new Map<string, number>();

    failedResults.forEach((result) => {
      if (result.error) {
        const category = this.categorizeError(result.error);
        reasonCounts.set(category, (reasonCounts.get(category) || 0) + 1);
      }
    });

    return Array.from(reasonCounts.entries()).map(([reason, count]) => (count > 1 ? `${reason} (${count})` : reason));
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
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down gracefully...');
      try {
        await Promise.all([this.contentExtractor.closeAll(), this.searchEngine.closeAll()]);
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
      }
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Shutting down gracefully...');
      try {
        await Promise.all([this.contentExtractor.closeAll(), this.searchEngine.closeAll()]);
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
      }
      process.exit(0);
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`🚀 Web Search API Server started`);
        console.log(`📡 Server running on http://localhost:${this.port}`);
        console.log(`📋 Health check: http://localhost:${this.port}/health`);
        console.log(`🔍 Search endpoint: http://localhost:${this.port}/api/search`);
        console.log(`📝 Summaries endpoint: http://localhost:${this.port}/api/search/summaries`);
        console.log(`📄 Content endpoint: http://localhost:${this.port}/api/content`);
        console.log(`⏰ Server timestamp: ${new Date().toISOString()}`);
        resolve();
      });
    });
  }
}

// Start the server
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const server = new WebSearchAPIServer(port);
server.start().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error('Server error:', error.message);
  } else {
    console.error('Server error:', error);
  }
  process.exit(1);
});

