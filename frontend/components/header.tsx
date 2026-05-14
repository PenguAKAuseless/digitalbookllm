"use client"

import { Menu, LogOut, User } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useRouter } from "next/navigation"

interface HeaderProps {
    onMenuClick: () => void
    workspaceName?: string
}

export function Header({ onMenuClick, workspaceName }: HeaderProps) {
    const { user, logout } = useAuth()
    const router = useRouter()

    const handleLogout = () => {
        logout()
        router.push("/login")
    }

    return (
        <header className="border-b border-border bg-card px-4 py-3 md:px-6 md:py-4 flex-shrink-0">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <button onClick={onMenuClick} className="p-2 hover:bg-muted rounded-lg transition-colors">
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

                <div className="flex items-center gap-2">
                    {user && (
                        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted text-sm text-muted-foreground">
                            <User className="w-4 h-4" />
                            <span className="max-w-[160px] truncate">{user.email}</span>
                        </div>
                    )}
                    <button
                        onClick={handleLogout}
                        className="p-2 hover:bg-muted rounded-lg transition-colors"
                        title="Sign out"
                    >
                        <LogOut className="w-5 h-5 text-muted-foreground" />
                    </button>
                </div>
            </div>
        </header>
    )
}
