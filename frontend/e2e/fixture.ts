import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type ConsoleMessage, type Page } from '@playwright/test';

// What global setup made for this run: two hospitals in the test database.
export interface Fixture {
  password: string;
  operatorEmail: string;
  a: { code: string; adminEmail: string; nurseEmail: string; qrPath: string };
  b: { code: string; adminEmail: string; waitingPublicIds: string[] };
}

export const fixturePath = fileURLToPath(new URL('./.fixture.json', import.meta.url));

export function loadFixture(): Fixture {
  if (!existsSync(fixturePath)) throw new Error('Run the tests with Playwright (global setup).');
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
}

// Collects anything the Content Security Policy blocks on this page.
export function watchSecurityPolicy(page: Page): string[] {
  const blocked: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) blocked.push(message.text());
  });
  return blocked;
}

export async function signIn(page: Page, hospitalCode: string, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Hospital code').fill(hospitalCode);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin/);
}
