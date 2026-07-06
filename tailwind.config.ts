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
        brand: { DEFAULT: "#2D5F3A", light: "#E8F5E9", dark: "#1A3D24" },
        gold: "#C49A3C",
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
