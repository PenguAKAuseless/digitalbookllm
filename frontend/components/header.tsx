"use client"

import { useState, useRef, useEffect } from "react"
import { Menu, LogOut, User, Settings, HelpCircle, Moon, Sun } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useRouter } from "next/navigation"

interface HeaderProps {
    onMenuClick: () => void
    workspaceName?: string
}

export function Header({ onMenuClick, workspaceName }: HeaderProps) {
    const { user, logout } = useAuth()
    const router = useRouter()
    const [showMenu, setShowMenu] = useState(false)
    const [isDark, setIsDark] = useState(true)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const handleLogout = () => {
        logout()
        router.push("/login")
    }

    const toggleTheme = () => {
        setIsDark(!isDark)
        document.documentElement.classList.toggle("dark")
    }

    return (
        <header className="border-b border-border bg-card px-4 py-3 md:px-6 md:py-4 flex-shrink-0">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <button onClick={onMenuClick} className="p-2 hover:bg-muted rounded-lg transition-colors md:hidden">
                        <Menu className="w-5 h-5" />
                    </button>
                    <button onClick={onMenuClick} className="hidden md:block p-2 hover:bg-muted rounded-lg transition-colors">
                        <Menu className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
                            <span className="text-primary-foreground font-bold text-sm">DB</span>
                        </div>
                        <div className="hidden sm:block">
                            <h1 className="text-base font-bold text-foreground leading-none">DigitalBookLLM</h1>
                            {workspaceName && (
                                <p className="text-xs text-muted-foreground truncate max-w-[200px]">{workspaceName}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Hamburger Menu Button */}
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-2 hover:bg-muted rounded-lg transition-colors flex items-center gap-2"
                    >
                        <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                            <User className="w-4 h-4 text-primary" />
                        </div>
                        <Menu className="w-4 h-4 text-muted-foreground hidden sm:block" />
                    </button>

                    {/* Dropdown Menu */}
                    {showMenu && (
                        <div className="absolute right-0 top-full mt-2 w-64 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                            {/* User Info */}
                            {user && (
                                <div className="px-4 py-3 border-b border-border bg-muted/30">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                                            <User className="w-5 h-5 text-primary" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{user.email}</p>
                                            <p className="text-xs text-muted-foreground">Free Plan</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Menu Items */}
                            <div className="py-2">
                                <button
                                    onClick={toggleTheme}
                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted transition-colors"
                                >
                                    {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                                    {isDark ? "Light Mode" : "Dark Mode"}
                                </button>
                                <button
                                    onClick={() => { setShowMenu(false) }}
                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted transition-colors"
                                >
                                    <Settings className="w-4 h-4" />
                                    Settings
                                </button>
                                <button
                                    onClick={() => { setShowMenu(false) }}
                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted transition-colors"
                                >
                                    <HelpCircle className="w-4 h-4" />
                                    Help & Support
                                </button>
                            </div>

                            {/* Logout */}
                            <div className="border-t border-border py-2">
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                    <LogOut className="w-4 h-4" />
                                    Sign Out
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    )
}
