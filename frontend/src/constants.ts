import { IconGitMerge, IconGitPullRequestClosed } from '@tabler/icons-react';

import type { RunStatus, WorkflowStatus } from './types';

export const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  queued: 'gray',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
  interrupted: 'yellow',
  superseded: 'gray',
};

export const WORKFLOW_STATUS_COLOR: Record<WorkflowStatus, string> = {
  idle: 'gray',
  queued: 'gray',
  running: 'blue',
};

export const CHAT_STATUS_COLOR: Record<RunStatus, string> = {
  queued: 'blue',
  running: 'blue',
  failed: 'red',
  cancelled: 'gray',
  interrupted: 'yellow',
  completed: 'gray',
  superseded: 'gray',
};

export const CODE_CHANGE_REQUEST_STATE = {
  merged: { icon: IconGitMerge, color: 'violet.6', label: 'Merged' },
  closed: { icon: IconGitPullRequestClosed, color: 'red.6', label: 'Closed' },
};
