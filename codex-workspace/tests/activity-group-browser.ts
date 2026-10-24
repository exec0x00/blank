import type { Locator, Page } from '@playwright/test';

/** Open only mounted groups; tool detail remains an independent disclosure. */
export async function expandActivityGroups(scope: Page | Locator): Promise<void> {
  for (const toggle of await scope.locator('.chat-activity-group-toggle').all()) {
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  }
}
