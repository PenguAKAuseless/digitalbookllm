"use client"

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react"
import { Lang, messages } from "./messages"

interface I18nContextType {
    lang: Lang
    setLang: (lang: Lang) => void
    t: (key: string) => string
}

const I18nContext = createContext<I18nContextType | null>(null)
const STORAGE_KEY = "dbllm-lang"

/** Bilingual UI (ADR-10): persists the reader's chosen language across sessions. */
export function I18nProvider({ children }: { children: ReactNode }) {
    const [lang, setLangState] = useState<Lang>("vi")

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY) as Lang | null
        if (stored === "vi" || stored === "en") setLangState(stored)
    }, [])

    const setLang = (next: Lang) => {
        setLangState(next)
        localStorage.setItem(STORAGE_KEY, next)
    }

    const t = useMemo(() => {
        const dict = messages[lang]
        return (key: string) => dict[key] ?? key
    }, [lang])

    return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

export function useI18n() {
    const ctx = useContext(I18nContext)
    if (!ctx) throw new Error("useI18n must be used within I18nProvider")
    return ctx
}
