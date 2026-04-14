"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, PlusCircle, TrendingUp,
  Settings, FlaskConical, Dumbbell, UserCircle,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/",          label: "Home",     icon: LayoutDashboard },
  { href: "/log",       label: "Log",      icon: PlusCircle      },
  { href: "/trends",    label: "Trends",   icon: TrendingUp      },
  { href: "/bloodwork", label: "Labs",     icon: FlaskConical    },
  { href: "/training",  label: "Training", icon: Dumbbell        },
  { href: "/profile",   label: "Profile",  icon: UserCircle      },
  { href: "/settings",  label: "Settings", icon: Settings        },
] as const;

export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-bg-border/60 bg-bg-primary/95 backdrop-blur-md">
      {/* subtle top-edge highlight */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-bg-border to-transparent" />

      <div className="max-w-lg mx-auto flex items-center justify-around px-2 py-2.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 px-1.5 py-1 rounded-xl transition-all duration-200 ${
                active
                  ? "text-gold"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {/* icon with glow on active */}
              <span
                className="transition-all duration-200"
                style={active ? { filter: "drop-shadow(0 0 6px rgba(212,168,67,0.6))" } : undefined}
              >
                <Icon size={21} strokeWidth={active ? 2.2 : 1.6} />
              </span>

              {/* label — xs (not 2xs) so it's actually readable */}
              <span className={`text-xs font-medium leading-none ${active ? "text-gold" : "text-text-secondary"}`}>
                {label}
              </span>

              {/* active dot indicator */}
              {active && <span className="nav-active-dot mt-0.5" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
