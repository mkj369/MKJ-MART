import localFont from 'next/font/local';

/** Self-hosted fonts (SIL Open Font License) — no runtime dependency on Google Fonts. */
export const cormorant = localFont({
  src: [
    { path: './fonts/cormorant-garamond-latin-wght-normal.woff2', weight: '300 700', style: 'normal' },
    { path: './fonts/cormorant-garamond-latin-wght-italic.woff2', weight: '300 700', style: 'italic' },
  ],
  variable: '--font-cormorant',
  display: 'swap',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

export const jost = localFont({
  src: [{ path: './fonts/jost-latin-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-jost',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', 'Helvetica Neue', 'Arial', 'sans-serif'],
});

/** A 1 KB subset containing only the Bangladeshi Taka sign (৳, U+09F3). */
export const taka = localFont({
  src: './fonts/taka-sign.woff2',
  variable: '--font-taka',
  display: 'block',
  declarations: [{ prop: 'unicode-range', value: 'U+09F3' }],
});

/** Bengali script, downloaded only when Bengali text appears on the page. */
export const bengali = localFont({
  src: [{ path: './fonts/noto-sans-bengali-bengali-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-bengali',
  display: 'swap',
  preload: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0951-0952, U+0964-0965, U+0980-09F2, U+09F4-09FE, U+200C-200D, U+25CC' }],
});
