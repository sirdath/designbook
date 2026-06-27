/* The 6-token theme map (reimplemented from scratch). A scene reads its visual
   tokens from the plan's theme so the video is brand-identical to the web page it
   came from — the SAME palette tokens the vault resolved. A small `variant` knob
   gives the "same animation, different look" idea (Default/Brutalist/Rounded/
   Minimal/Glass/Neo) without copying any third-party token values. */

export type ThemeTokens = { bg: string; ink: string; accent: string; muted: string };
export type Variant = 'default' | 'brutalist' | 'rounded' | 'minimal' | 'glass' | 'neo';
export type Theme = {
  preset?: string | null;
  palette?: string | null;
  aesthetic?: string | null;
  variant?: Variant;
  fontFamily?: string;
  tokens?: ThemeTokens;
};

const DEFAULT_TOKENS: ThemeTokens = { bg: '#0b0b0f', ink: '#f5f5f7', accent: '#6c8cff', muted: '#9aa0aa' };

const RADIUS: Record<Variant, number> = { default: 18, brutalist: 0, rounded: 32, minimal: 10, glass: 22, neo: 16 };
const DISPLAY_WEIGHT: Record<Variant, number> = { default: 800, brutalist: 900, rounded: 800, minimal: 600, glass: 700, neo: 800 };
const BORDER: Record<Variant, string> = {
  default: 'none', brutalist: '4px solid currentColor', rounded: 'none',
  minimal: '1px solid rgba(255,255,255,0.12)', glass: '1px solid rgba(255,255,255,0.18)', neo: 'none',
};

export type SceneStyles = {
  bg: string; ink: string; accent: string; muted: string;
  radius: number; border: string; displayWeight: number;
  fontFamily: string; pad: number; cardBg: string;
};

export const getSceneStyles = (theme?: Theme): SceneStyles => {
  const t = (theme && theme.tokens) || DEFAULT_TOKENS;
  const v: Variant = (theme && theme.variant) || 'default';
  return {
    bg: t.bg,
    ink: t.ink,
    accent: t.accent,
    muted: t.muted,
    radius: RADIUS[v],
    border: BORDER[v],
    displayWeight: DISPLAY_WEIGHT[v],
    fontFamily: (theme && theme.fontFamily) || 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
    pad: 110,
    cardBg: v === 'glass' ? 'rgba(255,255,255,0.06)' : v === 'minimal' ? 'transparent' : 'rgba(255,255,255,0.04)',
  };
};
