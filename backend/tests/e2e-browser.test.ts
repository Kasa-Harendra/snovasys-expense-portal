import assert from 'assert';
import puppeteer from 'puppeteer-core';

const FRONTEND_URL = process.env.TEST_FRONTEND_URL || 'http://localhost:5173';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'domcontentloaded' });
  await sleep(1000);
  await page.type('input[type="email"]', 'harendrakasa@gmail.com');
  await page.type('input[type="password"]', 'KH20057v@balancev');
  await page.click('button[type="submit"]');
  await sleep(2500);

  assert.strictEqual(page.url(), `${FRONTEND_URL}/dashboard`, 'Customer must be redirected to /dashboard');
  const dashboardHeading = await page.$eval('h1, h2', (el: any) => el.innerText);
  assert.ok(dashboardHeading.includes('Good to see you'), 'Dashboard must display customer greeting');
  console.log(`✓ Customer dashboard verified: "${dashboardHeading}"`);

  // 2. Accounts View
  console.log('Step 2: Testing /accounts view...');
  await page.goto(`${FRONTEND_URL}/accounts`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const accountsText = await page.evaluate(() => document.body.innerText);
  assert.ok(accountsText.includes('BV-INR-'), 'Accounts view must display active accounts');
  console.log('✓ Accounts page rendered active accounts.');

  // 3. Statements View
  console.log('Step 3: Testing /statements view...');
  await page.goto(`${FRONTEND_URL}/statements`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const statementsHeading = await page.$eval('h1', (el: any) => el.innerText);
  assert.strictEqual(statementsHeading, 'Account statements');
  console.log('✓ Statements page rendered successfully.');

  // 4. Financial Transactions View (Deposit / Withdrawal / Transfer)
  console.log('Step 4: Testing financial transaction views...');
  await page.goto(`${FRONTEND_URL}/transactions/deposit`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const depositHeading = await page.$eval('h1', (el: any) => el.innerText);
  assert.strictEqual(depositHeading, 'Deposit');

  await page.goto(`${FRONTEND_URL}/transactions/withdrawal`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const withdrawHeading = await page.$eval('h1', (el: any) => el.innerText);
  assert.strictEqual(withdrawHeading, 'Withdrawal');

  await page.goto(`${FRONTEND_URL}/transactions/transfer`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const transferHeading = await page.$eval('h1', (el: any) => el.innerText);
  assert.strictEqual(transferHeading, 'Transfer');
  console.log('✓ Deposit, withdrawal, and transfer pages rendered without errors.');

  // 5. Account Onboarding Request View
  console.log('Step 5: Testing /account-requests view...');
  await page.goto(`${FRONTEND_URL}/account-requests`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const reqHeading = await page.$eval('h1', (el: any) => el.innerText);
  assert.strictEqual(reqHeading, 'Account request');
  console.log('✓ Account requests view verified.');

  // 6. Admin Authentication & Admin Views
  console.log('Step 6: Testing admin sign-in and management views...');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'domcontentloaded' });
  await sleep(1000);
  await page.type('input[type="email"]', 'admin@balancevault.internal');
  await page.type('input[type="password"]', 'AdminVault2026!');
  await page.click('button[type="submit"]');
  await sleep(2500);

  // Admin Users
  await page.goto(`${FRONTEND_URL}/admin/users`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const adminUsersHeading = await page.$eval('h1', (el: any) => el.innerText);
  assert.strictEqual(adminUsersHeading, 'User management');

  // Admin Onboarding
  await page.goto(`${FRONTEND_URL}/admin/onboarding`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const onboardingHeading = await page.$eval('h1', (el: any) => el.innerText);
  assert.strictEqual(onboardingHeading, 'Account onboarding');

  // Audit Log
  await page.goto(`${FRONTEND_URL}/audit`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const auditHeading = await page.$eval('h1', (el: any) => el.innerText);
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
