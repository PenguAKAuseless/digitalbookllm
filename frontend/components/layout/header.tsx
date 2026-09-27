"use client"

import Link from "next/link"
import { Fragment } from "react"
import { Menu, LogOut, Sun, Moon, Laptop, Languages, BookOpen, MessageSquare, Network, ChevronRight, FolderOpen, FileText } from "lucide-react"
import { useTheme } from "next-themes"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type ViewMode = "reading" | "split" | "graph"

export interface Crumb {
    label: string
    href?: string
    kind?: "workspace" | "document"
}

interface HeaderProps {
    onMenuClick?: () => void
    /** Where the user is: typically workspace, then the open document. */
    breadcrumbs?: Crumb[]
    /** Only shown inside the reader (UC08/UC09 view-mode switcher). */
    viewMode?: ViewMode
    onViewModeChange?: (mode: ViewMode) => void
}

export function Header({ onMenuClick, breadcrumbs = [], viewMode, onViewModeChange }: HeaderProps) {
    const { user, logout } = useAuth()
    const { t, lang, setLang } = useI18n()
    const { theme, setTheme } = useTheme()
    const router = useRouter()

    const handleLogout = () => {
        logout()
        router.push("/login")
    }

    return (
        <header className="border-b border-border bg-card/95 backdrop-blur px-3 py-2 sm:px-5 flex-shrink-0">
            <div className="flex items-center justify-between gap-3">
                <div className="flex flex-1 items-center gap-2 min-w-0">
                    {onMenuClick && (
                        <button onClick={onMenuClick} className="p-2 -ml-1 hover:bg-muted rounded-lg transition-colors md:hidden" aria-label="Menu">
                            <Menu className="w-5 h-5" />
                        </button>
                    )}
                    <Link href="/library" className="flex items-center gap-2 flex-shrink-0 rounded-lg" title={t("nav.library")}>
                        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-sm">
                            <span className="text-primary-foreground font-bold text-sm">DB</span>
                        </div>
                        <span className="hidden sm:inline text-sm font-bold text-foreground">{t("app.name")}</span>
                    </Link>

                    {breadcrumbs.length > 0 && (
                        <nav aria-label="Breadcrumb" className="flex items-center gap-1 min-w-0 pl-2 sm:ml-1 sm:border-l sm:border-border sm:pl-3">
                            {breadcrumbs.map((crumb, i) => {
                                const isLast = i === breadcrumbs.length - 1
                                const Icon = crumb.kind === "document" ? FileText : crumb.kind === "workspace" ? FolderOpen : null
                                const content = (
                                    <>
                                        {Icon && <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", isLast ? "text-primary" : "text-muted-foreground")} />}
                                        <span className="truncate">{crumb.label}</span>
                                    </>
                                )
                                return (
                                    <Fragment key={i}>
                                        {i > 0 && <ChevronRight className="hidden sm:block w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/60" />}
                                        {crumb.href && !isLast ? (
                                            <Link
                                                href={crumb.href}
                                                className="hidden sm:flex items-center gap-1.5 flex-shrink-0 max-w-[200px] rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                            >
                                                {content}
                                            </Link>
                                        ) : (
                                            <span
                                                className={cn(
                                                    "flex items-center gap-1.5 min-w-0 px-1.5 py-1 text-xs",
                                                    isLast ? "font-semibold text-foreground" : "hidden sm:flex flex-shrink-0 text-muted-foreground max-w-[200px]"
                                                )}
                                                title={crumb.label}
                                                aria-current={isLast ? "page" : undefined}
                                            >
                                                {content}
                                            </span>
                                        )}
                                    </Fragment>
                                )
                            })}
                        </nav>
                    )}
                </div>

                {viewMode && onViewModeChange && (
                    <div className="hidden md:flex flex-shrink-0 items-center gap-0.5 rounded-lg bg-muted p-1">
                        <ViewModeButton icon={BookOpen} label={t("reader.viewMode.reading")} active={viewMode === "reading"} onClick={() => onViewModeChange("reading")} />
                        <ViewModeButton icon={MessageSquare} label={t("reader.viewMode.split")} active={viewMode === "split"} onClick={() => onViewModeChange("split")} />
                        <ViewModeButton icon={Network} label={t("reader.viewMode.graph")} active={viewMode === "graph"} onClick={() => onViewModeChange("graph")} />
                    </div>
                )}

                <div className="flex flex-1 items-center justify-end gap-1.5">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" title={t("settings.language")}>
                                <Languages className="w-4 h-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setLang("vi")}>Tiếng Việt {lang === "vi" && "✓"}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setLang("en")}>English {lang === "en" && "✓"}</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" title={t("settings.theme")}>
                                {theme === "dark" ? <Moon className="w-4 h-4" /> : theme === "light" ? <Sun className="w-4 h-4" /> : <Laptop className="w-4 h-4" />}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setTheme("light")}><Sun className="w-4 h-4" /> {t("settings.theme.light")}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="w-4 h-4" /> {t("settings.theme.dark")}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTheme("system")}><Laptop className="w-4 h-4" /> {t("settings.theme.system")}</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {user && (
                        <span className="hidden lg:inline text-xs text-muted-foreground max-w-[160px] truncate px-1">{user.email}</span>
                    )}
                    <Button variant="ghost" size="icon" title={t("nav.signOut")} onClick={handleLogout}>
                        <LogOut className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {viewMode && onViewModeChange && (
                <div className="flex md:hidden items-center gap-0.5 rounded-lg bg-muted p-1 mt-2">
                    <ViewModeButton icon={BookOpen} label="" active={viewMode === "reading"} onClick={() => onViewModeChange("reading")} className="flex-1" />
                    <ViewModeButton icon={MessageSquare} label="" active={viewMode === "split"} onClick={() => onViewModeChange("split")} className="flex-1" />
                    <ViewModeButton icon={Network} label="" active={viewMode === "graph"} onClick={() => onViewModeChange("graph")} className="flex-1" />
                </div>
            )}
        </header>
    )
}

function ViewModeButton({ icon: Icon, label, active, onClick, className }: { icon: typeof BookOpen; label: string; active: boolean; onClick: () => void; className?: string }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                className
            )}
        >
            <Icon className="w-3.5 h-3.5" />
            {label && <span className="hidden lg:inline">{label}</span>}
        </button>
    )
}
