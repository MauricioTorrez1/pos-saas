/** The colors the owner can pick. Each one is checked for readable contrast (ADR 0024). */
export const ACCENTS = ['yellow', 'orange', 'red', 'blue', 'green', 'purple'] as const;

/** The text sizes the owner can pick, for screens read from a distance. */
export const TEXT_SIZES = ['normal', 'large', 'extra-large'] as const;

/** The themes the owner can pick. */
export const THEMES = ['light', 'dark'] as const;

/** Longest business name that fits the header at the largest text size. */
export const MAX_BUSINESS_NAME_LENGTH = 40;

export type Accent = (typeof ACCENTS)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type Theme = (typeof THEMES)[number];

/** What the owner can change about how the register looks, without touching code. */
export interface Appearance {
  /** Shown in the header. Empty means the register has no name yet. */
  readonly businessName: string;
  readonly accent: Accent;
  readonly textSize: TextSize;
  readonly theme: Theme;
}

/** How a register looks until its owner changes it. */
export const DEFAULT_APPEARANCE: Appearance = {
  businessName: '',
  accent: 'yellow',
  textSize: 'normal',
  theme: 'light',
};

function isOneOf<T>(options: readonly T[], value: unknown): value is T {
  return (options as readonly unknown[]).includes(value);
}

/**
 * Tells whether a value is a complete and allowed appearance, such as what arrives through the bridge.
 *
 * @param value anything
 * @returns true if every field holds an allowed value
 */
export function isAppearance(value: unknown): value is Appearance {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { businessName, accent, textSize, theme } = value as Record<string, unknown>;
  return (
    typeof businessName === 'string' &&
    businessName.length <= MAX_BUSINESS_NAME_LENGTH &&
    isOneOf(ACCENTS, accent) &&
    isOneOf(TEXT_SIZES, textSize) &&
    isOneOf(THEMES, theme)
  );
}
