import { expect, test } from '@playwright/test';
import { loadFixture, signIn, watchSecurityPolicy } from './fixture';

const fixture = loadFixture();
const screens = [
  'overview',
  'requests',
  'hospital',
  'settings',
  'bed-management',
  'beds',
  'locations',
  'departments',
  'staff',
  'roles',
  'eligibility',
  'services',
  'sla',
  'reports',
  'audit',
  'password',
];

// Every hospital navigation destination in a real production-build browser.
// Table regions may scroll internally; the page/header must fit the viewport.
for (const width of [1440, 1024, 768, 390, 360]) {
  test(`hospital screen tour fits ${width}px without runtime or API errors`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const blocked = watchSecurityPolicy(page);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().startsWith('http://127.0.0.1:3101/') && response.status() >= 400)
        errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await signIn(page, fixture.a.code, fixture.a.adminEmail, fixture.password);
    for (const screen of screens) {
      await page.goto(`/admin/${screen}`);
      await expect(page.locator('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(
        page
          .locator('main')
          .getByRole('status')
          .filter({ hasText: /^(Loading|Checking)/ }),
      ).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Access restricted' })).toHaveCount(0);
      await expect(page.locator('main .load-state')).toHaveCount(0);
      if (screen === 'staff' || screen === 'locations')
        await page.screenshot({
          path: testInfo.outputPath(`${screen}-${width}.png`),
          fullPage: true,
        });
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });
      expect(
        await page.locator('main').evaluate((main) => main.scrollWidth <= main.clientWidth),
        `${screen}: main content`,
      ).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        screen,
      ).toBe(true);
      if (screen === 'overview' || screen === 'requests')
        await page.screenshot({
          path: testInfo.outputPath(`${screen}-${width}.png`),
          fullPage: true,
        });
    }
    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
  });
}

test('patient entry and bedside service flow fit a small phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Scan your bedside QR' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('patient-entry-360.png'), fullPage: true });
  await page
    .getByLabel('Paste the bedside QR link')
    .fill(`http://127.0.0.1:4173${fixture.a.qrPath}`);
  await page.getByRole('button', { name: 'Open patient page' }).click();
  await expect(page).toHaveURL(/\/patient$/);
  await expect(page.getByRole('button', { name: 'Request Drinking Water' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('patient-services-360.png'), fullPage: true });
  expect(errors).toEqual([]);
});

for (const width of [1440, 390, 360]) {
  test(`platform navigation fits ${width}px and sign-out reaches login`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/platform/login');
    await page.getByLabel('Email').fill(fixture.operatorEmail);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/platform$/);
    for (const path of ['/platform', '/platform/hospitals']) {
      await page.goto(path);
      await expect(page.locator('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });
      expect(
        await page.locator('main').evaluate((main) => main.scrollWidth <= main.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`platform-${path.split('/').at(-1)}-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/platform\/login$/);
    expect(errors).toEqual([]);
  });
}
