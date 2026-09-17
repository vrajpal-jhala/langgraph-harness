import {
  Button,
  createTheme,
  Indicator,
  MultiSelect,
  NavLink,
  Select,
  Tooltip,
} from '@mantine/core';
import { DateInput, DateTimePicker } from '@mantine/dates';

export const theme = createTheme({
  colors: {
    dark: [
      '#C9C9C9',
      '#B8B8B8',
      '#828282',
      '#696969',
      '#303030',
      '#242424',
      '#1A1A1A',
      '#141414',
      '#0F0F0F',
      '#0A0A0A',
    ],

    blue: [
      '#EFF6FF',
      '#DBEAFE',
      '#BFDBFE',
      '#93C5FD',
      '#60A5FA',
      '#3B82F6',
      '#2563EB',
      '#1D4ED8',
      '#1E40AF',
      '#1E3A8A',
    ],

    teal: [
      '#F0FDFA',
      '#CCFBF1',
      '#99F6E4',
      '#5EEAD4',
      '#2DD4BF',
      '#14B8A6',
      '#0D9488',
      '#0F766E',
      '#115E59',
      '#134E4A',
    ],

    orange: [
      '#FFF7ED',
      '#FFEDD5',
      '#FED7AA',
      '#FDBA74',
      '#FB923C',
      '#F97316',
      '#EA580C',
      '#C2410C',
      '#9A3412',
      '#7C2D12',
    ],

    gray: [
      '#F8FAFC',
      '#F1F5F9',
      '#E2E8F0',
      '#CBD5E1',
      '#94A3B8',
      '#7F93B0',
      '#6D7E97',
      '#606F85',
      '#546275',
      '#495465',
    ],

    green: [
      '#ECFDF3',
      '#D1FAE5',
      '#A7F3D0',
      '#6EE7B7',
      '#34D399',
      '#10B981',
      '#059669',
      '#047857',
      '#065F46',
      '#064E3B',
    ],

    yellow: [
      '#FFFBEB',
      '#FEF3C7',
      '#FDE68A',
      '#FCD34D',
      '#FBBF24',
      '#F59E0B',
      '#D97706',
      '#B45309',
      '#92400E',
      '#78350F',
    ],

    red: [
      '#FFF1F2',
      '#FFE4E6',
      '#FECDD3',
      '#FDA4AF',
      '#FB7185',
      '#F43F5E',
      '#E11D48',
      '#BE123C',
      '#9F1239',
      '#881337',
    ],
  },

  primaryColor: 'blue',
  primaryShade: 6,
  defaultRadius: 'md',

  defaultGradient: {
    from: 'blue',
    to: 'teal',
    deg: 90,
  },

  components: {
    Button: Button.extend({
      defaultProps: {
        variant: 'gradient',
      },
    }),
    NavLink: NavLink.extend({
      styles: {
        root: { borderRadius: 'var(--mantine-radius-md)' },
      },
    }),
    Indicator: Indicator.extend({
      styles: (_, props) =>
        props.variant === 'dot'
          ? {
              indicator: {
                transform: 'unset',
                position: 'unset',
              },
            }
          : {},
    }),
    Tooltip: Tooltip.extend({
      defaultProps: {
        events: {
          hover: true,
          focus: true,
          touch: true,
        },
        openDelay: 400,
      },
    }),
    // Reserves the checkmark's space for every option, not just the checked one — otherwise unchecked labels sit flush left while the checked one is indented.
    Select: Select.extend({ defaultProps: { withAlignedLabels: true } }),
    MultiSelect: MultiSelect.extend({
      defaultProps: { withAlignedLabels: true },
    }),
    DateInput: DateInput.extend({ defaultProps: { highlightToday: true } }),
    DateTimePicker: DateTimePicker.extend({
      defaultProps: { highlightToday: true },
    }),
  },
});
