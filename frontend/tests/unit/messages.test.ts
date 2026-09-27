import { describe, it, expect } from "vitest"
import { messages } from "@/lib/i18n/messages"

describe("i18n message catalogue", () => {
    it("defines the exact same set of keys for vi and en", () => {
        const viKeys = Object.keys(messages.vi).sort()
        const enKeys = Object.keys(messages.en).sort()
        expect(enKeys).toEqual(viKeys)
    })

    it("has no empty translation values", () => {
        for (const lang of ["vi", "en"] as const) {
            for (const [key, value] of Object.entries(messages[lang])) {
                expect(value.trim().length, `${lang}.${key} should not be empty`).toBeGreaterThan(0)
            }
        }
    })
})
