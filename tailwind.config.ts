import type { Config } from "tailwindcss";
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // NY Jets official palette. `brand` is remapped to Gotham Green so every
        // page that already uses brand/brand-light/brand-dark themes at once.
        brand: { DEFAULT: "#125740", light: "#E6F2ED", dark: "#0A3A2A" },
        jets: {
          gotham: "#125740", // primary — deep modern green
          kelly: "#009A44", // bright retro (accents/fills only, 3.4:1 on white)
          "kelly-dark": "#00703C", // readable kelly for text on white (4.8:1)
          stealth: "#0A0A0A", // secondary accents
          streak: "#FFFFFF", // numbers, lettering, crisp contrast
        },
        // Accent slot, formerly gold. Kept as a token name so existing
        // `text-gold` / `bg-gold` usages retheme without touching each page.
        gold: "#00703C",
        slate: { 850: "#1A1A2E" },
        // Single source of truth for lead-status colors across the whole app.
        // Consumed via lib/status-colors.ts — do not invent per-page status colors.
        status: {
          new: "#2563EB", // fresh lead
          ready: "#0D9488", // ready for outreach
          active: "#0284C7", // mid-sequence (email/DM/call in progress)
          warm: "#D97706", // engaged / follow-up / interested
          meeting: "#2D5F3A", // booked / onboarding (brand green)
          won: "#059669", // closed won
          lost: "#DC2626", // lost
          dead: "#64748B", // dead / do-not-contact / bad data
          neutral: "#6B7280", // unknown / fallback
        },
      },
    },
  },
  plugins: [],
};
export default config;
