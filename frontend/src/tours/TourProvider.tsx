import { type ReactNode, useCallback, useRef, useState } from 'react';
import {
  type EventData,
  EVENTS,
  Joyride,
  STATUS,
  type Step,
} from 'react-joyride';
import { useNavigate } from 'react-router-dom';
import { px, useMantineTheme } from '@mantine/core';

import {
  markTourSeen,
  type MobileNavControls,
  type StartTourOptions,
  TourContext,
} from './tourState';
import TourTooltip from './TourTooltip';
import type { TourStepConfig } from './types';

// Route changes take a tick to commit before the new page's target mounts;
// Joyride's own targetWaitTimeout then polls until it actually appears.
const ROUTE_SETTLE_MS = 60;
// The mobile drawer has its own open transition — give it time before Joyride measures the target.
const DRAWER_SETTLE_MS = 250;

const TourProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const theme = useMantineTheme();
  const mobileNavRef = useRef<MobileNavControls | null>(null);
  const pageDrawerRef = useRef<MobileNavControls | null>(null);
  const activeTourIdRef = useRef<string | null>(null);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [run, setRun] = useState(false);

  const registerMobileNav = useCallback(
    (controls: MobileNavControls | null) => {
      mobileNavRef.current = controls;
    },
    [],
  );

  const registerPageDrawer = useCallback(
    (controls: MobileNavControls | null) => {
      pageDrawerRef.current = controls;
    },
    [],
  );

  const endTour = useCallback(() => {
    activeTourIdRef.current = null;
    mobileNavRef.current?.close();
    pageDrawerRef.current?.close();
    setRun(false);
    setActiveTourId(null);
  }, []);

  const startTour = useCallback(
    (id: string, config: TourStepConfig[], opts?: StartTourOptions) => {
      // Auto-triggered tours shouldn't clobber one already in progress — the
      // interrupted one would never get marked seen and could resurface
      // disruptively later. An explicit replay (force) always wins.
      if (
        !opts?.force &&
        activeTourIdRef.current &&
        activeTourIdRef.current !== id
      ) {
        return;
      }

      const builtSteps: Step[] = config.map(
        ({ route, mobileNav, pageDrawer, ...step }) => ({
          ...step,
          before: async () => {
            if (route && route !== window.location.pathname) {
              navigate(route);
              await new Promise((resolve) =>
                setTimeout(resolve, ROUTE_SETTLE_MS),
              );
            }

            // These drawers only exist on small screens, opening/closing them on
            // desktop is a harmless no-op since they aren't rendered there.
            if (mobileNav) {
              mobileNavRef.current?.open();
              await new Promise((resolve) =>
                setTimeout(resolve, DRAWER_SETTLE_MS),
              );
            } else {
              mobileNavRef.current?.close();
            }

            if (pageDrawer) {
              pageDrawerRef.current?.open();
              await new Promise((resolve) =>
                setTimeout(resolve, DRAWER_SETTLE_MS),
              );
            } else {
              pageDrawerRef.current?.close();
            }
          },
        }),
      );

      activeTourIdRef.current = id;
      setActiveTourId(id);
      setSteps(builtSteps);
      setRun(true);
    },
    [navigate],
  );

  const handleEvent = useCallback(
    (data: EventData) => {
      // The user navigated (or otherwise interacted) their way off the step's
      // target — abandon rather than leaving Joyride stuck waiting, which
      // would also block any other tour from starting afterwards.
      if (data.type === EVENTS.TARGET_NOT_FOUND) {
        endTour();
        return;
      }
      if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
        if (activeTourIdRef.current) markTourSeen(activeTourIdRef.current);
        endTour();
      }
    },
    [endTour],
  );

  return (
    <TourContext value={{ startTour, registerMobileNav, registerPageDrawer }}>
      {children}
      {activeTourId && (
        <Joyride
          steps={steps}
          run={run}
          continuous
          scrollToFirstStep
          onEvent={handleEvent}
          tooltipComponent={TourTooltip}
          options={{
            targetWaitTimeout: 4000,
            skipBeacon: true,
            buttons: ['back', 'close', 'skip', 'primary'],
            closeButtonAction: 'skip',
            blockTargetInteraction: true,
            arrowColor: 'var(--mantine-color-body)',
            overlayColor:
              'color-mix(in srgb, var(--mantine-color-black) 55%, transparent)',
            spotlightRadius: Number(px(theme.radius.md)),
            zIndex: 10000,
          }}
        />
      )}
    </TourContext>
  );
};

export { TourProvider };
