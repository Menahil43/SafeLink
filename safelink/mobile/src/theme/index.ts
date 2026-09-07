// SafeLink Design System — Colors, Typography, Spacing

export const Colors = {
  // Primary brand
  primary: '#7C3AED',
  primaryLight: '#9F67FF',
  primaryDark: '#5B21B6',
  primarySurface: '#F3EEFF',

  // SOS / Emergency
  sos: '#EF4444',
  sosLight: '#FEE2E2',
  sosDark: '#B91C1C',

  // Safe / Active
  safe: '#22C55E',
  safeLight: '#DCFCE7',
  safeDark: '#15803D',

  // Warning / Deviation
  warning: '#F59E0B',
  warningLight: '#FEF3C7',

  // Neutral
  background: '#FFFFFF',
  surface: '#F8F7FF',
  surfaceCard: '#FFFFFF',
  border: '#E5E7EB',
  borderLight: '#F3F4F6',

  // Text
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textOnPrimary: '#FFFFFF',
  textOnSOS: '#FFFFFF',

  // Dark theme (AI Detection screen)
  darkBg: '#0F0F1E',
  darkSurface: '#1A1A2E',
  darkCard: '#16213E',
  darkText: '#F8FAFC',
  darkTextSecondary: '#94A3B8',

  // Status
  live: '#22C55E',
  offline: '#6B7280',
  uploading: '#3B82F6',

  // Avatar colors pool
  avatarColors: [
    '#7C3AED', '#EF4444', '#22C55E', '#F59E0B',
    '#3B82F6', '#EC4899', '#14B8A6', '#F97316',
  ],
} as const;

export const Typography = {
  // Font families (system fonts — works in Expo Go without custom font install)
  fontRegular: undefined as unknown as string,
  fontMedium: undefined as unknown as string,
  fontSemiBold: undefined as unknown as string,
  fontBold: undefined as unknown as string,

  // Sizes
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 28,
  xxxl: 36,
  display: 48,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 999,
} as const;

export const Shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  sos: {
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
} as const;
