/**
 * Utility to run a test function across Chromium, Chrome, and Edge channels.
 * Also includes isBrowserInstalled utility (inlined from browser-installed.js).
 */
import { chromium } from 'playwright';

// Utility to check if a Playwright browser channel is installed
/**
 * Checks if a specific Playwright browser channel is installed.
 * @param {string} channel - The name of the browser channel to check (e.g., 'chrome', 'msedge').
 * @returns {Promise<boolean>} Resolves to true if the browser channel is installed, false otherwise.
 */
async function isBrowserInstalled(channel) {
  try {
    await chromium.executablePath({ channel });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs a test function across multiple browser channels (Chromium, Chrome, Edge).
 * For each channel, checks if the browser is installed, runs the test if so, and reports results.
 * Skips tests for browsers that are not installed.
 * Exits the process with code 0 if all tests pass, or 1 if any test fails.
 *
 * @param {(channel: string|undefined) => Promise<boolean>} testFn - 
 *   An async callback that receives the browser channel name (or undefined for default Chromium)
 *   and returns a Promise resolving to true (pass) or false (fail).
 * @param {string} label - A label describing the test, used in output messages.
 */
export async function runMultiBrowserTest(testFn, label) {
  const channels = [
    { channel: undefined, label: 'chromium' },
    { channel: 'chrome', label: 'chrome' },
    { channel: 'msedge', label: 'edge' },
  ];

  let allPassed = true;

  for (const { channel, label: channelLabel } of channels) {
    let installed = true;
    if (channel) {
      installed = await isBrowserInstalled(channel);
    }
    if (!installed) {
      console.log(`\nSKIPPING ${channelLabel.toUpperCase()} TEST: Browser not installed (xfail)`);
      continue;
    }
    console.log(`\n[runMultiBrowserTest] Running "${label}" on browser: ${channelLabel}`);
    const success = await testFn(channel);
    allPassed = allPassed && success;
  }

  console.log(`\n${label} RESULT: ${allPassed ? 'WORKING ✅' : 'FAILED ❌'}`);
  process.exit(allPassed ? 0 : 1);
}
