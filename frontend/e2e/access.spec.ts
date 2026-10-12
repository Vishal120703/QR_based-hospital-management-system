import { expect, test, type APIRequestContext } from '@playwright/test';
import { loadFixture, signIn, watchSecurityPolicy } from './fixture';

// What must not happen, and what must keep working, in a real browser.
const fixture = loadFixture();
const api = 'http://127.0.0.1:3101';

async function tokenFor(request: APIRequestContext, hospitalCode: string, email: string) {
  const response = await request.post(`${api}/auth/staff/login`, {
    data: { hospitalCode, email, password: fixture.password },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

test('another hospital never sees this hospital’s requests', async ({ page, request }) => {
  // Hospital A has a request (sent through the patient flow).
  const patient = await page.context().browser()!.newContext();
  const patientPage = await patient.newPage();
  await patientPage.goto(fixture.a.qrPath);
  await patientPage.getByRole('button', { name: 'Request Room Cleaning' }).click();
  await expect(patientPage.getByText('Your request is ready to track below.')).toBeVisible();
  await patient.close();

  const tokenA = await tokenFor(request, fixture.a.code, fixture.a.adminEmail);
  const listA = await request.get(`${api}/admin/requests?pageSize=100`, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  const requestsA = (
    (await listA.json()) as { serviceRequests: { id: string; publicId: string }[] }
  ).serviceRequests;
  const cleaning = requestsA.find((item) => item.publicId.startsWith('CR-'))!;

  // Hospital B's manager: not on their screen, and not by direct link either.
  await signIn(page, fixture.b.code, fixture.b.adminEmail, fixture.password);
  await page.goto('/admin/requests');
  await expect(page.getByText(/Showing 1–25 of 30/)).toBeVisible();
  await expect(page.getByText(cleaning.publicId)).toHaveCount(0);
  const tokenB = await tokenFor(request, fixture.b.code, fixture.b.adminEmail);
  const direct = await request.get(`${api}/admin/requests/${cleaning.id}`, {
    headers: { authorization: `Bearer ${tokenB}` },
  });
  expect(direct.status()).toBe(404);
});

test('care staff cannot open screens or act outside their role', async ({ page, request }) => {
  await signIn(page, fixture.a.code, fixture.a.nurseEmail, fixture.password);
  await expect(page.getByRole('link', { name: /Reports/ })).toHaveCount(0);
  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();

  const token = await tokenFor(request, fixture.a.code, fixture.a.nurseEmail);
  const reports = await request.get(`${api}/admin/reports/requests`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(reports.status()).toBe(403);
});

test('a wrong QR link or an ended patient session is explained', async ({ page }) => {
  await page.goto(`/q/${'x'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: 'We couldn’t connect' })).toBeVisible();

  await page.goto(fixture.a.qrPath);
  await expect(page).toHaveURL(/\/patient$/);
  // The stored patient access is no longer valid (for example after discharge).
  await page.evaluate(() => sessionStorage.setItem('careqr.guestToken', 'y'.repeat(43)));
  await page.reload();
  await expect(page.getByText(/scan the QR code on your bed|session has ended/i)).toBeVisible();
});

test('report dates that make no sense are explained, not a crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const blocked = watchSecurityPolicy(page);
  await signIn(page, fixture.a.code, fixture.a.adminEmail, fixture.password);
  await page.goto('/admin/reports');
  await page.getByRole('button', { name: 'Choose dates' }).click();
  await page.getByLabel('From').fill('');
  await expect(page.getByRole('alert')).toHaveText('Choose both a start and an end date.');
  await expect(page.getByRole('button', { name: 'Show' })).toBeDisabled();
  await expect(page.getByText('Overdue now')).toBeVisible();
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
});

test('the security policy blocks calls to any other site', async ({ page }) => {
  const blocked = watchSecurityPolicy(page);
  await page.goto('/login');
  const outcome = await page.evaluate(() =>
    fetch('https://example.com/collect').then(
      () => 'sent',
      () => 'blocked',
    ),
  );
  expect(outcome).toBe('blocked');
  await expect.poll(() => blocked.length).toBeGreaterThan(0);
  expect(blocked.join(' ')).toContain('connect-src');
});

test('older waiting requests stay reachable beyond the first page', async ({ page }) => {
  await signIn(page, fixture.b.code, fixture.b.adminEmail, fixture.password);
  await page.goto('/admin/requests');
  const oldest = fixture.b.waitingPublicIds[0]!;
  const newest = fixture.b.waitingPublicIds.at(-1)!;
  // Oldest first: the longest-waiting request is on page 1.
  await expect(page.getByText(oldest)).toBeVisible();
  await expect(page.getByText(newest)).toHaveCount(0);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await expect(page.getByText(newest)).toBeVisible();
});

// Chromium only: other browsers' PDF viewers are not covered here.
test('QR labels open as a PDF in a new tab under the security policy', async ({ page }) => {
  await signIn(page, fixture.a.code, fixture.a.adminEmail, fixture.password);
  await page.goto('/admin/beds');
  const row = page.locator('tr', { hasText: 'Bed A2' });
  await row.getByRole('button', { name: 'Generate QR' }).click();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open PDF to print' }).click();
  // The tab opens blank, then moves to the PDF once it is built.
  const tab = await popup;
  const blocked = watchSecurityPolicy(tab);
  await expect(page.getByText('The PDF opened in a new tab.')).toBeVisible();
  await tab.waitForURL(/^blob:/);
  await tab.waitForLoadState();
  // Give the PDF viewer a moment to load the document.
  await tab.waitForTimeout(1_000);
  expect(blocked).toEqual([]);
});
