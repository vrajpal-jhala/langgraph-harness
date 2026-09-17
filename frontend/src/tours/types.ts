import type { Placement } from 'react-joyride';

export interface TourStepConfig {
  target: string;
  title?: string;
  content: string;
  placement?: Placement | 'auto' | 'center';
  /** Pathname to navigate to before showing this step. Omit for same-page steps. */
  route?: string;
  /** Target only exists inside the mobile nav drawer — open it before this step, close it after. */
  mobileNav?: boolean;
  /** Target only exists inside the current page's own drawer (e.g. a mobile runs sidebar) — open it before this step, close it after. */
  pageDrawer?: boolean;
}
