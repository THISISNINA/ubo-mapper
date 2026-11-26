/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#14181F',
        paper: '#F6F4EF',
        slate: { 850: '#1B212C' },
        ledger: { navy: '#1F2937', teal: '#0F6E6E', gold: '#B8862E', rust: '#B4432E' },
      },
      fontFamily: {
        display: ['"Source Serif 4"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
