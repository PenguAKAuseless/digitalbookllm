import { Page, APIRequestContext } from "@playwright/test"

const API_BASE = process.env.PLAYWRIGHT_API_URL || "http://localhost:3001/api"

/** Registers a fresh user via the API and signs the browser in by seeding localStorage. */
export async function registerAndSignIn(page: Page, request: APIRequestContext) {
    const email = `e2e-${Date.now()}@example.com`
    const password = "password123"

    const res = await request.post(`${API_BASE}/auth/register`, { data: { email, password } })
    const body = await res.json()

    await page.addInitScript(
        ([token]) => localStorage.setItem("token", token as string),
        [body.data.token]
    )

    return { email, password, token: body.data.token as string, userId: body.data.user.id as string }
}

export async function createWorkspace(request: APIRequestContext, token: string, name = "E2E Workspace") {
    const res = await request.post(`${API_BASE}/workspaces`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name },
    })
    return (await res.json()).data
}
