export interface SearchResult {
  title: string;
  url: string;
  description: string;
  fullContent: string;
  contentPreview: string;
  wordCount: number;
  timestamp: string;
  fetchStatus: 'success' | 'error' | 'timeout';
  error?: string;
}

export interface SearchResponse {
  query: string;
  limit: number;
  results: SearchResult[];
  totalFound: number;
  searchTimestamp: string;
  processingTimeMs: number;
}

export interface SearchOptions {
  query: string;
  numResults?: number;
  timeout?: number;
  domains?: string[];
}

export interface ContentExtractionOptions {
  url: string;
  timeout?: number;
  maxContentLength?: number;
}

export interface WebSearchToolInput {
  query?: string;
  keywords?: string[];
  limit?: number;
  includeContent?: boolean;
  maxContentLength?: number;
  domains?: string[];
}

export interface WebSearchToolOutput {
  results: SearchResult[];
  total_results: number;
  search_time_ms: number;
  query: string;
  status?: string;
}

// Keywords search output with additional metadata
export interface KeywordsSearchOutput {
  results: (SearchResult & { found_by_keyword?: string[] })[];
  total_unique_results: number;
  keywords_searched: string[];
  search_time_ms: number;
  status: string;
}

// New types for search summaries (snippets only)
export interface SearchSummaryResult {
  title: string;
  url: string;
  description: string;
  timestamp: string;
}

export interface SearchSummaryOutput {
  results: SearchSummaryResult[];
  total_results: number;
  search_time_ms: number;
  query: string;
}

// New types for single page content
export interface SinglePageContentOutput {
  url: string;
  title: string;
  content: string;
  contentPreview: string;
  wordCount: number;
  timestamp: string;
  fetchStatus: 'success' | 'error';
  error?: string;
}

// Search result with metadata about which search engine was used
export interface SearchResultWithMetadata {
  results: SearchResult[];
  engine: string;
}
