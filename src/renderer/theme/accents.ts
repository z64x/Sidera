export const accents = {
  primary: '#3b82f6',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
} as const;

export type Accent = keyof typeof accents;
