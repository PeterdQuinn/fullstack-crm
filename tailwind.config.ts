import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#2D5F3A", light: "#E8F5E9", dark: "#1A3D24" },
        gold: "#C49A3C",
        slate: { 850: "#1A1A2E" },
      },
    },
  },
  plugins: [],
};
export default config;
