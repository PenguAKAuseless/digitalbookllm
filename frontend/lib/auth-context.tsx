"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { authAPI, AuthUser } from "@/lib/api/auth"

interface AuthContextType {
    user: AuthUser | null
    token: string | null
    loading: boolean
    login: (email: string, password: string) => Promise<void>
    register: (email: string, password: string) => Promise<void>
    logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null)
    const [token, setToken] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const stored = localStorage.getItem("token")
        if (stored) {
            setToken(stored)
            authAPI.me()
                .then(({ user }) => setUser(user))
                .catch(() => {
                    localStorage.removeItem("token")
                    setToken(null)
                })
                .finally(() => setLoading(false))
        } else {
            setLoading(false)
        }
    }, [])

    const login = async (email: string, password: string) => {
        const { user, token } = await authAPI.login(email, password)
        localStorage.setItem("token", token)
        setToken(token)
        setUser(user)
    }

    const register = async (email: string, password: string) => {
        const { user, token } = await authAPI.register(email, password)
        localStorage.setItem("token", token)
        setToken(token)
        setUser(user)
    }

    const logout = () => {
        localStorage.removeItem("token")
        setToken(null)
        setUser(null)
    }

    return (
        <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error("useAuth must be used within AuthProvider")
    return ctx
}
