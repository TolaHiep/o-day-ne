import type { SVGProps } from 'react'

// Lightweight inline SVG icon set in the Lucide style (24px viewBox,
// stroke-width 1.75, rounded joins). Used instead of emoji-as-icons so the
// UI stays crisp, color-themable, and accessible.

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number
}

function Svg({ size = 20, children, strokeWidth, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const Icon = {
  Heart: (p: IconProps) => (
    <Svg {...p}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </Svg>
  ),
  HeartFilled: (p: IconProps) => (
    <Svg {...p} fill="currentColor">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </Svg>
  ),
  Close: (p: IconProps) => (
    <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>
  ),
  Check: (p: IconProps) => (
    <Svg {...p}><path d="m5 13 4 4L19 7" /></Svg>
  ),
  Eye: (p: IconProps) => (
    <Svg {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  Star: (p: IconProps) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <path d="m12 17.27 6.18 3.73-1.64-7.03 5.46-4.73-7.19-.62L12 2 9.19 8.62 2 9.24l5.46 4.73L5.82 21z" />
    </Svg>
  ),
  Sparkles: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </Svg>
  ),
  Search: (p: IconProps) => (
    <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>
  ),
  Filter: (p: IconProps) => (
    <Svg {...p}><path d="M3 5h18M6 12h12M10 19h4" /></Svg>
  ),
  MapPin: (p: IconProps) => (
    <Svg {...p}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  ),
  Phone: (p: IconProps) => (
    <Svg {...p}>
      <path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 1h2a2 2 0 0 1 2 1.72c.12.89.32 1.76.6 2.6a2 2 0 0 1-.45 2.11L7.09 8.59a16 16 0 0 0 6 6l1.16-1.18a2 2 0 0 1 2.11-.45c.84.28 1.71.48 2.6.6A2 2 0 0 1 22 16.92Z" />
    </Svg>
  ),
  Home: (p: IconProps) => (
    <Svg {...p}>
      <path d="m3 11 9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </Svg>
  ),
  Plus: (p: IconProps) => (
    <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
  ),
  ArrowLeft: (p: IconProps) => (
    <Svg {...p}><path d="M19 12H5M12 19l-7-7 7-7" /></Svg>
  ),
  ArrowRight: (p: IconProps) => (
    <Svg {...p}><path d="M5 12h14M12 5l7 7-7 7" /></Svg>
  ),
  ChevronLeft: (p: IconProps) => (
    <Svg {...p}><path d="m15 18-6-6 6-6" /></Svg>
  ),
  ChevronRight: (p: IconProps) => (
    <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>
  ),
  Shield: (p: IconProps) => (
    <Svg {...p}><path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10Z" /></Svg>
  ),
  Camera: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  ),
  Flag: (p: IconProps) => (
    <Svg {...p}><path d="M4 22V4M4 4h12l-2 4 2 4H4" /></Svg>
  ),
  Settings: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.05a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09c0 .67.39 1.27 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82c.24.61.84 1 1.51 1H21a2 2 0 0 1 0 4h-.09c-.67 0-1.27.39-1.51 1Z" />
    </Svg>
  ),
  Bookmark: (p: IconProps) => (
    <Svg {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></Svg>
  ),
  Compass: (p: IconProps) => (
    <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z" /></Svg>
  ),
  Wifi: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 12.55a11 11 0 0 1 14 0M8.5 16.05a6 6 0 0 1 7 0M2 8.82a15 15 0 0 1 20 0" />
      <circle cx="12" cy="19.5" r="0.6" fill="currentColor" />
    </Svg>
  ),
  LogOut: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </Svg>
  ),
  Send: (p: IconProps) => (
    <Svg {...p}><path d="m22 2-11 11M22 2l-7 20-4-9-9-4z" /></Svg>
  ),
  Edit: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Svg>
  ),
  Trash: (p: IconProps) => (
    <Svg {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></Svg>
  ),
  AlertTriangle: (p: IconProps) => (
    <Svg {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" /></Svg>
  ),
  TrendingUp: (p: IconProps) => (
    <Svg {...p}><path d="m22 7-8.5 8.5-5-5L2 17M16 7h6v6" /></Svg>
  ),
  Sliders: (p: IconProps) => (
    <Svg {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></Svg>
  ),
  KeySquare: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 13a2 2 0 1 0 2-2M11 11l4 4M14 14l1-1" />
    </Svg>
  ),
  Wand: (p: IconProps) => (
    <Svg {...p}><path d="m15 4 5 5M5 14l-3 8 8-3M3 21l9-9M14 5l5 5M13 6l1-1 3 3-1 1z" /></Svg>
  ),
}

// Brand glyphs for social login. These follow the Simple Icons reference
// (24x24, single-color fill so the button picks up text color via CSS).
export const Brand = {
  Google: (p: IconProps) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" aria-hidden focusable="false" {...p}>
      <path fill="#EA4335" d="M12 10.2v3.92h5.45c-.24 1.43-1.7 4.19-5.45 4.19a6.1 6.1 0 1 1 0-12.2c1.91 0 3.2.81 3.94 1.51l2.69-2.6C16.84 3.42 14.66 2.5 12 2.5a9.5 9.5 0 1 0 0 19c5.49 0 9.13-3.85 9.13-9.27 0-.62-.07-1.1-.16-1.53z" />
      <path fill="#34A853" d="M3.74 7.6 7 9.95A6.06 6.06 0 0 1 12 6.11c1.91 0 3.2.81 3.94 1.51l2.69-2.6C16.84 3.42 14.66 2.5 12 2.5A9.5 9.5 0 0 0 3.74 7.6Z" opacity="0" />
      <path fill="#FBBC05" d="M12 21.5a9.46 9.46 0 0 0 6.55-2.4l-3.12-2.55c-.83.58-1.96 1-3.43 1-2.64 0-4.88-1.78-5.68-4.17l-3.27 2.52A9.5 9.5 0 0 0 12 21.5Z" />
      <path fill="#4285F4" d="M21.13 12.23c0-.62-.07-1.1-.16-1.53H12v3.42h5.45a4.66 4.66 0 0 1-2.02 3.05l3.12 2.55c1.82-1.69 2.86-4.18 2.86-7.49Z" />
    </svg>
  ),
  Facebook: (p: IconProps) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" aria-hidden focusable="false" {...p}>
      <path fill="#1877F2" d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.5-3.9 3.78-3.9 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.77l-.44 2.91h-2.33V22c4.78-.79 8.43-4.94 8.43-9.94Z" />
    </svg>
  ),
  Zalo: (p: IconProps) => (
    <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" aria-hidden focusable="false" {...p}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#0068FF" />
      <path
        fill="#fff"
        d="M6.2 9.2h1.2v4.95H10v1.05H6.2zm5.05 0h1.2v6h-1.2zm2.2 4.85V8.8h1.2v.65c.4-.3.92-.5 1.5-.5 1.5 0 2.55 1.2 2.55 2.85S17.65 14.6 16.15 14.6c-.6 0-1.15-.22-1.55-.55v.05c0 .15-.05.25-.15.3-.1.05-.25.05-.4-.05zm2.55-1.05c.85 0 1.5-.6 1.5-1.55s-.65-1.55-1.5-1.55-1.5.6-1.5 1.55.65 1.55 1.5 1.55z"
      />
    </svg>
  ),
}
