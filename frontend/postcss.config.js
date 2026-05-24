// Explicit config path so Tailwind resolves `content` globs relative to this
// file's directory (./frontend) regardless of where vite's cwd ends up.
export default {
  plugins: {
    tailwindcss: { config: './frontend/tailwind.config.js' },
    autoprefixer: {},
  },
}
