import assert from 'assert';
import puppeteer from 'puppeteer-core';

const FRONTEND_URL = process.env.TEST_FRONTEND_URL || 'http://localhost:5173';

async function visitAndAssertHeading(page: any, url: string, expectedHeading: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (expected: string) => {
      const h1 = document.querySelector('h1');
      return Boolean(h1 && h1.textContent && h1.textContent.trim() === expected);
    },
    { timeout: 15000 },
    expectedHeading
  );
  return page.$eval('h1', (el: any) => el.innerText.trim());
}

async function signIn(page: any, email: string, password: string) {
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !window.location.pathname.startsWith('/login'), { timeout: 15000 });
}

async function runBrowserE2ETest() {
  console.log('--- Running Automated End-to-End Browser Test Suite ---');

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900', '--user-data-dir=/tmp/bv-browser-test-' + Date.now()],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors: string[] = [];
  page.on('console', (msg: any) => {
    if (msg.type() === 'error') {
      errors.push(`[Console Error] ${msg.text()}`);
    }
  });

  page.on('pageerror', (err: any) => {
    errors.push(`[Page Error] ${err.message}`);
  });

  // 1. Customer Authentication Flow
  console.log('Step 1: Testing customer sign-in on /login...');
  await signIn(page, 'harendrakasa@gmail.com', 'KH20057v@balancev');

  assert.strictEqual(page.url(), `${FRONTEND_URL}/dashboard`, 'Customer must be redirected to /dashboard');
  await page.waitForFunction(
    () => {
      const h = document.querySelector('h1, h2');
      return Boolean(h && h.textContent && h.textContent.includes('Good to see you'));
    },
    { timeout: 15000 }
  );
  const dashboardHeading = await page.$eval('h1, h2', (el: any) => el.innerText);
  assert.ok(dashboardHeading.includes('Good to see you'), 'Dashboard must display customer greeting');
  console.log(`✓ Customer dashboard verified: "${dashboardHeading}"`);

  // 2. Accounts View
  console.log('Step 2: Testing /accounts view...');
  await page.goto(`${FRONTEND_URL}/accounts`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('BV-INR-'), { timeout: 15000 });
  const accountsText = await page.evaluate(() => document.body.innerText);
  assert.ok(accountsText.includes('BV-INR-'), 'Accounts view must display active accounts');
  console.log('✓ Accounts page rendered active accounts.');

  // 3. Statements View
  console.log('Step 3: Testing /statements view...');
  const statementsHeading = await visitAndAssertHeading(page, `${FRONTEND_URL}/statements`, 'Account statements');
  assert.strictEqual(statementsHeading, 'Account statements');
  console.log('✓ Statements page rendered successfully.');

  // 4. Financial Transactions View (Deposit / Withdrawal / Transfer)
  console.log('Step 4: Testing financial transaction views...');
  const depositHeading = await visitAndAssertHeading(page, `${FRONTEND_URL}/transactions/deposit`, 'Deposit');
  assert.strictEqual(depositHeading, 'Deposit');

  const withdrawHeading = await visitAndAssertHeading(page, `${FRONTEND_URL}/transactions/withdrawal`, 'Withdrawal');
  assert.strictEqual(withdrawHeading, 'Withdrawal');

  const transferHeading = await visitAndAssertHeading(page, `${FRONTEND_URL}/transactions/transfer`, 'Transfer');
  assert.strictEqual(transferHeading, 'Transfer');
  console.log('✓ Deposit, withdrawal, and transfer pages rendered without errors.');

  // 5. Account Onboarding Request View
  console.log('Step 5: Testing /account-requests view...');
  const reqHeading = await visitAndAssertHeading(page, `${FRONTEND_URL}/account-requests`, 'Account request');
  assert.strictEqual(reqHeading, 'Account request');
  console.log('✓ Account requests view verified.');

  // 6. Admin Authentication & Admin Views
  console.log('Step 6: Testing admin sign-in and management views...');
  await page.evaluate(() => sessionStorage.clear());
  await signIn(page, 'admin@balancevault.internal', 'AdminVault2026!');

  // Admin Users
  const adminUsersHeading = await visitAndAssertHeading(page, `${FRONTEND_URL}/admin/users`, 'User management');
  assert.strictEqual(adminUsersHeading, 'User management');

  // Admin Onboarding
  const onboardingHeading = await visitAndAssertHeading(page, `${FRONTEND_URL}/admin/onboarding`, 'Account onboarding');
  assert.strictEqual(onboardingHeading, 'Account onboarding');

  // Audit Log
  const auditHeading = await visitAndAssertHeading(page, `${FRONTEND_URL}/audit`, 'Audit log');
  assert.strictEqual(auditHeading, 'Audit log');
  console.log('✓ Admin users, onboarding queue, and audit log pages rendered successfully.');

  // Final Console Error Assertion
  assert.strictEqual(errors.length, 0, `Browser encountered errors: ${errors.join(', ')}`);

  await browser.close();
  console.log('--- ALL BROWSER E2E TESTS PASSED WITH 0 ERRORS ---');
}

runBrowserE2ETest().catch((err) => {
  console.error('Browser E2E test failed:', err);
  process.exit(1);
});
