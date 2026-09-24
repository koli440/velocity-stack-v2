/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // <--- Klíčové pro ruční přepínání Light/Dark
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#10B981',     // Zelený akcent ze světlého návrhu
          neon: '#00F5A0',      // Zářivý akcent z tmavého návrhu
          cyan: '#38BDF8',      // Azurová křivka z tmavého návrhu
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
