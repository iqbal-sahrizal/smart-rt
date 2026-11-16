/**
 * Smart RT Design System — Typed Design Token Reference
 *
 * Mirrors the CSS custom properties defined in `src/styles/tokens.css`.
 * Use these references instead of hardcoded hex values, pixel sizes, or radii.
 */

export const brandPalette = {
  primary: "#2563EB",
  deepNavy: "#172554",
  teal: "#0D9488",
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
} as const;

export const semanticColors = {
  background: "var(--background)",
  foreground: "var(--foreground)",
  foregroundSecondary: "var(--foreground-secondary)",
  foregroundSubtle: "var(--foreground-subtle)",
  surface: "var(--surface)",
  surfaceSubtle: "var(--surface-subtle)",
  surfaceElevated: "var(--surface-elevated)",
  card: "var(--card)",
  cardForeground: "var(--card-foreground)",
  popover: "var(--popover)",
  popoverForeground: "var(--popover-foreground)",
  primary: "var(--primary)",
  primaryHover: "var(--primary-hover)",
  primaryActive: "var(--primary-active)",
  primaryForeground: "var(--primary-foreground)",
  primarySubtle: "var(--primary-subtle)",
  primaryBorder: "var(--primary-border)",
  navy: "var(--navy)",
  navyForeground: "var(--navy-foreground)",
  secondary: "var(--secondary)",
  secondaryHover: "var(--secondary-hover)",
  secondaryForeground: "var(--secondary-foreground)",
  muted: "var(--muted)",
  mutedForeground: "var(--muted-foreground)",
  accent: "var(--accent)",
  accentHover: "var(--accent-hover)",
  accentForeground: "var(--accent-foreground)",
  accentSubtle: "var(--accent-subtle)",
  accentText: "var(--accent-text)",
  accentBorder: "var(--accent-border)",
  success: "var(--success)",
  successForeground: "var(--success-foreground)",
  successSubtle: "var(--success-subtle)",
  successText: "var(--success-text)",
  successBorder: "var(--success-border)",
  warning: "var(--warning)",
  warningForeground: "var(--warning-foreground)",
  warningSubtle: "var(--warning-subtle)",
  warningText: "var(--warning-text)",
  warningBorder: "var(--warning-border)",
  destructive: "var(--destructive)",
  destructiveForeground: "var(--destructive-foreground)",
  destructiveSubtle: "var(--destructive-subtle)",
  destructiveText: "var(--destructive-text)",
  destructiveBorder: "var(--destructive-border)",
  info: "var(--info)",
  infoForeground: "var(--info-foreground)",
  infoSubtle: "var(--info-subtle)",
  infoText: "var(--info-text)",
  infoBorder: "var(--info-border)",
  border: "var(--border)",
  borderSubtle: "var(--border-subtle)",
  borderStrong: "var(--border-strong)",
  input: "var(--input)",
  ring: "var(--ring)",
} as const;

export const typography = {
  fontFamily: {
    sans: "var(--font-sans-stack)",
    mono: "var(--font-mono-stack)",
  },
  size: {
    xs: "var(--text-xs)",       // 12px
    sm: "var(--text-sm)",       // 14px
    base: "var(--text-base)",   // 15px
    md: "var(--text-md)",       // 16px
    lg: "var(--text-lg)",       // 18px
    xl: "var(--text-xl)",       // 20px
    "2xl": "var(--text-2xl)",   // 24px
    "3xl": "var(--text-3xl)",   // 30px
    "4xl": "var(--text-4xl)",   // 36px
  },
  leading: {
    tight: "var(--leading-tight)",
    snug: "var(--leading-snug)",
    normal: "var(--leading-normal)",
    relaxed: "var(--leading-relaxed)",
  },
  tracking: {
    tight: "var(--tracking-tight)",
    snug: "var(--tracking-snug)",
    normal: "var(--tracking-normal)",
    wide: "var(--tracking-wide)",
  },
} as const;

export const spacing = {
  0: "var(--space-0)",
  0.5: "var(--space-0-5)",
  1: "var(--space-1)",
  1.5: "var(--space-1-5)",
  2: "var(--space-2)",
  2.5: "var(--space-2-5)",
  3: "var(--space-3)",
  4: "var(--space-4)",
  5: "var(--space-5)",
  6: "var(--space-6)",
  8: "var(--space-8)",
  10: "var(--space-10)",
  12: "var(--space-12)",
  16: "var(--space-16)",
  20: "var(--space-20)",
  24: "var(--space-24)",
  semantic: {
    pageX: "var(--space-page-x)",
    pageY: "var(--space-page-y)",
    section: "var(--space-section)",
    card: "var(--space-card)",
    cardCompact: "var(--space-card-compact)",
    stackSm: "var(--space-stack-sm)",
    stackMd: "var(--space-stack-md)",
    stackLg: "var(--space-stack-lg)",
  },
} as const;

export const radii = {
  xs: "var(--radius-xs)",     // 6px
  sm: "var(--radius-sm)",     // 8px
  md: "var(--radius-md)",     // 12px
  lg: "var(--radius-lg)",     // 14px
  xl: "var(--radius-xl)",     // 16px
  "2xl": "var(--radius-2xl)", // 20px
  full: "var(--radius-full)",
} as const;

export const shadows = {
  none: "var(--shadow-none)",
  xs: "var(--shadow-xs)",
  sm: "var(--shadow-sm)",
  md: "var(--shadow-md)",
  lg: "var(--shadow-lg)",
  focus: "var(--shadow-focus)",
  focusDestructive: "var(--shadow-focus-destructive)",
} as const;

export const componentSizing = {
  control: {
    xs: "var(--size-control-xs)", // 28px
    sm: "var(--size-control-sm)", // 32px
    md: "var(--size-control-md)", // 36px
    lg: "var(--size-control-lg)", // 40px
    xl: "var(--size-control-xl)", // 44px
  },
  icon: {
    xs: "var(--size-icon-xs)", // 12px
    sm: "var(--size-icon-sm)", // 14px
    md: "var(--size-icon-md)", // 16px
    lg: "var(--size-icon-lg)", // 20px
    xl: "var(--size-icon-xl)", // 24px
  },
  avatar: {
    sm: "var(--size-avatar-sm)", // 28px
    md: "var(--size-avatar-md)", // 36px
    lg: "var(--size-avatar-lg)", // 44px
  },
  layout: {
    sidebar: "var(--size-sidebar)",                   // 256px
    sidebarCollapsed: "var(--size-sidebar-collapsed)", // 64px
    topbar: "var(--size-topbar)",                     // 60px
    containerSm: "var(--container-sm)",               // 640px
    containerMd: "var(--container-md)",               // 896px
    containerLg: "var(--container-lg)",               // 1200px
    containerXl: "var(--container-xl)",               // 1360px
  },
} as const;

export const breakpoints = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
} as const;

export const motion = {
  duration: {
    fast: "var(--duration-fast)",
    normal: "var(--duration-normal)",
    slow: "var(--duration-slow)",
  },
  ease: {
    default: "var(--ease-default)",
  },
} as const;

