import type { TourStepConfig } from './types';

export const ORIENTATION_TOUR_ID = 'orientation';
export const THREAD_DETAIL_TOUR_ID = 'thread-detail';
export const WORKFLOW_DETAIL_TOUR_ID = 'workflow-detail';
export const CHAT_TOUR_ID = 'chat';

export const orientationSteps: TourStepConfig[] = [
  {
    target: 'body',
    placement: 'center',
    title: 'Welcome to langgraph-harness',
    content:
      "Let's take a quick look around — this covers the handful of concepts you'll see everywhere in the portal.",
  },
  {
    target: '[data-tour="nav-threads"]',
    route: '/threads',
    mobileNav: true,
    title: 'Threads',
    content:
      'A Thread is one ongoing conversation or task — for example, everything related to a single merge request.',
  },
  {
    target: '[data-tour="threads-list"]',
    route: '/threads',
    title: 'All your threads',
    content:
      'Every thread shows up in the list below — use these filters to narrow by status or project. Open one to see what the agent did, is doing, or is about to do.',
  },
  {
    target: '[data-tour="nav-chat"]',
    mobileNav: true,
    title: 'Chat',
    content:
      'Chat directly with the GitLab-aware assistant outside of a merge request — ask questions, request changes, or just talk something through.',
  },
  {
    target: '[data-tour="chat-composer"]',
    route: '/chat/new',
    title: 'Start a conversation',
    content:
      'Type a message below to start chatting. Toggle GitLab tools, server tools, or extended reasoning from the "+" menu, and pick a model on the right.',
  },
  {
    target: '[data-tour="nav-memories"]',
    mobileNav: true,
    title: 'Memories',
    content:
      'As it reviews, the agent flags durable, repo-specific facts — conventions, recurring false positives, team preferences — worth carrying into future reviews.',
  },
  {
    target: '[data-tour="memories-filters"]',
    route: '/memories',
    title: 'Browse your memories',
    content:
      'Pick a project — or your own personal memories — to see what langgraph-harness has learned, and filter by category to narrow the list.',
  },
  {
    target: '[data-tour="nav-workflows"]',
    mobileNav: true,
    title: 'Workflows',
    content:
      'A Workflow is a configured agent pipeline — the set of steps an agent can take to get a job done.',
  },
  {
    target: '[data-tour="workflows-grid"]',
    route: '/workflows',
    title: 'All your workflows',
    content:
      'Open a workflow to see its execution graph — a flowchart of the steps it can take and how it moves between them.',
  },
  {
    target: '[data-tour="nav-dashboard"]',
    mobileNav: true,
    title: 'Dashboard',
    content:
      'The Dashboard shows the live job queue — how many workflow runs are active, waiting, or delayed right now.',
  },
  {
    target: '[data-tour="dashboard-queue"]',
    route: '/dashboard',
    title: 'Queue',
    content:
      'Active runs are currently in progress, Waiting runs are next in line, and Delayed runs are scheduled for later. Click a job to jump to its thread.',
  },
];

export const threadDetailSteps: TourStepConfig[] = [
  {
    target: '[data-tour="thread-runs"]',
    title: 'Runs',
    content:
      "Each time the agent works on this thread, that's a Run. A thread can build up several runs over time — pick one to inspect it.",
    pageDrawer: true,
  },
  {
    target: '[data-tour="thread-metrics"]',
    title: 'Review threads',
    content:
      'How many review comment threads langgraph-harness opened, resolved, or left open across every run — a quick read on whether its feedback got addressed.',
    pageDrawer: true,
  },
  {
    target: '[data-tour="thread-memories"]',
    title: 'Memories',
    content:
      "Durable, repo-specific facts the agent flagged during this run — pending until the run ends, then shown as added, updated, retired, or skipped once it decides what's worth keeping.",
    pageDrawer: true,
  },
  {
    target: '[data-tour="thread-tabs"]',
    title: 'Summary & Debug',
    content:
      'Summary is the plain-English recap of what happened. Debug shows the full step-by-step trace — tool calls, messages, and checkpoints you can retry from if something went wrong.',
  },
  {
    target: '[data-tour="thread-context"]',
    title: 'Context',
    content:
      "How much of the model's context window this thread has used, carried across every run — colored green to red as it climbs toward the limit.",
  },
  {
    target: '[data-tour="thread-todos"]',
    title: 'Todos',
    content:
      'When the agent keeps its own task list for a run, it shows up here so you can track progress at a glance.',
  },
];

export const workflowDetailSteps: TourStepConfig[] = [
  {
    target: '[data-tour="workflow-status"]',
    title: 'Status',
    content:
      'Idle, queued, or running — this badge shows what this workflow is doing right now.',
  },
  {
    target: '[data-tour="workflow-graph"]',
    title: 'Execution graph',
    content:
      "This flowchart is the workflow's execution graph — the steps it can take and how it moves between them. Think of it as a decision map, not something you need to edit.",
  },
];

export const chatSteps: TourStepConfig[] = [
  {
    target: '[data-tour="chat-query-list"]',
    pageDrawer: true,
    title: 'Your turns',
    content:
      "Every message you've sent shows up here — click one to jump straight to it in the conversation.",
  },
];
