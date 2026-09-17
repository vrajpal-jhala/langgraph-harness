import { type RefObject, useCallback, useEffect, useRef } from 'react';

// Anything closer to the bottom than this still counts as "at the bottom" — absorbs scrollHeight/scrollTop's fractional-pixel jitter.
const BOTTOM_THRESHOLD_PX = 80;

// Pins the viewport to the bottom on every content change while active; scrolling up at any point (via onScrollPositionChange) drops the pin.
export function useStickToBottom(
  viewportRef: RefObject<HTMLDivElement | null>,
  content: unknown,
  active: boolean,
) {
  const stickRef = useRef(true);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !active || !stickRef.current) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [viewportRef, content, active]);

  const onScrollPositionChange = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    stickRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
  }, [viewportRef]);

  // Re-engages the pin — call on an explicit user action (send, retry) that should win over wherever they'd scrolled to read history.
  const scrollToBottom = useCallback(() => {
    stickRef.current = true;
    const el = viewportRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [viewportRef]);

  return { onScrollPositionChange, scrollToBottom };
}
