/**
 * Utility functions for the web search MCP server
 */

export function cleanText(text: string, maxLength: number = 10000): string {
  return text
    .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
    .replace(/\n\s*\n/g, '\n') // Replace multiple newlines with single newline
    .trim()
    .substring(0, maxLength);
}

export function getWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

export function getContentPreview(text: string, maxLength: number = 500): string {
  const cleaned = cleanText(text, maxLength);
  return cleaned.length === maxLength ? cleaned + '...' : cleaned;
}

export function generateTimestamp(): string {
  return new Date().toISOString();
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeQuery(query: string): string {
  return query.trim().substring(0, 1000); // Limit query length
}

export function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    // If URL parsing fails, check the raw string as fallback
    return url.toLowerCase().endsWith('.pdf');
  }
}

/**
 * Normalizes a domain by removing protocol, www prefix, and trailing slashes
 * @param domain - Domain string (e.g., "https://www.example.com/", "www.example.com", "example.com")
 * @returns Normalized domain (e.g., "example.com")
 */
export function normalizeDomain(domain: string): string {
  let normalized = domain.trim().toLowerCase();
  
  // Remove protocol (http://, https://)
  normalized = normalized.replace(/^https?:\/\//, '');
  
  // Remove www. prefix
  normalized = normalized.replace(/^www\./, '');
  
  // Remove trailing slash and path
  normalized = normalized.split('/')[0];
  
  // Remove port if present
  normalized = normalized.split(':')[0];
  
  return normalized;
}

/**
 * Extracts the domain from a URL
 * @param url - URL string
 * @returns Normalized domain (e.g., "example.com")
 */
export function extractDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return normalizeDomain(urlObj.hostname);
  } catch {
    // If URL parsing fails, try to extract domain manually
    return normalizeDomain(url);
  }
}

/**
 * Checks if a URL matches any of the allowed domains
 * @param url - URL to check
 * @param allowedDomains - Array of normalized domains to match against
 * @returns True if the URL's domain matches any of the allowed domains
 */
export function urlMatchesDomain(url: string, allowedDomains: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) {
    return true; // No filtering if no domains specified
  }
  
  const urlDomain = extractDomainFromUrl(url);
  return allowedDomains.includes(urlDomain);
}

/**
 * Builds a domain-filtered search query using site: operators
 * @param query - Original search query
 * @param domains - Array of domains to filter by
 * @param maxDomainsInQuery - Maximum number of domains to include in query (default: 10). If more domains provided, query is not modified and filtering happens post-search.
 * @returns Modified query with site: operators (e.g., "query site:example.com OR site:github.com") or original query if too many domains
 */
export function buildDomainFilteredQuery(query: string, domains: string[], maxDomainsInQuery: number = 10): string {
  if (!domains || domains.length === 0) {
    return query;
  }
  
  // Normalize all domains
  const normalizedDomains = domains
    .map(domain => normalizeDomain(domain))
    .filter(domain => domain.length > 0); // Remove empty domains
  
  if (normalizedDomains.length === 0) {
    return query;
  }
  
  // If too many domains, don't modify query - rely on post-filtering instead
  // This prevents query from becoming too long and causing search engine failures
  if (normalizedDomains.length > maxDomainsInQuery) {
    console.log(`[Utils] Too many domains (${normalizedDomains.length}), skipping query modification. Will filter results post-search.`);
    return query;
  }
  
  // Build site: operators
  if (normalizedDomains.length === 1) {
    // Single domain: "query site:example.com"
    return `${query} site:${normalizedDomains[0]}`;
  } else {
    // Multiple domains: "query (site:example.com OR site:github.com)"
    const siteOperators = normalizedDomains.map(domain => `site:${domain}`).join(' OR ');
    return `${query} (${siteOperators})`;
  }
} 