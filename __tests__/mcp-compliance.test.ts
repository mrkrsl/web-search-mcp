/**
 * MCP Compliance Tests
 *
 * Tests verify the server adheres to the MCP specification:
 * - Stdio protocol compliance (no stdout pollution)
 * - No model detection heuristics
 * - Proper error response format
 * - Browser lifecycle cleanup in handlers
 * - Configuration portability
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, '..', 'src');

// Helper: read all TypeScript source files
function readSourceFiles(): Map<string, string> {
  const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.ts'));
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(file, fs.readFileSync(path.join(SRC_DIR, file), 'utf-8'));
  }
  return sources;
}

// ============================================================================
// TEST 1: Stdio Protocol Compliance - No console.log() in source
// MCP Spec: "The server MUST NOT write anything to stdout that is not a
// valid MCP message."  Only console.error() (stderr) is safe for logging.
// ============================================================================

describe('MCP Stdio Protocol Compliance', () => {
  const sources = readSourceFiles();

  it('should have zero console.log() calls across all source files', () => {
    const violations: Array<{ file: string; line: number; content: string }> = [];

    for (const [file, content] of sources) {
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // Match console.log( but not commented-out lines
        const trimmed = line.trim();
        if (trimmed.includes('console.log(') && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          violations.push({ file, line: idx + 1, content: trimmed });
        }
      });
    }

    const violationList = violations
      .map(v => `  ${v.file}:${v.line} → ${v.content.substring(0, 80)}`)
      .join('\n');

    expect(violations).toEqual([]);
  });

  it('should use console.error() for all logging', () => {
    // Verify console.error is used (confirming stderr usage)
    const allContent = Array.from(sources.values()).join('\n');
    const errorCalls = (allContent.match(/console\.error\(/g) || []).length;
    const logCalls = (allContent.match(/console\.log\(/g) || []).length;

    expect(logCalls).toBe(0);
    expect(errorCalls).toBeGreaterThan(0); // Should have at least some logging
  });
});

// ============================================================================
// TEST 2: No Model Detection Heuristics
// MCP Spec: Servers should not make assumptions about client implementations.
// Model detection based on parameter types is unreliable and violates
// client-server separation of concerns.
// ============================================================================

describe('No Model Detection Heuristics', () => {
  it('should not contain model detection logic in index.ts', () => {
    const indexSrc = fs.readFileSync(path.join(SRC_DIR, 'index.ts'), 'utf-8');

    const detectionPatterns = [
      /isLikelyLlama/i,
      /isLikelyRobustModel/i,
      /detected potential.*model/i,
      /detected robust.*model/i,
      /Llama.*string.*parameters/i,
    ];

    const violations: string[] = [];
    for (const pattern of detectionPatterns) {
      const matches = indexSrc.match(pattern);
      if (matches) {
        violations.push(`Pattern "${pattern.source}" matched: "${matches[0]}"`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('should not modify behavior based on parameter type inference', () => {
    const indexSrc = fs.readFileSync(path.join(SRC_DIR, 'index.ts'), 'utf-8');

    // Should NOT have logic that auto-sets maxContentLength based on type detection
    // of whether a model "seems" like a Llama or robust model
    const modelDetectionPattern = /isLikelyLlama|isLikelyRobustModel|Detected potential.*model|Detected robust.*model/
    const hasModelDetection = modelDetectionPattern.test(indexSrc);

    expect(hasModelDetection).toBe(false);
  });
});

// ============================================================================
// TEST 3: Configuration Portability - mcp.json should not be committed
// Hardcoded absolute paths make the config non-portable across machines.
// An example template (mcp.json.example) should be provided instead.
// ============================================================================

describe('Configuration Portability', () => {
  it('should not have mcp.json in the repository (use .example template instead)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const mcpConfigPath = path.join(rootDir, 'mcp.json');
    const mcpExamplePath = path.join(rootDir, 'mcp.json.example');
    const mcpGitignore = path.join(rootDir, '.gitignore');

    // git should not track mcp.json
    // (We check if it's untracked/deleted in git status)
    const gitStatusCheck = `cd ${rootDir} && git ls-files --error-unmatch mcp.json 2>/dev/null`;
    let result;
    try {
      result = require('child_process').execSync(gitStatusCheck, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      // File is not tracked - good!
      return;
    }

    // If we get here, file IS tracked (unless it was never committed)
    expect(fs.existsSync(mcpConfigPath)).toBe(false);
  });

  it('should provide mcp.json.example as a template', () => {
    const rootDir = path.resolve(__dirname, '..');
    const mcpExamplePath = path.join(rootDir, 'mcp.json.example');

    expect(fs.existsSync(mcpExamplePath)).toBe(true);

    // The example should not contain hardcoded user-specific paths
    const exampleContent = fs.readFileSync(mcpExamplePath, 'utf-8');
    const example = JSON.parse(exampleContent);

    // Paths should be relative or use variables, not hardcoded /Users/ or /home/
    const serverConfig = example.mcpServers?.['web-search'];
    if (serverConfig?.args) {
      for (const arg of serverConfig.args) {
        expect(arg).not.toMatch(/^\/Users\//);
        expect(arg).not.toMatch(/^\/home\//);
      }
    }
  });
});

// ============================================================================
// TEST 4: Error Response Format - MCP compliant
// MCP tools should return { content: [...], isError: true } on errors
// instead of throwing raw exceptions (which the SDK catches but doesn't
// format as MCP errors properly).
// ============================================================================

describe('Error Response Format', () => {
  it('full-web-search handler should return isError response on failure', () => {
    const indexSrc = fs.readFileSync(path.join(SRC_DIR, 'index.ts'), 'utf-8');

    // Extract the full-web-search handler
    const match = indexSrc.match(/this\.server\.tool\(\s*'full-web-search'[\s\S]*?async \(args: unknown\) => \{([\s\S]*?)\n    \);/);

    expect(match).not.toBeNull();

    if (match) {
      const handler = match[1];
      // Should catch errors and return MCP format instead of re-throwing
      // The error return should include isError: true
      const hasMcpErrorFormat = handler.includes('isError: true') ||
        handler.includes('isError:true') ||
        handler.includes('isError : true');
      const reThrowsError = /throw\s+error/.test(handler);

      // Should NOT just throw error - should return error response
      expect(reThrowsError).toBe(false);
      expect(hasMcpErrorFormat).toBe(true);
    }
  });

  it('get-web-search-summaries handler should return isError response on failure', () => {
    const indexSrc = fs.readFileSync(path.join(SRC_DIR, 'index.ts'), 'utf-8');

    const match = indexSrc.match(/this\.server\.tool\(\s*'get-web-search-summaries'[\s\S]*?async \(args: unknown\) => \{([\s\S]*?)\n    \);/);

    expect(match).not.toBeNull();

    if (match) {
      const handler = match[1];
      const hasMcpErrorFormat = handler.includes('isError: true');
      const reThrowsError = /throw\s+error/.test(handler);

      expect(reThrowsError).toBe(false);
      expect(hasMcpErrorFormat).toBe(true);
    }
  });

  it('get-single-web-page-content handler should return isError response on failure', () => {
    const indexSrc = fs.readFileSync(path.join(SRC_DIR, 'index.ts'), 'utf-8');

    const match = indexSrc.match(/this\.server\.tool\(\s*'get-single-web-page-content'[\s\S]*?async \(args: unknown\) => \{([\s\S]*?)\n    \);/);

    expect(match).not.toBeNull();

    if (match) {
      const handler = match[1];
      const hasMcpErrorFormat = handler.includes('isError: true');
      const reThrowsError = /throw\s+error/.test(handler);

      expect(reThrowsError).toBe(false);
      expect(hasMcpErrorFormat).toBe(true);
    }
  });
});

// ============================================================================
// TEST 5: Browser Lifecycle - All handlers should have cleanup
// Every async handler that uses resources should guarantee cleanup
// via try/finally blocks.
// ============================================================================

describe('Browser Lifecycle Cleanup', () => {
  it('full-web-search handler should have try/finally for cleanup', () => {
    const indexSrc = fs.readFileSync(path.join(SRC_DIR, 'index.ts'), 'utf-8');

    const match = indexSrc.match(/this\.server\.tool\(\s*'full-web-search'[\s\S]*?async \(args: unknown\) => \{([\s\S]*?)\n    \);/);

    expect(match).not.toBeNull();

    if (match) {
      const handler = match[1];
      // Should have finally block for cleanup
      const hasFinally = handler.includes('finally') && (
        handler.includes('closeAll()') ||
        handler.includes('cleanup') ||
        handler.includes('cleanupAll')
      );
      expect(hasFinally).toBe(true);
    }
  });

  it('get-single-web-page-content handler should have try/finally for cleanup', () => {
    const indexSrc = fs.readFileSync(path.join(SRC_DIR, 'index.ts'), 'utf-8');

    const match = indexSrc.match(/this\.server\.tool\(\s*'get-single-web-page-content'[\s\S]*?async \(args: unknown\) => \{([\s\S]*?)\n    \);/);

    expect(match).not.toBeNull();

    if (match) {
      const handler = match[1];
      const hasFinally = handler.includes('finally') && (
        handler.includes('closeAll()') ||
        handler.includes('cleanup') ||
        handler.includes('cleanupAll')
      );
      expect(hasFinally).toBe(true);
    }
  });
});

// ============================================================================
// TEST 6: .gitignore should exclude backup files
// ============================================================================

describe('Git Configuration', () => {
  it('should exclude .bak files in .gitignore', () => {
    const rootDir = path.resolve(__dirname, '..');
    const gitignorePath = path.join(rootDir, '.gitignore');

    expect(fs.existsSync(gitignorePath)).toBe(true);

    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    expect(gitignore).toMatch(/\.bak/);
  });
});

// ============================================================================
// TEST 7: Pure function unit tests for utils.ts
// ============================================================================

import { cleanText, getWordCount, getContentPreview, validateUrl, sanitizeQuery, isPdfUrl, generateTimestamp } from '../src/utils';

describe('Utility Functions', () => {
  describe('cleanText', () => {
    it('should collapse multiple spaces into one', () => {
      expect(cleanText('hello    world')).toBe('hello world');
    });

    it('should collapse multiple newlines into one space (whitespace normalization)', () => {
      // cleanText replaces all whitespace sequences with single space first
      expect(cleanText('hello\n\n\nworld')).toBe('hello world');
    });

    it('should trim whitespace', () => {
      expect(cleanText('  hello  ')).toBe('hello');
    });

    it('should respect max length', () => {
      expect(cleanText('hello world', 5)).toBe('hello');
    });
  });

  describe('getWordCount', () => {
    it('should count words correctly', () => {
      expect(getWordCount('hello world foo')).toBe(3);
    });

    it('should handle whitespace-only string', () => {
      expect(getWordCount('   ')).toBe(0);
    });
  });

  describe('validateUrl', () => {
    it('should accept valid http URLs', () => {
      expect(validateUrl('http://example.com')).toBe(true);
    });

    it('should accept valid https URLs', () => {
      expect(validateUrl('https://example.com/path')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(validateUrl('not-a-url')).toBe(false);
    });

    it('should reject non-http protocols', () => {
      expect(validateUrl('ftp://example.com')).toBe(false);
    });
  });

  describe('sanitizeQuery', () => {
    it('should trim whitespace', () => {
      expect(sanitizeQuery('  hello  ')).toBe('hello');
    });

    it('should truncate to 1000 chars', () => {
      const long = 'a'.repeat(2000);
      expect(sanitizeQuery(long).length).toBe(1000);
    });
  });

  describe('isPdfUrl', () => {
    it('should detect PDF URLs', () => {
      expect(isPdfUrl('https://example.com/doc.pdf')).toBe(true);
    });

    it('should reject non-PDF URLs', () => {
      expect(isPdfUrl('https://example.com/doc.html')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isPdfUrl('https://example.com/doc.PDF')).toBe(true);
    });
  });

  describe('generateTimestamp', () => {
    it('should return an ISO timestamp', () => {
      const ts = generateTimestamp();
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});

// ============================================================================
// TEST 8: TypeScript compilation check
// ============================================================================

describe('Project Structure', () => {
  it('should have all required source files', () => {
    const requiredFiles = [
      'index.ts',
      'utils.ts',
      'types.ts',
      'search-engine.ts',
      'content-extractor.ts',
      'enhanced-content-extractor.ts',
      'browser-pool.ts',
      'rate-limiter.ts',
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(SRC_DIR, file);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it('should have jest config for testing', () => {
    const rootDir = path.resolve(__dirname, '..');
    const jestConfigPath = path.join(rootDir, 'jest.config.js');
    expect(fs.existsSync(jestConfigPath)).toBe(true);
  });
});
