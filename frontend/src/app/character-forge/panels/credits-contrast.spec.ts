import { CreditsComponent } from './credits.component';

/**
 * WCAG 1.4.3: the highlighted credit (`.current strong`) is text, so it must
 * reach 4.5:1 on the dark panel (#12121e). It used --hug-accent, which the
 * shell defines as #7c4dff (3.22:1 as text, "backgrounds/borders only").
 * Reads the compiled component styles and checks both the token it names and
 * the literal fallback it paints if that token is missing.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB): number => {
  const c = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a: RGB, b: RGB): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (h: string): RGB => { const x = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as RGB; };

describe('credits highlight contrast (WCAG 1.4.3)', () => {
  it('.current strong is not painted with the background-only accent, and its fallback reads >= 4.5:1', () => {
    const css = ((CreditsComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles || []).join('\n');
    const rule = css.match(/\.current[^{]*strong[^{]*\{([^}]*)\}/);
    expect(rule).withContext('no .current strong rule compiled').not.toBeNull();
    const color = rule![1].match(/(?:^|;)\s*color\s*:\s*([^;]+)/)![1];
    expect(color).not.toMatch(/var\(--hug-accent\s*[,)]/);
    const fallback = color.match(/#[0-9a-fA-F]{6}/)![0];
    expect(ratio(hex(fallback), hex('#12121e'))).toBeGreaterThanOrEqual(4.5);
  });
});
