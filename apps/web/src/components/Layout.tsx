import { Link, NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 pb-16 pt-6 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link className="font-semibold tracking-tight text-ink no-underline" to="/">
            <span className="block font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
              Personal garage
            </span>
            <span className="mt-1 block text-3xl sm:text-4xl">Vehicles</span>
          </Link>
        </div>
        <nav className="flex gap-4 text-sm font-medium">
          <NavLink className={navClass} to="/">
            Home
          </NavLink>
          <NavLink className={navClass} to="/templates">
            Templates
          </NavLink>
          <NavLink className={navClass} to="/settings">
            Settings
          </NavLink>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'text-accent' : 'text-ink-muted hover:text-ink'
}
