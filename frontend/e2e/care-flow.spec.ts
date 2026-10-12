import { expect, test } from '@playwright/test';
import { loadFixture, signIn, watchSecurityPolicy } from './fixture';

// The whole operational flow, in a real browser against the real API.
const fixture = loadFixture();
const hospitalToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
  new Date(),
);

test('a patient’s request is assigned, done, closed, and counted in today’s report', async ({
  browser,
}) => {
  // 1. The patient scans the bedside QR and asks for drinking water.
  const patientContext = await browser.newContext();
  const patient = await patientContext.newPage();
  const patientBlocked = watchSecurityPolicy(patient);
  const scan = await patient.goto(fixture.a.qrPath);
  // Production security headers (from vercel.json) are sent.
  expect(scan?.headers()['referrer-policy']).toBe('no-referrer');
  expect(scan?.headers()['x-frame-options']).toBe('DENY');
  await expect(patient).toHaveURL(/\/patient$/);
  await patient.getByRole('button', { name: 'Request Drinking Water' }).click();
  await expect(patient.getByText('Your request is ready to track below.')).toBeVisible();

  // 2–3. A manager sees it in the queue and assigns it. The manager's
  // computer is in another time zone than the hospital.
  const managerContext = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  const manager = await managerContext.newPage();
  const managerBlocked = watchSecurityPolicy(manager);
  await signIn(manager, fixture.a.code, fixture.a.adminEmail, fixture.password);
  await expect(manager.getByRole('button', { name: /Notifications, [1-9]\d* unread/ })).toBeVisible(
    { timeout: 15000 },
  );
  await manager.getByRole('button', { name: /Notifications,/ }).click();
  await expect(manager.getByRole('dialog', { name: 'Your notifications' })).toBeVisible();
  await expect(
    manager.getByRole('dialog').getByText('New request needs assignment').first(),
  ).toBeVisible();
  await manager.getByRole('button', { name: 'Close dialog' }).click();
  await manager
    .getByRole('link', { name: /Requests/ })
    .first()
    .click();
  const card = manager.locator('article.request-card', { hasText: 'Drinking Water' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Choose staff' }).click();
  await card.getByRole('combobox').selectOption({ label: 'Pavan Pantry' });
  await card.getByRole('button', { name: 'Assign request' }).click();
  await expect(manager.getByText('Request assigned.')).toBeVisible();

  // 4. The staff member accepts, starts, and completes it.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const staffBlocked = watchSecurityPolicy(staff);
  await signIn(staff, fixture.a.code, fixture.a.nurseEmail, fixture.password);
  // The persisted assignment arrives via Socket.IO. Marking it read changes
  // only the inbox, then its authorized link opens that request in the board.
  await expect(staff.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible({
    timeout: 15000,
  });
  await staff.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  await expect(staff.getByText('Request assigned to you').last()).toBeVisible();
  await staff.getByRole('button', { name: 'Mark as read' }).click();
  await expect(staff.getByRole('button', { name: 'Notifications, 0 unread' })).toBeVisible();
  await staff.setViewportSize({ width: 390, height: 844 });
  await expect(staff.getByRole('link', { name: 'Open request' })).toBeVisible();
  expect(
    await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await staff.keyboard.press('Escape');
  await staff.reload();
  await staff.getByRole('button', { name: 'Notifications, 0 unread' }).click();
  await expect(staff.getByRole('dialog').getByText('Read', { exact: true })).toBeVisible();
  await staff.getByRole('link', { name: 'Open request' }).click();
  const work = staff.locator('article.request-card', { hasText: 'Drinking Water' });
  await work.getByRole('button', { name: 'Accept' }).click();
  await work.getByRole('button', { name: 'Start work' }).click();
  await work.getByRole('button', { name: 'Mark complete' }).click();
  await expect(staff.getByText('Request completed.')).toBeVisible();

  // The manager closes it from "Ready to close".
  await manager.reload();
  await manager.getByRole('button', { name: /Ready to close/ }).click();
  await manager
    .locator('article.request-card', { hasText: 'Drinking Water' })
    .getByRole('button', { name: 'Close request' })
    .click();
  await expect(manager.getByText('Request closed.')).toBeVisible();

  // The patient sees it closed.
  await patient.getByRole('button', { name: 'Refresh status' }).click();
  await expect(patient.locator('.pp-requests').getByText('Closed').first()).toBeVisible();

  // 5. Today's report (the hospital's day, not the manager's) counts it.
  const reportCall = manager.waitForRequest((request) =>
    request.url().includes('/admin/reports/requests?'),
  );
  await manager.goto('/admin/reports?period=today');
  expect((await reportCall).url()).toContain(`from=${hospitalToday}&to=${hospitalToday}`);
  const completed = manager
    .locator('.stat')
    .filter({ has: manager.getByText('Completed', { exact: true }) });
  await expect(completed.locator('strong')).toHaveText('1');

  // Nothing was blocked by the Content Security Policy along the way.
  expect([...patientBlocked, ...managerBlocked, ...staffBlocked]).toEqual([]);
  await Promise.all([patientContext.close(), managerContext.close(), staffContext.close()]);
});
