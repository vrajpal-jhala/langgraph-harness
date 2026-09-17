// Catches a stuck generation well before it burns the full run timeout.
export const IDLE_TOOL_CALL_MS = 60 * 1000;
export const REPEATED_TEXT_THRESHOLD = 3;

export function generationLoopReason(text: string): string {
  const excerpt = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  const minutes = IDLE_TOOL_CALL_MS / 60000;
  return (
    `No tool call for ${minutes} minute${minutes === 1 ? '' : 's'} — the ` +
    `model repeated the same text ${REPEATED_TEXT_THRESHOLD}+ times: "${excerpt}"`
  );
}

// Skips short fragments ("Good.") that could coincidentally repeat.
function findRepeated(units: string[], threshold: number): string | null {
  const counts = new Map<string, number>();

  for (const raw of units) {
    const unit = raw.trim();
    if (unit.length < 40) continue;

    const count = (counts.get(unit) ?? 0) + 1;
    if (count >= threshold) return unit;
    counts.set(unit, count);
  }

  return null;
}

// Two granularities: prose sentences usually repeat verbatim, but a reworded connector around a byte-identical code block only shows up at the paragraph level.
export function findRepeatedText(
  content: string,
  threshold: number,
): string | null {
  return (
    findRepeated(content.split(/(?<=[.!?])\s+/), threshold) ??
    findRepeated(content.split('\n\n'), threshold)
  );
}
