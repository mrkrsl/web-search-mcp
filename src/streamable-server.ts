#!/usr/bin/env node
console.log('Web Search MCP Server (StreamableHttp) starting...');

import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SearchEngine } from './search-engine.js';
import { EnhancedContentExtractor } from './enhanced-content-extractor.js';
import { 
  WebSearchToolInput, 
  WebSearchToolOutput, 
  SearchResult,
  SearchSummaryResult,
  SearchSummaryOutput,
  SinglePageContentOutput
} from './types.js';
import { isPdfUrl } from './utils.js';

interface StreamableHttpOptions {
  port?: number;
  host?: string;
}

class WebSearchMCPStreamableServer {
  private server: McpServer;
  private searchEngine: SearchEngine;
  private contentExtractor: EnhancedContentExtractor;
  private app: express.Application;
  private port: number;
  private host: string;

  constructor(options: StreamableHttpOptions = {}) {
    this.port = options.port || parseInt(process.env.PORT || '3001');
    this.host = options.host || process.env.HOST || '0.0.0.0';
    
    this.server = new McpServer({
      name: 'web-search-mcp-streamable',
      version: '0.3.1',
    });

    this.searchEngine = new SearchEngine();
    this.contentExtractor = new EnhancedContentExtractor();
    this.app = express();

    this.setupExpress();
    this.setupTools();
    this.setupStreamableHttp();
    this.setupGracefulShutdown();
  }

  private setupExpress(): void {
    // Enable CORS for all routes
    this.app.use(cors({
      origin: true, // Allow all origins
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
    }));

    // Parse JSON bodies
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Basic endpoints
    this.setupBasicEndpoints();
  }

  private setupBasicEndpoints(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        server: 'web-search-mcp-streamable',
        version: '0.3.1',
        timestamp: new Date().toISOString(),
        transport: 'streamable-http'
      });
    });

    // MCP server info endpoint
    this.app.get('/mcp/info', (req, res) => {
      res.json({
        name: 'web-search-mcp-streamable',
        version: '0.3.1',
        transport: 'streamable-http',
        endpoints: {
          health: '/health',
          info: '/mcp/info',
          streamable: '/mcp',
        },
        tools: [
          'full-web-search',
          'get-web-search-summaries', 
          'get-single-web-page-content'
        ]
      });
    });

    // Root endpoint for basic info
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Web Search MCP Server (StreamableHttp)',
        version: '0.3.1',
        transport: 'streamable-http',
        endpoints: {
          health: '/health',
          info: '/mcp/info',
          mcp: '/mcp'
        }
      });
    });
  }

  private setupStreamableHttp(): void {
    // StreamableHttp endpoint according to MCP specification
    this.app.post('/mcp', async (req, res) => {
      console.log('StreamableHttp request received');
      
      try {
        // Set headers for streaming response
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // Handle the MCP request
        const mcpRequest = req.body;
        console.log('MCP Request:', JSON.stringify(mcpRequest, null, 2));

        // Process the request through the MCP server
        const response = await this.handleMcpRequest(mcpRequest);
        
        console.log('MCP Response:', JSON.stringify(response, null, 2));
        res.json(response);

      } catch (error) {
        console.error('StreamableHttp error:', error);
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
            data: error instanceof Error ? error.message : String(error)
          }
        });
      }
    });

    // Handle OPTIONS for CORS
    this.app.options('/mcp', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(200).end();
    });
  }

  private async handleMcpRequest(request: any): Promise<any> {
    // Handle different MCP request types
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);
      
      case 'tools/list':
        return this.handleListTools(request);
      
      case 'tools/call':
        return this.handleCallTool(request);
      
      case 'resources/list':
        return this.handleListResources(request);
      
      case 'ping':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {}
        };
      
      default:
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`
          }
        };
    }
  }

  private handleInitialize(request: any): any {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: {
          name: 'web-search-mcp-streamable',
          version: '0.3.1'
        },
        instructions: 'Web search server with content extraction capabilities'
      }
    };
  }

  private handleListTools(request: any): any {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          {
            name: 'full-web-search',
            description: 'Search the web and fetch complete page content for multiple results',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 5)',
                  default: 5
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get-web-search-summaries',
            description: 'Search the web and return summaries of the results',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 5)',
                  default: 5
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get-single-web-page-content',
            description: 'Extract complete content from a single web page URL',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'URL of the web page to extract content from'
                }
              },
              required: ['url']
            }
          }
        ]
      }
    };
  }

  private async handleCallTool(request: any): Promise<any> {
    const { name, arguments: args } = request.params;
    
    try {
      let result;
      
      switch (name) {
        case 'full-web-search':
          result = await this.fullWebSearch(args);
          break;
        
        case 'get-web-search-summaries':
          result = await this.getWebSearchSummaries(args);
          break;
        
        case 'get-single-web-page-content':
          result = await this.getSingleWebPageContent(args);
          break;
        
        default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: `Tool not found: ${name}`
            }
          };
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        }
      };

    } catch (error) {
      console.error(`Error calling tool ${name}:`, error);
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }

  private handleListResources(request: any): any {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        resources: []
      }
    };
  }

  // Tool implementations (adapted for correct interfaces)
  private async fullWebSearch(args: WebSearchToolInput): Promise<WebSearchToolOutput> {
    const { query, limit = 5 } = args;
    console.log(`Performing full web search for: "${query}" (limit: ${limit})`);

    try {
      const searchResponse = await this.searchEngine.search({ query, numResults: limit });
      
      if (!searchResponse || !searchResponse.results || searchResponse.results.length === 0) {
        return {
          results: [],
          total_results: 0,
          search_time_ms: 0,
          query,
          status: `No search results found for query: "${query}"`
        };
      }

      const processedResults: SearchResult[] = [];
      
      for (const result of searchResponse.results) {
        try {
          let content = '';

          if (isPdfUrl(result.url)) {
            console.log(`Extracting PDF content from: ${result.url}`);
            // For PDF, use the URL directly with the content extractor
            content = await this.contentExtractor.extractContent({ url: result.url });
          } else {
            console.log(`Extracting web page content from: ${result.url}`);
            content = await this.contentExtractor.extractContent({ url: result.url });
          }

          processedResults.push({
            title: result.title,
            url: result.url,
            description: result.description,
            fullContent: content || result.description,
            contentPreview: content ? content.substring(0, 500) + '...' : result.description,
            wordCount: content ? content.split(' ').length : result.description.split(' ').length,
            timestamp: result.timestamp,
            fetchStatus: 'success'
          });

        } catch (error) {
          console.warn(`Failed to extract content from ${result.url}:`, error);
          processedResults.push({
            title: result.title,
            url: result.url,
            description: result.description,
            fullContent: result.description,
            contentPreview: result.description,
            wordCount: result.description.split(' ').length,
            timestamp: result.timestamp,
            fetchStatus: 'error',
            error: `Content extraction failed: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      }

      return {
        results: processedResults,
        total_results: processedResults.length,
        search_time_ms: Date.now() - new Date(searchResponse.results[0]?.timestamp || Date.now()).getTime(),
        query,
        status: `Found ${processedResults.length} results for "${query}". Successfully extracted content from ${processedResults.filter(r => r.fetchStatus === 'success').length} pages.`
      };

    } catch (error) {
      console.error('Full web search error:', error);
      throw new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getWebSearchSummaries(args: WebSearchToolInput): Promise<SearchSummaryOutput> {
    const { query, limit = 5 } = args;
    console.log(`Getting web search summaries for: "${query}" (limit: ${limit})`);

    try {
      const searchResponse = await this.searchEngine.search({ query, numResults: limit });
      
      if (!searchResponse || !searchResponse.results || searchResponse.results.length === 0) {
        return {
          results: [],
          total_results: 0,
          search_time_ms: 0,
          query
        };
      }

      const summaryResults: SearchSummaryResult[] = searchResponse.results.map(result => ({
        title: result.title,
        url: result.url,
        description: result.description,
        timestamp: result.timestamp
      }));

      return {
        results: summaryResults,
        total_results: summaryResults.length,
        search_time_ms: Date.now() - new Date(searchResponse.results[0]?.timestamp || Date.now()).getTime(),
        query
      };

    } catch (error) {
      console.error('Web search summaries error:', error);
      throw new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getSingleWebPageContent(args: { url: string }): Promise<SinglePageContentOutput> {
    const { url } = args;
    console.log(`Extracting content from single page: ${url}`);

    try {
      const content = await this.contentExtractor.extractContent({ url });
      const wordCount = content ? content.split(' ').length : 0;

      return {
        url,
        title: 'Extracted Content', // We don't have title extraction in current extractor
        content: content || 'No content could be extracted',
        contentPreview: content ? content.substring(0, 500) + '...' : 'No content available',
        wordCount,
        timestamp: new Date().toISOString(),
        fetchStatus: 'success'
      };

    } catch (error) {
      console.error(`Content extraction error for ${url}:`, error);
      return {
        url,
        title: 'Error',
        content: '',
        contentPreview: 'Content extraction failed',
        wordCount: 0,
        timestamp: new Date().toISOString(),
        fetchStatus: 'error',
        error: `Content extraction failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private setupTools(): void {
    // Tools are handled directly in StreamableHttp mode
    console.log('Tools configured for StreamableHttp transport');
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = () => {
      console.log('Received shutdown signal, closing server gracefully...');
      process.exit(0);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGUSR1', gracefulShutdown);
    process.on('SIGUSR2', gracefulShutdown);
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, this.host, () => {
        console.log(`Web Search MCP Server (StreamableHttp) started on ${this.host}:${this.port}`);
        console.log(`Server timestamp: ${new Date().toISOString()}`);
        console.log(`Health check: http://${this.host}:${this.port}/health`);
        console.log(`MCP Info: http://${this.host}:${this.port}/mcp/info`);
        console.log(`StreamableHttp Endpoint: http://${this.host}:${this.port}/mcp`);
        console.log('Server ready to accept connections...');
        resolve();
      });
    });
  }
}

// Start the server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new WebSearchMCPStreamableServer();
  server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export default WebSearchMCPStreamableServer;