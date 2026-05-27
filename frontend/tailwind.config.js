/** @type {import('tailwindcss').Config} */
export default {
  // Paths are resolved by Tailwind relative to the current working directory
  // (project root when invoked via `npm run build`), NOT this config file.
  content: ['./frontend/index.html', './frontend/src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Background tones — near-white with a very faint teal tinge.
        cream: {
          50: '#FAFCFC',
          100: '#F2F8F8',
          200: '#E3F0F0',
          300: '#C6E2E2',
          400: '#8CBDBD',
          500: '#5B9797',
        },
        // Ink — neutral cool-gray for text.
        ink: {
          900: '#111827',
          800: '#1F2937',
          700: '#374151',
          500: '#6B7280',
          400: '#9CA3AF',
        },
        // Leaf → teal. Save / match / verified / success accent (#00A6A6).
        leaf: {
          50: '#E8F8F8',
          100: '#C0EEEE',
          200: '#7FD9D9',
          300: '#3DC3C3',
          400: '#00AFAF',
          500: '#00A6A6',
          600: '#008F8F',
          700: '#006B6B',
        },
        // Coral → pink-red. Primary CTA / pass / heart-brand accent (#FF3F5F).
        coral: {
          50: '#FFF0F3',
          100: '#FFD6DE',
          200: '#FFB0BF',
          300: '#FF7A95',
          400: '#FF3F5F',
          500: '#E93452',
          600: '#CC1A3A',
        },
        // Sky — soft accent, used sparingly.
        sky: {
          50: '#eef6fb',
          100: '#cee2ee',
          200: '#9bc4dc',
        },
        // Brand alias → coral primary.
        brand: {
          DEFAULT: '#FF3F5F',
          ink: '#E93452',
        },
        // Clay alias → coral (semantic name for like / heart).
        clay: {
          DEFAULT: '#FF3F5F',
          ink: '#E93452',
        },
      },
      fontFamily: {
        sans: ['"Baloo 2"', '"Be Vietnam Pro"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Baloo 2"', '"Be Vietnam Pro"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        // Slightly tighter, lower-spread shadows — feels more "lifted paper",
        // less floaty than before. Also darker undertone for crisp edges on
        // the warm parchment background.
        card: '0 18px 48px -28px rgba(21, 17, 13, 0.45), 0 4px 14px -8px rgba(21, 17, 13, 0.18)',
        soft: '0 8px 28px -18px rgba(21, 17, 13, 0.28)',
        ring: '0 0 0 4px rgba(0, 166, 166, 0.20)',
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
        'paper-grain': "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.04 0 0 0 0 0.07 0 0 0 0 0.07 0 0 0 0.035 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
      },
    },
  },
  plugins: [],
}
