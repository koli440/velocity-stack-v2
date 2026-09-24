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
        track: {
          orange: '#FF5722',
          dark: '#0F172A',
          card: '#1E293B',
          line: '#334155'
        }
      }
    },
  },
  plugins: [],
}
