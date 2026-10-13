/**
 * Color tokens for the HadirOps mobile app. Same palette as the web admin and IEMS
 * (industrial slate, one blue action color); see design-system/hadirops/MASTER.md.
 * Screens import these names instead of writing hex values.
 */
export const colors = {
  // Action
  action: '#2563EB', // primary buttons, links, active tab; white text 5.2:1
  actionPressed: '#1D4ED8',
  actionTint: '#EFF6FF',
  actionTintStrong: '#DBEAFE',
  actionBorder: '#BFDBFE',
  actionBorderStrong: '#93C5FD',
  actionInk: '#1E3A8A',

  // Neutrals
  white: '#FFFFFF',
  black: '#000000',
  canvas: '#F8FAFC',
  muted: '#F1F5F9',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  ink: '#0F172A',
  text: '#334155',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',

  // Status
  success: '#059669',
  successStrong: '#047857',
  successTint: '#ECFDF5',
  successTintStrong: '#D1FAE5',
  successBorder: '#A7F3D0',
  warning: '#D97706',
  warningStrong: '#B45309',
  warningTint: '#FFFBEB',
  warningTintStrong: '#FEF3C7',
  warningBorder: '#FDE68A',
  danger: '#DC2626',
  dangerStrong: '#B91C1C',
  dangerBright: '#EF4444',
  dangerTint: '#FEF2F2',
  dangerTintStrong: '#FEE2E2',
  dangerBorder: '#FCA5A5',
  overtime: '#7C3AED',
  overtimeTint: '#F5F3FF',
} as const

export type ColorToken = keyof typeof colors
