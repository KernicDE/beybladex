import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'x-cyan': '#00F0FF',
        'neon-green': '#00FF66',
        'base-light': '#F8FAFC',
        'base-light-alt': '#FFFFFF',
        'base-dark': '#090D16',
        'base-dark-alt': '#111827',
        'type-attack': '#EF4444',
        'type-defense': '#3B82F6',
        'type-stamina': '#EAB308',
        'type-balance': '#10B981',
      },
    },
  },
  plugins: [],
} satisfies Config
