import { test, expect } from "@playwright/test";

test.describe("Authentication & Route Protection Flow", () => {
  test("unauthenticated visitor accessing /admin is redirected to /login with callbackUrl", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login(\?callbackUrl=.*)?/);
    await expect(page.locator("h1")).toContainText("AutoCertif");
  });

  test("login page renders accessible form elements", async ({ page }) => {
    await page.goto("/login");

    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText("Sign in");
  });

  test("submitting invalid credentials shows generic error message", async ({
    page,
  }) => {
    await page.goto("/login");

    await page.fill('input[type="email"]', "nonexistent@example.com");
    await page.fill('input[type="password"]', "WrongPassword123!");
    await page.click('button[type="submit"]');

    const alert = page.locator('[data-testid="login-error"]');
    await expect(alert).toBeVisible({ timeout: 30000 });
    await expect(alert).toContainText("Invalid email or password.");
    await expect(page).toHaveURL(/\/login/);
  });

  test("authenticated ADMIN login, session verification, and logout", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    test.skip(
      !adminEmail || !adminPassword,
      "ADMIN_EMAIL and ADMIN_PASSWORD environment credentials are not configured in this environment"
    );

    // 1. Visit login
    await page.goto("/login");
    await page.fill('input[type="email"]', adminEmail!);
    await page.fill('input[type="password"]', adminPassword!);
    await page.click('button[type="submit"]');

    // 2. Verified land on /admin
    await expect(page).toHaveURL(/\/admin/, { timeout: 60000 });
    await expect(page.locator("header")).toContainText("AutoCertif");
    await expect(page.locator("header")).toContainText("ADMIN");
    await expect(page.locator("header")).toContainText(adminEmail!);

    // 3. Authenticated visit to /login redirects back to /admin
    await page.goto("/login");
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 });

    // 4. Logout
    const logoutBtn = page.locator("header button", { hasText: "Sign out" });
    await expect(logoutBtn).toBeVisible({ timeout: 15000 });
    await logoutBtn.click();

    // 5. Land on /login
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });

    // 6. Direct /admin visit now redirects back to /login
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login(\?callbackUrl=.*)?/, { timeout: 15000 });
  });
});
