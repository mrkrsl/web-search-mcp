// Utility to run all test modules in sequence
import { execSync } from 'child_process';

const testFiles = [
  'tests/test-all-engines.js',
  'tests/test-bing.js',
  'tests/test-brave.js',
  'tests/test-duckduckgo.js',
  'tests/test-search.js',
];

let allPassed = true;

for (const file of testFiles) {
  console.log(`\n[run-all-tests] Running: ${file}`);
  try {
    execSync(`node ${file}`, { stdio: 'inherit' });
  } catch (err) {
    allPassed = false;
    console.error(`[run-all-tests] Test failed: ${file}`);
  }
}

if (allPassed) {
  console.log('\nAll tests passed ✅');
  process.exit(0);
} else {
  console.log('\nSome tests failed ❌');
  process.exit(1);
}
