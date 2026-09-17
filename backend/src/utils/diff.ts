// Parses a unified diff into the line positions valid to comment on — GitLab accepts a mismatched old_line/new_line pairing at draft-note creation and silently drops it at publish with no error, so this is checked ourselves beforehand.
export type DiffLineMap = {
  newLines: Set<number>; // every line number on the "+" side (added or context)
  oldLines: Set<number>; // every line number on the "-" side (removed or context)
  addedLines: Set<number>; // pure additions only ("+" lines) — a new_line here is safe to send alone
  removedLines: Set<number>; // pure removals only ("-" lines) — an old_line here is safe to send alone
  contextPairs: Set<string>; // old_line:new_line pairs valid together — only unchanged context lines exist on both sides at once
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseDiffLineMap(diff: string) {
  const newLines = new Set<number>();
  const oldLines = new Set<number>();
  const addedLines = new Set<number>();
  const removedLines = new Set<number>();
  const contextPairs = new Set<string>();

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of diff.split('\n')) {
    const hunk = HUNK_HEADER.exec(line);

    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue; // file-header lines, skipped defensively
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    if (line.startsWith('-')) {
      oldLines.add(oldLine);
      removedLines.add(oldLine);
      oldLine += 1;
    } else if (line.startsWith('+')) {
      newLines.add(newLine);
      addedLines.add(newLine);
      newLine += 1;
    } else {
      // Context line: present unchanged on both sides, so it must stay out of addedLines/removedLines or a position check could mistake it for an actual change.
      oldLines.add(oldLine);
      newLines.add(newLine);
      contextPairs.add(`${oldLine}:${newLine}`);
      oldLine += 1;
      newLine += 1;
    }
  }

  return { newLines, oldLines, addedLines, removedLines, contextPairs };
}

export function validatePosition(
  map: DiffLineMap,
  position: { old_line?: number | null; new_line?: number | null },
) {
  const { old_line, new_line } = position;

  if (old_line != null && new_line != null) {
    if (map.contextPairs.has(`${old_line}:${new_line}`)) {
      return {
        success: `old_line ${old_line}/new_line ${new_line} is a valid unchanged context line.`,
      };
    }

    return {
      error:
        `old_line ${old_line} and new_line ${new_line} don't refer to the ` +
        `same line — they're only valid together for an unchanged context ` +
        `line present at both positions. For a pure addition use new_line ` +
        `only; for a removed line use old_line only.`,
    };
  }

  if (new_line != null) {
    if (map.addedLines.has(new_line)) {
      return {
        success: `new_line ${new_line} is a valid added line.`,
      };
    }

    if (map.newLines.has(new_line)) {
      const oldLine = [...map.contextPairs]
        .map((p) => p.split(':').map(Number))
        .find(([, n]) => n === new_line)?.[0];

      return {
        error:
          `new_line ${new_line} is an unchanged context line, not an addition — GitLab accepts ` +
          `new_line alone here but silently fails to publish the note (201 on create, 204 on ` +
          `publish, no note ever appears). Pass old_line${oldLine != null ? ` ${oldLine}` : ''} ` +
          `together with new_line ${new_line} instead.`,
      };
    }

    return {
      error: `new_line ${new_line} doesn't correspond to any added or context line in this diff.`,
    };
  }

  if (old_line != null) {
    if (map.removedLines.has(old_line)) {
      return {
        success: `old_line ${old_line} is a valid removed line.`,
      };
    }

    if (map.oldLines.has(old_line)) {
      const newLine = [...map.contextPairs]
        .map((p) => p.split(':').map(Number))
        .find(([o]) => o === old_line)?.[1];

      return {
        error:
          `old_line ${old_line} is an unchanged context line, not a removal — GitLab accepts ` +
          `old_line alone here but silently fails to publish the note (201 on create, 204 on ` +
          `publish, no note ever appears). Pass new_line${newLine != null ? ` ${newLine}` : ''} ` +
          `together with old_line ${old_line} instead.`,
      };
    }

    return {
      error: `old_line ${old_line} doesn't correspond to any removed or context line in this diff.`,
    };
  }

  return {
    error: 'position must include at least one of old_line or new_line.',
  };
}
