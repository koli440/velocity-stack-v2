/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        nordic: {
          bg: '#0F172A',        // Slate 900
          card: 'rgba(30, 41, 59, 0.7)', // Slate 800 s průhledností pro glassmorphism
          border: 'rgba(51, 65, 85, 0.6)', // Slate 700 jemná linka
          orange: '#F97316',     // Teplá závodní oranžová
          cyan: '#38BDF8',       // Ledově modrá
          emerald: '#34D399',    // Nordic zelená
          purple: '#A78BFA',     // Nordic fialová pro Power
          text: '#F8FAFC',       // Slate 50
          muted: '#94A3B8',      // Slate 400
        }
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'nordic-card': '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
        'nordic-glow': '0 0 20px rgba(249, 115, 22, 0.15)',
      }
    },
  },
  plugins: [],
}
