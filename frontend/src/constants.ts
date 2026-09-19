import type { RunStatus, WorkflowStatus } from './types';

export const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  queued: 'gray',
  running: 'blue',
  completed: 'green',
  failed: 'red',
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
  interrupted: 'yellow',
  completed: 'gray',
  superseded: 'gray',
};
