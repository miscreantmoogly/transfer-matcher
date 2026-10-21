// Foundational colors, shared by every component. Indexed by name and shade,
// like Ambrook's styles/colors module: Colors.sage[60], Colors.wheat[30].
// Shades run light (5) to dark (90).
//
// Components never hard-code a hex value. They use the semantic tokens below
// (exposed as CSS variables by the root layout), so a palette change is one edit.

export const Colors = {
  neutral: {
    0: "#ffffff",
    5: "#fbf9f5",
    8: "#faf7f2",
    10: "#f6f1e7",
    15: "#efe9e0",
    20: "#ece6dc",
    30: "#dcd4c9",
    45: "#a59a8c",
    50: "#968a7b",
    70: "#60564c",
    90: "#211b15",
  },
  soil: { 60: "#4a5546", 70: "#30392d", 80: "#252a23" },
  wheat: { 5: "#fdf8ef", 15: "#f7e1b5", 30: "#e8b672", 40: "#dda75a" },
  sage: { 5: "#f6f9f5", 10: "#e5ede3", 60: "#4f6b4c" },
  amber: { 10: "#f7ead2", 70: "#7a5418" },
  brick: { 10: "#f6e3de", 60: "#a4473b" },
} as const;

export type ColorName = keyof typeof Colors;

/** What each color is FOR. Components and CSS refer to these names, never to hex values. */
export const Theme = {
  sidebar: Colors.soil[80],
  "sidebar-hover": Colors.soil[70],
  "sidebar-ink": Colors.neutral[15],
  "sidebar-muted": Colors.neutral[45],
  avatar: Colors.soil[60],

  surface: Colors.neutral[0],
  page: Colors.neutral[5],
  ink: Colors.neutral[90],
  muted: Colors.neutral[70],
  subtle: Colors.neutral[50],
  line: Colors.neutral[20],
  "line-strong": Colors.neutral[30],
  hover: Colors.neutral[8],
  selected: Colors.neutral[10],
  chip: Colors.neutral[15],

  wheat: Colors.wheat[30],
  "wheat-hover": Colors.wheat[40],
  "wheat-weak": Colors.wheat[5],
  /** Evidence highlighted in a bank memo. */
  highlight: Colors.wheat[15],
  sage: Colors.sage[60],
  "sage-weak": Colors.sage[10],
  "sage-faint": Colors.sage[5],
  amber: Colors.amber[70],
  "amber-weak": Colors.amber[10],
  brick: Colors.brick[60],
  "brick-weak": Colors.brick[10],
} as const;

export type ThemeToken = keyof typeof Theme;

/** `:root { --sage: #4f6b4c; ... }`, rendered once by the root layout. */
export function themeCss(): string {
  return `:root{${Object.entries(Theme)
    .map(([name, value]) => `--${name}:${value};`)
    .join("")}}`;
}
