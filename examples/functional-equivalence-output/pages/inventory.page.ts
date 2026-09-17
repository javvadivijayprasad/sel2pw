import { Page, Locator, expect } from '@playwright/test';

export class InventoryPage {
  readonly page: Page;
  readonly pageTitle: Locator;
  readonly firstInventoryItem: Locator;
  readonly cartLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageTitle = page.locator(".title");
    // [MANUAL EDIT #2 — Selenium/Playwright strict-mode gap]
    // Java `@FindBy(css=".inventory_item")` implicitly took the first match
    // (Selenium `findElement` semantics). Playwright's `page.locator(...)`
    // matches all 6 inventory items; `.isVisible()` on that ambiguous
    // locator throws "strict mode violation". Adding `.first()` restores
    // the original single-element intent. A future sel2pw patch could
    // detect this idiom automatically when `.isDisplayed()` is called on
    // a multi-match locator; for now, a one-line hand edit.
    this.firstInventoryItem = page.locator(".inventory_item").first();
    this.cartLink = page.locator("#shopping_cart_container");
  }

  async getPageTitle(): Promise<string> {
    return await this.pageTitle.innerText();
  }

  async isInventoryVisible(): Promise<boolean> {
    return await this.firstInventoryItem.isVisible();
  }

  async isCartVisible(): Promise<boolean> {
    return await this.cartLink.isVisible();
  }
}
