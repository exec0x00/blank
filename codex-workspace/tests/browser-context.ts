import type { Browser, BrowserContext, BrowserContextOptions } from '@playwright/test';
import { browserLaunchOptions } from './browser-launch';

export interface OwnedBrowserContext {
  context: BrowserContext;
  close(): Promise<void>;
}

/** Additional clients use independent real Chromium instances only on the
 * constrained host. Ordinary runs keep the existing browser/context topology. */
export async function extraBrowserContext(browser: Browser, options: BrowserContextOptions): Promise<OwnedBrowserContext> {
  let owner: Browser | undefined;
  try {
    const target = process.env.CODEX_BROWSER_LOW_THREADS === '1'
      ? owner = await browser.browserType().launch(browserLaunchOptions())
      : browser;
    const context = await target.newContext(options);
    let closing: Promise<void> | undefined;
    return {
      context,
      close() {
        return closing ??= (async () => {
          try { await context.close(); }
          finally { await owner?.close(); }
        })();
      },
    };
  } catch (error) {
    await owner?.close();
    throw error;
  }
}
