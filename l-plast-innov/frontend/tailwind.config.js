/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Identité visuelle du projet
        ocean: {
          DEFAULT: "#0369a1",
          light: "#0ea5e9",
          dark: "#075985",
        },
        eco: {
          DEFAULT: "#15803d",
          light: "#22c55e",
          dark: "#166534",
        },
        warn: "#ea580c", // alerte préventive (orange)
        danger: "#dc2626", // alerte critique (rouge)
      },
    },
  },
  plugins: [],
};
