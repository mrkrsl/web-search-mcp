import { execSync } from 'child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * MCP Integration Tests
 * Tests the MCP tool registration and validation behavior
 * using the actual @modelcontextprotocol/sdk McpServer class.
 * 
 * Note: These don't test the full stdio transport (would require spawning the server),
 * but validate tool registration, Zod schema behavior, and error handling.
 */

describe('MCP SDK Integration', () => {
  describe('Zod validation in tool schemas', () => {
    it('should transform string limit to number correctly', () => {
      const schema = z.union([z.number(), z.string()]).transform((val) => {
        const num = typeof val === 'string' ? parseInt(val, 10) : val;
        return num;
      });

      expect(schema.parse('5')).toBe(5);
      expect(schema.parse(5)).toBe(5);
    });

    it('should throw ZodError for invalid limit in transform', () => {
      const schema = z.union([z.number(), z.string()]).transform((val) => {
        const num = typeof val === 'string' ? parseInt(val, 10) : val;
        if (isNaN(num) || num < 1 || num > 10) {
          throw new Error('Invalid limit: must be a number between 1 and 10');
        }
        return num;
      });

      expect(() => schema.parse('abc')).toThrow('Invalid limit');
      expect(() => schema.parse(0)).toThrow('Invalid limit');
      expect(() => schema.parse(15)).toThrow('Invalid limit');
    });

    it('should transform string boolean correctly', () => {
      const schema = z.union([z.boolean(), z.string()]).transform((val) => {
        if (typeof val === 'string') {
          return val.toLowerCase() === 'true';
        }
        return Boolean(val);
      });

      expect(schema.parse('true')).toBe(true);
      expect(schema.parse('false')).toBe(false);
      expect(schema.parse(true)).toBe(true);
      expect(schema.parse(false)).toBe(false);
    });

    it('should handle optional maxContentLength with zero meaning no limit', () => {
      const schema = z.union([z.number(), z.string()]).transform((val) => {
        const num = typeof val === 'string' ? parseInt(val, 10) : val;
        if (isNaN(num) || num < 0) {
          throw new Error('Invalid maxContentLength: must be a non-negative number');
        }
        return num;
      }).optional();

      expect(schema.parse(0)).toBe(0);
      expect(schema.parse('1000')).toBe(1000);
      expect(schema.parse(undefined)).toBe(undefined);
      expect(() => schema.parse(-1)).toThrow('Invalid maxContentLength');
    });
  });

  describe('Tool handler error handling pattern', () => {
    it('should return isError response when validation throws inside handler', () => {
      // Simulates the pattern used in handler try/catch blocks
      const handler = async (args: unknown) => {
        try {
          if (typeof args !== 'object' || args === null) {
            throw new Error('Invalid arguments: args must be an object');
          }
          return {
            content: [{ type: 'text' as const, text: 'success' }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: `Operation failed: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      };

      const result = handler(null as unknown as Record<string, unknown>);
      expect(result).resolves.toEqual({
        content: [{ type: 'text', text: 'Operation failed: Invalid arguments: args must be an object' }],
        isError: true,
      });
    });
  });

  describe('McpServer tool registration', () => {
    let server: McpServer;

    beforeEach(() => {
      server = new McpServer({
        name: 'test-server',
        version: '1.0.0',
      });
    });

    it('should register a tool without throwing', () => {
      expect(() => {
        server.tool(
          'test-tool',
          'A test tool',
          {
            query: z.string().describe('The query'),
          },
          async (args) => ({
            content: [{ type: 'text' as const, text: JSON.stringify(args) }],
          })
        );
      }).not.toThrow();
    });
  });

  describe('Handler validation should not duplicate Zod schema', () => {
    it('should have no manual type checks that duplicate Zod validation in handlers', () => {
      // The source should not contain redundant validation patterns like:
      // "if (typeof args !== 'object' || args === null) { throw new Error('Invalid arguments"
      // because the Zod schema already validates this via the SDK before the handler runs.
      const src = execSync('cat src/index.ts', { encoding: 'utf-8' });
      const lines = src.split('\n');

      // Count manual validation patterns that duplicate Zod schema
      const redundantPatterns = [
        /typeof args !== 'object' \|\| args === null/,
        /!obj\.query \|\| typeof obj\.query !== 'string'/,
        /!obj\.url \|\| typeof obj\.url !== 'string'/,
      ];

      const violations: { line: number; content: string }[] = [];
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of redundantPatterns) {
          if (pattern.test(lines[i])) {
            violations.push({ line: i + 1, content: lines[i].trim() });
          }
        }
      }

      expect(violations).toEqual([]);
    });

    it('should not have validateAndConvertArgs duplicating Zod schema', () => {
      // validateAndConvertArgs duplicates Zod schema validation and should be removed
      const src = execSync('cat src/index.ts', { encoding: 'utf-8' });
      expect(src).not.toContain('validateAndConvertArgs');
    });

    it('should not throw Error in handleWebSearch', () => {
      // handleWebSearch should not throw; errors should be converted to MCP error responses
      const src = execSync('cat src/index.ts', { encoding: 'utf-8' });
      const lines = src.split('\n');

      // Find the method definition specifically
      const handleWebSearchStart = lines.findIndex((l: string) => l.includes('private async handleWebSearch('));
      // The method ends at the next method or the class closing brace
      const handleWebSearchBlock = lines.slice(handleWebSearchStart).join('\n');
      // Check within the method body only (not Zod transforms above it)
      const methodBody = handleWebSearchBlock.split('\n  private categorizeFailureReasons')[0];

      expect(methodBody).not.toContain("throw new Error");
    });
  });
});
