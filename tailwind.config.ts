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
        // Background layers
        bg: {
          primary: "#0B0F14",
          secondary: "#0F1419",
          card: "#141C24",
          elevated: "#1A2332",
          border: "#1E2D3D",
        },
        // Text
        text: {
          primary: "#F0F4F8",
          secondary: "#8B9BB0",
          muted: "#4A5568",
        },
        // Accent
        gold: {
          DEFAULT: "#C9A227",
          light: "#DDB94A",
          dark: "#A68520",
        },
        // Recovery states
        recovery: {
          high: "#22C55E",
          "high-muted": "#166534",
          mid: "#F59E0B",
          "mid-muted": "#92400E",
          low: "#EF4444",
          "low-muted": "#7F1D1D",
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
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
        "count-up": "countUp 0.6s ease-out",
        "ring-fill": "ringFill 1s ease-out forwards",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
