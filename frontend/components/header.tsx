"use client"

import { Menu, Search, Settings, LogOut } from "lucide-react"

interface HeaderProps {
  onMenuClick: () => void
}

export function Header({ onMenuClick }: HeaderProps) {
  return (
    <header className="border-b border-border bg-card px-4 py-3 md:px-6 md:py-4">
      <div className="flex items-center justify-between gap-4">
        {/* Logo and Menu */}
        <div className="flex items-center gap-3">
          <button onClick={onMenuClick} className="md:hidden p-2 hover:bg-muted rounded-lg transition-colors">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">DB</span>
            </div>
            <h1 className="text-lg md:text-xl font-bold text-foreground hidden sm:block">DigitalBook</h1>
          </div>
        </div>

        {/* Search Bar - Hidden on mobile */}
        <div className="hidden md:flex flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search documents..."
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-muted text-foreground placeholder-muted-foreground border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-muted rounded-lg transition-colors hidden sm:block">
            <Settings className="w-5 h-5 text-muted-foreground" />
          </button>
          <button className="p-2 hover:bg-muted rounded-lg transition-colors">
            <LogOut className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </div>
    </header>
  )
}
