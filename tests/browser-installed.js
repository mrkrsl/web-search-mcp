// Utility to check if a Playwright browser channel is installed
import { chromium } from 'playwright';

export async function isBrowserInstalled(channel) {
  try {
    await chromium.executablePath({ channel });
    return true;
  } catch {
    return false;
  }
}
