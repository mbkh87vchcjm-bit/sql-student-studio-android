/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#14202B',
    tint: '#087E8B',
    background: '#F4F8F8',
    foreground: '#14202B',
    card: '#FFFFFF',
    cardForeground: '#14202B',
    primary: '#087E8B',
    primaryForeground: '#FFFFFF',
    secondary: '#E6F2F2',
    secondaryForeground: '#075B64',
    muted: '#E9F0F0',
    mutedForeground: '#64757A',
    accent: '#FF7665',
    accentForeground: '#FFFFFF',
    destructive: '#D9485F',
    destructiveForeground: '#FFFFFF',
    border: '#D7E4E5',
    input: '#D7E4E5',
    editor: '#102A36',
    editorForeground: '#D9F7F5',
    editorMuted: '#8EB5B7',
  },
  dark: {
    text: '#E8F3F3',
    tint: '#38C8C8',
    background: '#0C1C25',
    foreground: '#E8F3F3',
    card: '#132B35',
    cardForeground: '#E8F3F3',
    primary: '#38C8C8',
    primaryForeground: '#082127',
    secondary: '#173E49',
    secondaryForeground: '#B7EEEE',
    muted: '#17313A',
    mutedForeground: '#94B1B4',
    accent: '#FF8977',
    accentForeground: '#2D1110',
    destructive: '#FF6B78',
    destructiveForeground: '#2D1110',
    border: '#244650',
    input: '#2C5059',
    editor: '#081820',
    editorForeground: '#DBFFFC',
    editorMuted: '#86B9BC',
  },
  radius: 16,
};

export default colors;
