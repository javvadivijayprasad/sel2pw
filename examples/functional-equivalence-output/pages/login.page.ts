import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.locator("#user-name");
    this.passwordInput = page.locator("#password");
    this.loginButton = page.locator("#login-button");
    this.errorMessage = page.locator("[data-test='error']");
  }

  async open(): Promise<void> {
    await this.page.goto("https://www.saucedemo.com/");
  }

  async enterUsername(username: string): Promise<void> {
    await this.usernameInput.fill(username);
  }

  async enterPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  async clickLogin(): Promise<void> {
    await this.loginButton.click();
  }

  async getErrorMessage(): Promise<string> {
    return await this.errorMessage.innerText();
  }

  async loginAs(username: string, password: string): Promise<void> {
    await this.enterUsername(username);
    await this.enterPassword(password);
    await this.clickLogin();
  }
}
