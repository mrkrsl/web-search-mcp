import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile: 'dist/bundle.js',
    external: [
      // Node.js built-in modules that should not be bundled
      'util',
      'fs',
      'path',
      'url',
      'http',
      'https',
      'stream',
      'crypto',
      'zlib',
      'querystring',
      'events',
      'buffer',
      'process',
      'os',
      'child_process',
      'net',
      'tls',
      'dns',
      'assert',
      'constants',
      'domain',
      'punycode',
      'string_decoder',
      'timers',
      'tty',
      'vm',
      'worker_threads',
      // External npm packages that should not be bundled
      'playwright',
      'playwright-core',
      'chromium-bidi',
      // Additional externals to prevent bundling issues
      'form-data',
      'combined-stream',
      'mime-types',
      'mime-db',
      'axios',
    ],
    sourcemap: true,
    minify: false, // Keep readable for debugging
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  console.log('✅ Bundle created: dist/bundle.js');
} catch (error) {
  console.error('❌ Bundle failed:', error);
  process.exit(1);
}
