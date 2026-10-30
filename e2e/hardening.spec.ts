import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD!;
const MAIL_API = `http://127.0.0.1:${process.env.E2E_MAIL_HTTP_PORT ?? 3126}/messages`;

type Mail = { to: string[]; subject: string; text: string; html: string };

async function waitForMail(page: Page, to: string, subject: RegExp, timeoutMs = 20_000): Promise<Mail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await page.request.get(`${MAIL_API}?to=${encodeURIComponent(to)}`);
    const mails = (await response.json()) as Mail[];
    const match = mails.reverse().find((m) => subject.test(m.subject));
    if (match) return match;
    await page.waitForTimeout(500);
  }
  throw new Error(`No email "${subject}" for ${to}`);
}

async function signIn(page: Page, path: '/login' | '/admin/login', email: string, password: string) {
  await page.goto(path);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('customer resets a forgotten password through the emailed single-use link', async ({ page }) => {
  const email = 'farhan@mkjmart.demo';
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('If an account exists for that email')).toBeVisible();

  const mail = await waitForMail(page, email, /Reset your MKJ Store password/);
  const link = /http:\/\/localhost:\d+\/reset-password\?token=[A-Za-z0-9_%-]+/.exec(mail.text)![0];
  await page.goto(link);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('Fresh-start-2026');
  await page.getByRole('textbox', { name: 'Confirm new password' }).fill('Fresh-start-2026');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('heading', { name: /Hello, Farhan/ })).toBeVisible();

  // The link is single-use.
  await page.goto(link);
  await expect(page.getByText('This link has expired or was already used')).toBeVisible();
  // The old password no longer works; the new one does.
  await page.context().clearCookies();
  await signIn(page, '/login', email, DEMO_PASSWORD);
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  await signIn(page, '/login', email, 'Fresh-start-2026');
  await expect(page.getByRole('heading', { name: /Hello, Farhan/ })).toBeVisible();
});

test('customer requests a return; staff approve and receive it; an admin records the refund', async ({ page, browser }) => {
  await signIn(page, '/login', 'tanvir@mkjmart.demo', DEMO_PASSWORD);
  await expect(page.getByRole('heading', { name: /Hello, Tanvir/ })).toBeVisible();
  await page.goto('/account/orders');
  await page.locator('a[href^="/orders/"]').filter({ hasText: 'Delivered' }).first().click();
  await expect(page.getByTestId('returns-panel')).toBeVisible();
  await page.getByTestId('request-return').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^More / }).first().click();
  await dialog.getByLabel('Reason').selectOption('size_fit');
  await dialog.getByLabel('Anything else we should know?').fill('One size too large.');
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByTestId('returns-panel')).toContainText('Requested');
  const requestNumber = /RT-[A-Z0-9]{7}/.exec((await page.getByTestId('returns-panel').textContent())!)![0];

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, '/admin/login', 'admin@mkjmart.demo', DEMO_PASSWORD);
  await expect(admin.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await admin.goto('/admin/returns');
  await admin.getByRole('link', { name: requestNumber }).click();
  await admin.getByTestId('return-action-approve').click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByTestId('return-action-receive')).toBeVisible();
  await admin.getByTestId('return-action-receive').click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Mark received' }).click();
  await admin.getByTestId('record-refund').click();
  const refund = admin.getByRole('dialog');
  await refund.getByLabel('Reference').fill('BKASH-TRX-E2E');
  await refund.getByRole('checkbox', { name: /already been refunded/ }).check();
  await refund.getByRole('button', { name: 'Record refund' }).click();
  await expect(admin.getByText('Refund recorded.')).toBeVisible();
  await adminContext.close();

  await page.reload();
  await expect(page.getByTestId('returns-panel')).toContainText('Refunded');
  await expect(page.getByText('Refunded', { exact: true }).first()).toBeVisible();
});

test('support messages reach the admin inbox', async ({ page, browser }) => {
  await page.goto('/support');
  await expect(page.getByRole('heading', { name: 'Help & contact' })).toBeVisible();
  await page.getByLabel('Your name').fill('Rokeya Begum');
  await page.getByLabel('Topic').selectOption('delivery');
  await page.getByLabel('Email').fill('rokeya@example.test');
  await page.getByRole('textbox', { name: 'Message' }).fill('Do you deliver to Cox’s Bazar, and how long does it take?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Message received')).toBeVisible();
  const reference = /SR-[A-Z0-9]{7}/.exec((await page.getByRole('status').filter({ hasText: 'Message received' }).textContent())!)![0];
  const ack = await waitForMail(page, 'rokeya@example.test', /We received your message/);
  expect(ack.subject).toContain(reference);

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, '/admin/login', 'staff@mkjmart.demo', DEMO_PASSWORD);
  await expect(admin.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await admin.goto('/admin/support');
  await admin.getByRole('link', { name: reference }).click();
  await expect(admin.getByText('Cox’s Bazar')).toBeVisible();
  await admin.getByLabel('Status').selectOption('resolved');
  await admin.getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByText('Saved')).toBeVisible();
  await adminContext.close();
});

test('admin sees a live launch-readiness checklist', async ({ page }) => {
  await signIn(page, '/admin/login', 'admin@mkjmart.demo', DEMO_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.goto('/admin/settings');
  const checklist = page.getByTestId('launch-checklist');
  await expect(checklist).toBeVisible();
  // This E2E store intentionally contains demo data and template policies.
  await expect(checklist.locator('li', { hasText: 'Demo data removed' })).toHaveAttribute('data-status', /fail|warn/);
  await expect(checklist.locator('li', { hasText: 'Policies reviewed' })).toHaveAttribute('data-status', 'warn');
  await expect(checklist.locator('li', { hasText: 'Outgoing email (SMTP)' })).toHaveAttribute('data-status', 'ok');
});

test.describe('accessibility (axe, WCAG 2 A/AA)', () => {
  for (const path of ['/', '/shop', '/products/heavyweight-cotton-tee', '/cart', '/login', '/register', '/forgot-password', '/support', '/track-order', '/policies/returns']) {
    test(`no serious or critical violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')})`)).toEqual([]);
    });
  }
});
