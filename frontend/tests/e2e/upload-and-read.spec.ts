import { test, expect } from "@playwright/test"
import * as path from "path"
import { registerAndSignIn, createWorkspace } from "./helpers"

/** UC05, UC06, UC07: upload -> processing -> ready -> open in the reader. */
test.describe("Upload and library", () => {
    test("uploads a document and it becomes readable", async ({ page, request }) => {
        const { token } = await registerAndSignIn(page, request)
        const workspace = await createWorkspace(request, token)

        await page.goto("/library")
        await page.waitForSelector("select")
        await page.selectOption("select", workspace.id)

        const fileInput = page.locator('input[type="file"]')
        await fileInput.setInputFiles(path.join(__dirname, "fixtures", "sample.txt"))

        // UC07: status progresses from UPLOADED/PROCESSING to READY without a page reload.
        await expect(page.getByText(/ready|sẵn sàng/i)).toBeVisible({ timeout: 30000 })

        await page.getByRole("button", { name: /open|mở sách/i }).first().click()
        await expect(page).toHaveURL(/\/workspace\/.+\/book\/.+/)
    })
})
