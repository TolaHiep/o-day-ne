/** @type {import('tailwindcss').Config} */
export default {
  // Paths are resolved by Tailwind relative to the current working directory
  // (project root when invoked via `npm run build`), NOT this config file.
  content: ['./frontend/index.html', './frontend/src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Background tones — warm bone / parchment instead of saturated cream.
        cream: {
          50: '#fbfaf6',
          100: '#f7f3ea',
          200: '#ece4d2',
          300: '#dccfb3',
          400: '#c4b186',
          500: '#9a8559',
        },
        // Ink — near-black with a warm undertone, replaces washed-out browns.
        ink: {
          900: '#15110d',
          800: '#221b14',
          700: '#3a2f24',
          500: '#6a5a4a',
          400: '#90806f',
        },
        // Leaf — deep jade brand. Trust + Hanoi park / banyan tree.
        leaf: {
          50: '#ecf6f0',
          100: '#d2ecdc',
          200: '#a3d6b8',
          300: '#5fbf8b',
          400: '#2da669',
          500: '#138a4f',
          600: '#0f6e3f',
          700: '#0c5631',
        },
        // Coral — sunset-over-West-Lake terracotta. Less candy, more clay.
        coral: {
          50: '#fbeee6',
          100: '#f5d3bf',
          200: '#eaa988',
          300: '#dd7d57',
          400: '#c45a37',
          500: '#9d4525',
        },
        // Sky — soft window light, used sparingly.
        sky: {
          50: '#eef6fb',
          100: '#cee2ee',
          200: '#9bc4dc',
        },
        // New brand alias: identical to leaf-500 / leaf-600 for new components.
        brand: {
          DEFAULT: '#138a4f',
          ink: '#0c5631',
        },
        // Clay alias for the coral accent — semantic name for "like / heart".
        clay: {
          DEFAULT: '#c45a37',
          ink: '#9d4525',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Be Vietnam Pro"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Fraunces"', '"Roboto Serif"', 'Georgia', 'serif'],
      },
      boxShadow: {
        // Slightly tighter, lower-spread shadows — feels more "lifted paper",
        // less floaty than before. Also darker undertone for crisp edges on
        // the warm parchment background.
        card: '0 18px 48px -28px rgba(21, 17, 13, 0.45), 0 4px 14px -8px rgba(21, 17, 13, 0.18)',
        soft: '0 8px 28px -18px rgba(21, 17, 13, 0.28)',
        ring: '0 0 0 4px rgba(19, 138, 79, 0.18)',
        stamp: 'inset 0 0 0 2px currentColor, 0 0 0 4px rgba(255,255,255,0.5)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      keyframes: {
        floatIn: {
          '0%': { transform: 'translateY(24px) scale(0.96)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
        stampPop: {
          '0%': { transform: 'rotate(-12deg) scale(0.4)', opacity: '0' },
          '60%': { transform: 'rotate(-12deg) scale(1.05)', opacity: '1' },
          '100%': { transform: 'rotate(-12deg) scale(1)', opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        pulseDot: {
          '0%, 100%': { transform: 'scale(0.9)', opacity: '0.6' },
          '50%': { transform: 'scale(1.2)', opacity: '1' },
        },
      },
      animation: {
        floatIn: 'floatIn 350ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        stampPop: 'stampPop 480ms cubic-bezier(0.2, 0.9, 0.2, 1.1)',
        slideUp: 'slideUp 280ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        fadeIn: 'fadeIn 200ms ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
        pulseDot: 'pulseDot 1.4s ease-in-out infinite',
      },
      backgroundImage: {
        // Subtle paper grain — replaces three overlapping radial gradients
        // for a quieter, more premium feel. Two soft glows in jade & clay
        // keep the warmth without competing with content.
        'paper-grain': "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.07 0 0 0 0 0.06 0 0 0 0 0.05 0 0 0 0.04 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
      },
    },
  },
  plugins: [],
}
