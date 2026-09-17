import { CompletionStatus, InstructionStatus } from '#types.js';

import { config, llms, noteFooter } from './config.js';

type AlertType = 'note' | 'caution' | 'tip' | 'warning';

function alertBlock(type: AlertType, title: string, body: string): string {
  return `> [!${type.toUpperCase()}] ${title}\n> ${body}`;
}

function threadLink(threadId?: string): string {
  return threadId
    ? ` · [View in langgraph-harness](${config.appUrl}/threads/${threadId})`
    : '.';
}

// Only buildMrNoteBody/buildWorkItemResolveNoteBody append this footer — real review comments/replies never do.
export function isAutomatedStatusNote(body: string): boolean {
  return body.includes(noteFooter);
}

// Instruction status lifecycle for full-body note PUTs, shared by mr-review
// and work-item-resolve:
// - `loading`: set at run start before LoadInstructions runs.
// - Pass the resolved status on every later update so the italic line survives.
function instructionLine(status: InstructionStatus): string | null {
  switch (status) {
    case InstructionStatus.Loading:
      return 'Loading repository instructions...';
    case InstructionStatus.LoadedAll:
      return 'Applied repository instructions from `.harness.yml`.';
    case InstructionStatus.LoadedFiltered:
      return 'Applied repository instructions from `.harness.yml` (filtered to changed files).';
    case InstructionStatus.Failed:
      return "Couldn't load repository instructions — continuing without them.";
    case InstructionStatus.Missing:
      return 'No repository instructions configured.';
    default:
      return null;
  }
}

function buildMrNoteBody(
  modelId: string,
  alert: { type: AlertType; title: string; body: string },
  status: InstructionStatus,
  threadId?: string,
): string {
  const modelName = llms.find((m) => m.model === modelId)?.name ?? modelId;
  const line = instructionLine(status);

  return [
    alertBlock(alert.type, alert.title, alert.body),
    ...(line ? [`_${line}_`] : []),
    `Reviewed by <small>${modelName}</small>${threadLink(threadId)}`,
    noteFooter,
  ].join('\n\n');
}

export const mrNote = {
  inProgress: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildMrNoteBody(
      modelId,
      {
        type: 'note',
        title: 'Review in Progress',
        body: 'The agent is currently analysing this merge request. Comments will appear shortly if any.',
      },
      status,
      threadId,
    ),
  completed: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildMrNoteBody(
      modelId,
      {
        type: 'tip',
        title: 'Review Completed',
        body: 'The agent has finished reviewing this merge request.',
      },
      status,
      threadId,
    ),
  failed: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildMrNoteBody(
      modelId,
      {
        type: 'warning',
        title: 'Review Failed',
        body: 'The review could not be completed. Check the dashboard for details.',
      },
      status,
      threadId,
    ),
  aborted: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildMrNoteBody(
      modelId,
      {
        type: 'caution',
        title: 'Review Aborted',
        body: 'The review was cancelled before it could finish.',
      },
      status,
      threadId,
    ),
  timedOut: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildMrNoteBody(
      modelId,
      {
        type: 'caution',
        title: 'Review Timed Out',
        body: 'The review took too long and was stopped automatically. Try again, or split the merge request into smaller changes.',
      },
      status,
      threadId,
    ),
};

const COMPLETION_ALERT: Record<
  CompletionStatus,
  { type: AlertType; title: string }
> = {
  [CompletionStatus.Done]: { type: 'tip', title: 'Done' },
  [CompletionStatus.Partial]: { type: 'caution', title: 'Partially Done' },
  [CompletionStatus.Blocked]: { type: 'warning', title: 'Blocked' },
};

// `#<issueIid>` alone at creation (no closing keyword — merging shouldn't auto-close the issue); the completion block is appended once assessed, and re-appended (not accumulated) on every later round.
export function workItemResolveDescription(
  issueIid: string,
  completion?: { status: CompletionStatus; summary: string },
): string {
  const reference = `#${issueIid}`;
  if (!completion) return reference;

  const { type, title } = COMPLETION_ALERT[completion.status];
  return [reference, alertBlock(type, title, completion.summary)].join('\n\n');
}

// task-resolve has no issue to reference, so the prompt itself heads the description; the completion block is appended once assessed, and re-appended (not accumulated) on every later round.
// Status/summary land on the MR note only (see taskResolveNote) — kept out of the description to avoid saying the same thing twice on the same MR.
export function taskResolveDescription(prompt: string): string {
  return ['**Requested:**', '', prompt].join('\n');
}

function buildWorkItemResolveNoteBody(
  modelId: string,
  alert: { type: AlertType; title: string; body: string },
  status: InstructionStatus,
  threadId?: string,
): string {
  const modelName = llms.find((m) => m.model === modelId)?.name ?? modelId;
  const line = instructionLine(status);

  return [
    alertBlock(alert.type, alert.title, alert.body),
    ...(line ? [`_${line}_`] : []),
    `Resolved by <small>${modelName}</small>${threadLink(threadId)}`,
    noteFooter,
  ].join('\n\n');
}

export const workItemResolveNote = {
  working: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'note',
        title: 'Resolution in Progress',
        body: 'The agent is currently implementing this issue.',
      },
      status,
      threadId,
    ),
  done: (
    modelId: string,
    status: InstructionStatus,
    mrUrl: string,
    summary: string,
    threadId?: string,
  ) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'tip',
        title: 'Done',
        body: `${summary} See the [merge request](${mrUrl}) for the change.`,
      },
      status,
      threadId,
    ),
  // No mrUrl — the run made no commits, so no merge request was ever opened.
  noChanges: (
    modelId: string,
    status: InstructionStatus,
    summary: string,
    threadId?: string,
  ) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'tip',
        title: 'No Changes Needed',
        body: `${summary} No changes were made, so no merge request was opened.`,
      },
      status,
      threadId,
    ),
  partial: (
    modelId: string,
    status: InstructionStatus,
    mrUrl: string,
    summary: string,
    threadId?: string,
  ) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'caution',
        title: 'Partially Done',
        body: `${summary} See the [merge request](${mrUrl}) for what's there so far.`,
      },
      status,
      threadId,
    ),
  blocked: (
    modelId: string,
    status: InstructionStatus,
    mrUrl: string,
    summary: string,
    threadId?: string,
  ) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'warning',
        title: 'Blocked',
        body: `${summary} See the [merge request](${mrUrl}) for what was attempted.`,
      },
      status,
      threadId,
    ),
  failed: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'warning',
        title: 'Resolution Failed',
        body: 'The issue could not be resolved. Check the dashboard for details.',
      },
      status,
      threadId,
    ),
  aborted: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'caution',
        title: 'Resolution Aborted',
        body: 'Work on this issue was cancelled before it could finish.',
      },
      status,
      threadId,
    ),
  timedOut: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'caution',
        title: 'Resolution Timed Out',
        body: 'The work took too long and was stopped automatically. Try again, or split the issue into smaller pieces.',
      },
      status,
      threadId,
    ),
};

// Same lifecycle as workItemResolveNote, but these land on the MR itself, so they never link back to it.
export const taskResolveNote = {
  working: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'note',
        title: 'Working on It',
        body: 'The agent is currently working on this request.',
      },
      status,
      threadId,
    ),
  done: (
    modelId: string,
    status: InstructionStatus,
    summary: string,
    threadId?: string,
  ) =>
    buildWorkItemResolveNoteBody(
      modelId,
      { type: 'tip', title: 'Done', body: summary },
      status,
      threadId,
    ),
  partial: (
    modelId: string,
    status: InstructionStatus,
    summary: string,
    threadId?: string,
  ) =>
    buildWorkItemResolveNoteBody(
      modelId,
      { type: 'caution', title: 'Partially Done', body: summary },
      status,
      threadId,
    ),
  blocked: (
    modelId: string,
    status: InstructionStatus,
    summary: string,
    threadId?: string,
  ) =>
    buildWorkItemResolveNoteBody(
      modelId,
      { type: 'warning', title: 'Blocked', body: summary },
      status,
      threadId,
    ),
  failed: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'warning',
        title: 'Run Failed',
        body: 'The request could not be completed. Check the dashboard for details.',
      },
      status,
      threadId,
    ),
  aborted: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'caution',
        title: 'Run Aborted',
        body: 'This request was cancelled before it could finish.',
      },
      status,
      threadId,
    ),
  timedOut: (modelId: string, status: InstructionStatus, threadId?: string) =>
    buildWorkItemResolveNoteBody(
      modelId,
      {
        type: 'caution',
        title: 'Run Timed Out',
        body: 'The work took too long and was stopped automatically. Try again with a narrower request.',
      },
      status,
      threadId,
    ),
};
