import { createContext, use } from 'react';

import type { TourStepConfig } from './types';

const SEEN_KEY_PREFIX = 'harness:tour-seen:';

export const hasSeenTour = (id: string) =>
  localStorage.getItem(SEEN_KEY_PREFIX + id) === '1';

export const markTourSeen = (id: string) =>
  localStorage.setItem(SEEN_KEY_PREFIX + id, '1');

export interface MobileNavControls {
  open: () => void;
  close: () => void;
}

export interface StartTourOptions {
  /** Take over immediately, even if another tour is already running. Use for explicit user actions (replay buttons); leave unset for auto-triggers so they don't clobber a tour already in progress. */
  force?: boolean;
}

export interface ITourContext {
  startTour: (
    id: string,
    steps: TourStepConfig[],
    opts?: StartTourOptions,
  ) => void;
  /** Layout registers its mobile drawer open/close so tours can reach nav targets on small screens. */
  registerMobileNav: (controls: MobileNavControls | null) => void;
  /** The current page registers its own drawer (if it has one) open/close so tours can reach targets that only exist inside it. */
  registerPageDrawer: (controls: MobileNavControls | null) => void;
}

export const TourContext = createContext<ITourContext | null>(null);

export const useTour = () => {
  const ctx = use(TourContext);
  if (!ctx) throw new Error('useTour must be used within a TourProvider');
  return ctx;
};
