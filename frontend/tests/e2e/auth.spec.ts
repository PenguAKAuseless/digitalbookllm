import { test, expect } from "@playwright/test"

/** UC01, UC02. */
test.describe("Authentication", () => {
    test("registers a new account and lands on the library", async ({ page }) => {
        const email = `e2e-register-${Date.now()}@example.com`

        await page.goto("/register")
        await page.getByPlaceholder("you@example.com").fill(email)
        await page.getByPlaceholder("At least 6 characters").fill("password123")
        await page.locator('input[type="password"]').nth(1).fill("password123")
        await page.getByRole("button", { name: /register|đăng ký/i }).click()

        await expect(page).toHaveURL(/\/library/)
    })

    test("rejects an incorrect password", async ({ page }) => {
        await page.goto("/login")
        await page.getByPlaceholder("you@example.com").fill("nonexistent@example.com")
        await page.getByPlaceholder("••••••••").first().fill("wrong-password")
        await page.getByRole("button", { name: /sign in|đăng nhập/i }).click()

        await expect(page.getByText(/error|lỗi|failed/i)).toBeVisible()
    })
})
