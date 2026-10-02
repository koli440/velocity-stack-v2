/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // <--- Key for manual Light/Dark switching
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#10B981',     // Green accent from the light design
          neon: '#00F5A0',      // Vivid accent from the dark design
          cyan: '#38BDF8',      // Cyan curve from the dark design
        },
        surface: {
          light: '#F8FAFC',
          lightCard: '#FFFFFF',
          lightBorder: '#E2E8F0',
          dark: '#0B0F17',
          darkCard: '#151D2A',
          darkBorder: '#222F44',
        }
      }
    },
  },
  plugins: [],
}
