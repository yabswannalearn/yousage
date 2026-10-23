export interface AppTheme { background: string; accent: string }
export interface ThemePreset extends AppTheme { id: string; label: string }

export const defaultAppTheme: AppTheme = { background: '#202221', accent: '#b7c8b1' };
export const themePresets: readonly ThemePreset[] = [
  { id: 'charcoal-sage', label: 'Charcoal', background: '#202221', accent: '#b7c8b1' },
  { id: 'obsidian-blue', label: 'Obsidian', background: '#141820', accent: '#8ab4d8' },
  { id: 'warm-slate', label: 'Warm Slate', background: '#252122', accent: '#e0af72' },
  { id: 'daylight-paper', label: 'Daylight', background: '#f4f3ee', accent: '#3d6b52' },
];
export const providerColorPresets = {
  codex: ['#b7c8b1', '#7eb2dd', '#a89be6', '#e0af72'],
  antigravity: ['#8ab4d8', '#76cbb8', '#b7c8b1', '#e09bb6'],
  claude: ['#d99a7c', '#e0af72', '#c89be0', '#8ab4d8'],
} as const;
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const rgb = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
const hex = (channels: number[]) => `#${channels.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, amount: number) => hex(rgb(a).map((value, i) => value * (1 - amount) + rgb(b)[i] * amount));

export function contrastRatio(a: string, b: string): number {
  const luminance = (color: string) => rgb(color).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const [first, second] = [luminance(a), luminance(b)];
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function readableAccent(accent: string, background: string): string {
  const target = contrastRatio('#ffffff', background) > contrastRatio('#000000', background) ? '#ffffff' : '#000000';
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(accent, target, step / 20);
    if (contrastRatio(candidate, background) >= 4.5) return candidate;
  }
  return target;
}

export function themePalette(theme: Partial<AppTheme> | undefined): Record<string, string> {
  const background = isHexColor(theme?.background) ? theme.background : defaultAppTheme.background;
  const accent = isHexColor(theme?.accent) ? theme.accent : defaultAppTheme.accent;
  const light = contrastRatio('#000000', background) >= contrastRatio('#ffffff', background);
  const text = readableAccent(light ? '#141814' : '#f1f2ee', background);
  const muted = readableAccent(mix(text, background, 0.35), background);
  const card = mix(background, light ? '#ffffff' : '#000000', light ? 0.25 : 0.15);
  const recess = mix(background, light ? '#ffffff' : '#000000', 0.28);
  return {
    '--surface': background, '--recess': recess, '--card': card,
    '--card-elevated': mix(card, light ? '#ffffff' : text, light ? 0.35 : 0.035),
    '--text': text, '--muted': muted, '--sage': accent, '--ui-accent': accent,
    '--accent-ink': readableAccent(accent, card),
    '--accent-contrast': contrastRatio('#000000', accent) >= contrastRatio('#ffffff', accent) ? '#000000' : '#ffffff',
    '--amber': readableAccent('#e0af72', card),
    '--danger': readableAccent('#dbac97', card),
    '--line': `${text}22`, '--track': `${text}18`, '--overlay': `${text}0a`, '--hover': `${text}14`,
    '--specular': light ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.065)',
    '--shadow': light ? '0 10px 26px -6px rgba(20,24,20,0.16), 0 2px 6px rgba(20,24,20,0.08)' : '0 12px 28px -6px rgba(0,0,0,0.52), 0 3px 8px rgba(0,0,0,0.32)',
    '--scrollbar': mix(text, background, 0.6),
    'color-scheme': light ? 'light' : 'dark',
  };
}
