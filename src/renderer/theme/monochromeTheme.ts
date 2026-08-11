import type { ThemeConfig } from 'antd';
import theme from 'antd/es/theme';
import { accents } from './accents';

export const palette = {
  background: '#050505',
  panel: '#0d0d0d',
  panelElevated: '#141414',
  border: '#262626',
  borderStrong: '#3a3a3a',
  text: '#f5f5f5',
  textMuted: '#a3a3a3',
  textSubtle: '#737373',
} as const;

export const antTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: accents.primary,
    colorSuccess: accents.success,
    colorWarning: accents.warning,
    colorError: accents.danger,
    colorBgBase: palette.background,
    colorBgContainer: palette.panel,
    colorBgElevated: palette.panelElevated,
    colorBorder: palette.border,
    colorText: palette.text,
    colorTextSecondary: palette.textMuted,
    borderRadius: 8,
    controlHeight: 36,
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  components: {
    Button: {
      borderRadius: 7,
      controlHeight: 36,
    },
    Card: {
      borderRadiusLG: 8,
    },
    Layout: {
      bodyBg: palette.background,
      headerBg: palette.background,
      siderBg: palette.panel,
    },
    Menu: {
      itemHeight: 32,
      itemMarginBlock: 2,
      itemMarginInline: 2,
      itemPaddingInline: 10,
      iconMarginInlineEnd: 6,
    },
  },
};
