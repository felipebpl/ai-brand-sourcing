import { Link, useRouterState } from '@tanstack/react-router';
import { Package, ScrollText, Settings, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { AmberLogo } from '@/components/brand/amber-logo';
import { cn } from '@/lib/utils';

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
};

const NAV: NavItem[] = [
  {
    to: '/quotations',
    label: 'RFQs',
    icon: <ScrollText className="size-4" />,
  },
  { to: '/orders', label: 'Orders', icon: <Package className="size-4" /> },
];

export function Sidebar() {
  const { location } = useRouterState();
  const pathname = location.pathname;

  return (
    <aside className="flex h-screen w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 px-5">
        <AmberLogo className="size-5 text-foreground" />
        <span className="font-display text-[17px] font-semibold tracking-tight text-foreground">
          amber
        </span>
      </div>

      <nav className="flex-1 px-3 py-2">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const isActive =
              pathname === item.to ||
              (item.to !== '/' && pathname.startsWith(item.to));
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-active text-foreground'
                      : 'text-sidebar-muted hover:bg-sidebar-active/60 hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      isActive ? 'text-foreground' : 'text-sidebar-muted',
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-sidebar-border px-3 py-3">
        <ul className="space-y-0.5">
          <li>
            <button className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-sidebar-muted transition-colors hover:bg-sidebar-active/60 hover:text-foreground">
              <Settings className="size-4" />
              Settings
            </button>
          </li>
          <li>
            <button className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-sidebar-muted transition-colors hover:bg-sidebar-active/60 hover:text-foreground">
              <Sun className="size-4" />
              Light mode
            </button>
          </li>
        </ul>
        <div className="mt-3 flex items-center gap-2.5 px-2.5">
          <div className="flex size-7 items-center justify-center rounded-full bg-foreground/90 text-[11px] font-semibold text-background">
            VA
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-foreground">
              Valden Admin
            </div>
            <div className="truncate text-[11px] text-sidebar-muted">
              sourcing@valden.co
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
