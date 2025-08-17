/**
 * Utility to run a test function across Chromium, Chrome, and Edge channels.
 * Also includes isBrowserInstalled utility (inlined from browser-installed.js).
 */
import { chromium } from 'playwright';

// Utility to check if a Playwright browser channel is installed
async function isBrowserInstalled(channel) {
  try {
    await chromium.executablePath({ channel });
    return true;
  } catch {
    return false;
  }
}

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
