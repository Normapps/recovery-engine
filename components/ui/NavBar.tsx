"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, PlusCircle, TrendingUp, Settings, FlaskConical, Dumbbell, UserCircle } from "lucide-react";

const NAV_ITEMS = [
  { href: "/",         label: "Dashboard", icon: LayoutDashboard },
  { href: "/log",      label: "Log",       icon: PlusCircle      },
  { href: "/trends",   label: "Trends",    icon: TrendingUp      },
  { href: "/bloodwork", label: "Labs",     icon: FlaskConical    },
  { href: "/training", label: "Training",  icon: Dumbbell        },
  { href: "/profile",  label: "Profile",   icon: UserCircle      },
  { href: "/settings", label: "Settings",  icon: Settings        },
] as const;

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-bg-border bg-bg-primary/95 backdrop-blur-sm">
      <div className="max-w-lg mx-auto flex items-center justify-around px-4 py-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 transition-colors ${
                active ? "text-gold" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2 : 1.5} />
              <span className="text-2xs font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
