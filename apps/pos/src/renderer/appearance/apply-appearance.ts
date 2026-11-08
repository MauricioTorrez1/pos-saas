import type { Appearance } from '../../shared/appearance';

/**
 * Makes the page look as the appearance says. The stylesheet does the rest from these three attributes.
 *
 * @param appearance how the register should look
 */
export function applyAppearance({ accent, textSize, theme }: Appearance): void {
  const { dataset } = document.documentElement;
  dataset.accent = accent;
  dataset.textSize = textSize;
  dataset.theme = theme;
}
