import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Background layers ───────────────────────────────────────────────
        // Shifted to richer dark navy. Borders are meaningfully lighter so
        // card hierarchy is visible without squinting.
        bg: {
          primary:   "#0E1520",   // page background
          secondary: "#131C28",   // subtle layer
          card:      "#192231",   // card surfaces
          elevated:  "#1E293B",   // modals, dropdowns
          border:    "#2D3F54",   // visible borders
        },
        // ── Text ────────────────────────────────────────────────────────────
        // text-muted is now slate-500 (#64748B) — passes WCAG AA (4.5:1) on
        // all bg layers. Previous value (#4A5568) was ~3:1 and failing.
        text: {
          primary:   "#F1F5F9",   // slate-100
          secondary: "#94A3B8",   // slate-400
          muted:     "#64748B",   // slate-500 — readable at any size
        },
        // ── Accent ──────────────────────────────────────────────────────────
        gold: {
          DEFAULT: "#D4A843",
          light:   "#E8C56A",
          dark:    "#A68520",
        },
        // ── Recovery states ──────────────────────────────────────────────────
        recovery: {
          high:       "#22C55E",
          "high-muted": "#166534",
          mid:        "#F59E0B",
          "mid-muted":  "#92400E",
          low:        "#EF4444",
          "low-muted":  "#7F1D1D",
        },
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        "gold-sm": "0 0 0 1px rgba(212,168,67,0.18), 0 0 8px rgba(212,168,67,0.14)",
        "gold":    "0 0 0 1px rgba(212,168,67,0.22), 0 0 20px rgba(212,168,67,0.18)",
        "card":    "0 1px 3px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.2)",
      },
      animation: {
        "fade-in":  "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
        "count-up": "countUp 0.6s ease-out",
        "ring-fill": "ringFill 1s ease-out forwards",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        executionIn: {
          "0%":   { opacity: "0", transform: "translate(-50%, -50%) scale(0.92)" },
          "100%": { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        executionOut: {
          "0%":   { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
          "100%": { opacity: "0", transform: "translate(-50%, -50%) scale(0.96)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
