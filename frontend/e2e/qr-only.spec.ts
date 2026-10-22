import { expect, test } from '@playwright/test';
import { loadFixture, signIn, watchSecurityPolicy } from './fixture';

// A hospital that uses QR codes only: no admissions, no bed management.
const fixture = loadFixture();

test('a bedside QR works without admission when the hospital uses QR codes only', async ({
  browser,
}, testInfo) => {
  const patientContext = await browser.newContext();
  const patient = await patientContext.newPage();
  const patientBlocked = watchSecurityPolicy(patient);
  await patient.goto(fixture.c.qrPath);
  await expect(patient).toHaveURL(/\/patient$/);
  await patient.getByRole('button', { name: 'Request Drinking Water' }).click();
  await expect(patient.getByText('Your request is ready to track below.')).toBeVisible();

  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  const managerBlocked = watchSecurityPolicy(manager);
  await signIn(manager, fixture.c.code, fixture.c.adminEmail, fixture.password);
  const menu = manager.getByRole('navigation', { name: 'Hospital administration' });
  await expect(menu.getByRole('link', { name: 'QR codes' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Bed management' })).toHaveCount(0);
  await expect(manager.getByText('Beds with a QR')).toBeVisible();
  await manager.screenshot({ path: testInfo.outputPath('qr-only-overview.png'), fullPage: true });

  // The request reached the queue although nobody was admitted.
  await menu.getByRole('link', { name: /Requests/ }).click();
  await expect(
    manager.locator('article.request-card', { hasText: 'Drinking Water' }),
  ).toBeVisible();

  await menu.getByRole('link', { name: 'Settings' }).click();
  await expect(manager.getByRole('radio', { name: /QR codes only/ })).toBeChecked();
  await manager
    .getByRole('region', { name: 'Bed management' })
    .screenshot({ path: testInfo.outputPath('qr-only-settings.png') });

  // Opening Bed management by its address explains that it is off.
  await manager.goto('/admin/bed-management');
  await expect(
    manager.getByRole('heading', { name: 'Bed management is turned off' }),
  ).toBeVisible();
  expect(patientBlocked).toEqual([]);
  expect(managerBlocked).toEqual([]);
  await patientContext.close();
  await managerContext.close();
});
