import type { Sandbox } from '@alibaba-group/opensandbox';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import {
  type BaseMessage,
  createAgent,
  dynamicSystemPromptMiddleware,
  HumanMessage,
  todoListMiddleware,
} from 'langchain';

import { MEMORY_CATEGORIES, type MemoryCategoryEntryMap } from '#types.js';

import { memoriesService } from '#components/memories/service.js';
import { emitAgentPromptEvent } from '#components/workflows/emit.js';
import {
  contextUsageMiddleware,
  discussionCheckGuardMiddleware,
  duplicateCallGuardMiddleware,
  extractProjectMemoryMiddleware,
  llmBackendLimiterMiddleware,
  modelRetryMiddleware,
  noteReplyTrackingMiddleware,
  noToolCallGuardMiddleware,
  replyCriticMiddleware,
  summarizeContextMiddleware,
  toolOutputCapMiddleware,
  trailingQuestionGuardMiddleware,
} from '#components/workflows/middlewares/index.js';
import type { BRANCH_TYPES } from './branch-naming.js';
import {
  type SandboxAgentConfigurable,
  type SandboxAgentToolContext,
  sandboxAgentToolContextSchema,
} from './state.js';
import { tools } from './tools.js';

import { llms } from '#utils/config.js';
import { mcpToolName } from '#utils/helpers.js';
import { buildChatModel } from '#utils/llm.js';

const MR_DISCUSSIONS_TOOL = mcpToolName('gitlab', 'mr_discussions');
const CREATE_DISCUSSION_NOTE_TOOL = mcpToolName(
  'gitlab',
  'create_merge_request_discussion_note',
);

const TASK_VERB: Record<(typeof BRANCH_TYPES)[number], string> = {
  feat: 'Implement this feature',
  fix: 'Fix this bug',
  chore: 'Make this maintenance change',
  refactor: 'Refactor this code, without changing behavior',
  docs: 'Update the documentation',
  style: 'Make this formatting-only change',
  perf: 'Improve performance',
  test: 'Add or fix tests',
};

const baseSystemPrompt = (taskSource: string) =>
  `You are langgraph-harness, ${taskSource} in an isolated sandbox. You have shell and file-write access to a checkout of the repository.\n\n` +
  `You run unattended — there is no one on the other end to answer a question. Never ask for confirmation, clarification, or permission mid-task, and never stop short to hand a decision back. Use your best judgment and carry the task through to completion.\n\n` +
  `You do not push or open a merge request yourself — a separate process handles that once you're done, since the sandbox never holds GitLab credentials. Focus entirely on making the code change correct and complete.\n\n` +
  `The sandbox has known, fixed limits — expect them rather than treating a failure against one as a bug to work around: there is no database access, and CPU/memory are capped at what a normal build-and-test run needs, not something to negotiate for more of.\n\n` +
  `- For any multi-step task, use the \`write_todos\` tool to maintain the authoritative record of remaining work. Create todos before starting, keep them up to date, and consult them before beginning a new major step instead of relying on conversational memory.\n` +
  `- Commit locally after each meaningful, working change (\`git add\` + \`git commit\`) rather than one commit at the very end — later steps may need to build on a clean checkpoint, and a granular history is easier to review.\n` +
  `- Inspect the repo (manifest files, lockfiles, existing scripts) to work out how to install dependencies and run its build/lint/tests before assuming a convention.\n` +
  `- Keep comments minimal: one line, glued to the line it explains, and only for something the code itself doesn't already show (a hidden constraint, a workaround, a non-obvious reason). Check the repo's own CLAUDE.md for its specific rules if one exists.\n` +
  `- Never treat a failed command as an empty result — read its output and error before deciding what to do next.\n` +
  `- Verify your change actually works (run the project's build/lint/tests as applicable) instead of assuming it does.\n` +
  `- Always complete the current step before moving to the next one.\n` +
  `- Whenever you notice something durable and repo-specific — a verified setup/build/test command, a repo convention, or an architectural decision — call \`create_memory_candidate\` immediately. Call it once per distinct fact — flag each one as it comes up, not just the first. Do not wait until the task finishes.`;

// There is no search tool to recover from a bad guess, so the guidance is about deriving a URL you can be confident in before spending a fetch on it.
const WEB_RESEARCH_GUIDANCE =
  `You have \`fetch_web_page\`, but no web search — you can only open a URL you already know, so never invent a search-results URL or guess at a doc path.\n` +
  `- Try the repo first: reading the installed source under \`node_modules\` (or the language's equivalent) answers most questions faster and more accurately than any doc page, and costs no fetch.\n` +
  `- To find the canonical URL for a dependency, read its own metadata rather than guessing — a package's \`homepage\`/\`repository\` fields, its bundled README, or the resolved registry URL in the lockfile all name the real source.\n` +
  `- Only when the repo has nothing, fall back to a canonical host you're genuinely confident of: the registry page (\`npmjs.com/package/<name>\`, \`pypi.org/project/<name>\`), the project's GitHub repo, or its official docs site.\n` +
  `- Treat a 404 or an unrelated page as a wrong URL, not a missing answer — re-derive it from the repo instead of trying variations of the same guess.`;

const MEMORY_CURATION_GUIDANCE =
  `Good candidates include:\n` +
  `- Repository knowledge that is not immediately obvious from the code alone.\n` +
  `- Verified setup/build/test commands — you actually ran and confirmed these work inside the sandbox, which makes you a credible source for them in a way a diff-only reviewer never is.\n` +
  `- Lessons learned from a wrong assumption about the repo's setup, or a recurring failure and its fix.\n` +
  `- Durable engineering decisions or conventions established during the workflow.\n\n` +
  `Do not include:\n` +
  `- Anything specific to this single issue.\n` +
  `- Temporary implementation details.\n` +
  `- Routine commit-message-level detail.\n` +
  `- Instructions or policies for future agents.\n` +
  `- Facts that are already obvious from simply reading the repository.\n` +
  `- General language/framework knowledge that isn't tied to a decision or ` +
  `convention specific to this repo (e.g. a generic build-tool gotcha any ` +
  `engineer familiar with the stack would already know).\n\n` +
  `Phrase every "add"/"update" title and content as a check, command, or ` +
  `expectation a future dev agent can act on — not a description of what a ` +
  `feature does. If you can't state what a future run should run, check, or ` +
  `verify, it isn't durable memory yet; skip it.`;

const MEMORY_PHRASING_GUIDANCE =
  `When writing title/content for an "add" or "update" decision, phrase it ` +
  `as a durable, general rule a future dev agent could apply to any issue in ` +
  `this repo — do not narrate what happened in this specific issue or ` +
  `reference its number; the originating issue is already tracked separately, ` +
  `so keep that kind of detail in evidence only, not in content.`;

const MEMORY_REFLECT_PROMPT =
  `Before finishing, reconsider this run: was there a verified setup/build/test ` +
  `command, a repo convention, or an architectural decision worth remembering ` +
  `for future work on this repository? If so, call \`create_memory_candidate\` ` +
  `now — don't let the run end without it. If genuinely nothing durable came ` +
  `up, continue as you were.`;

function buildSystemPrompt(params: {
  taskTitle: string;
  taskDescription: string;
  taskType: (typeof BRANCH_TYPES)[number];
  repoInstructions: string;
  taskSource: string;
  identifiers: string;
  extraBlocks: string[];
  projectMemories?: MemoryCategoryEntryMap;
}): string {
  const {
    taskTitle,
    taskDescription,
    taskType,
    repoInstructions,
    taskSource,
    identifiers,
    extraBlocks,
    projectMemories,
  } = params;

  const blocks = [
    baseSystemPrompt(taskSource),
    `GitLab identifiers for this run — pass these verbatim on every GitLab tool call: ${identifiers}.`,
    WEB_RESEARCH_GUIDANCE,
    ...extraBlocks,
  ];

  if (repoInstructions) {
    blocks.push(
      [
        '<completion_instructions>',
        "The repository owner defined what counts as done here. Meet these before considering the task finished, alongside your own judgment — they don't replace it.",
        repoInstructions,
        '</completion_instructions>',
      ].join('\n'),
    );
  }

  if (projectMemories) {
    const categoriesWithMemories = MEMORY_CATEGORIES.filter(
      (category) => projectMemories[category].length,
    );

    if (categoriesWithMemories.length) {
      const sections = categoriesWithMemories.map((category) =>
        [
          `${category}:`,
          ...projectMemories[category].map(
            (entry) => `- ${entry.title}: ${entry.content}`,
          ),
        ].join('\n'),
      );

      blocks.push(
        [
          '<project_memories>',
          'Notes carried over from past work on this repository.',
          sections.join('\n\n'),
          '</project_memories>',
        ].join('\n'),
      );
    }
  }

  blocks.push(
    [
      '<task>',
      `${TASK_VERB[taskType]}: ${taskTitle}`,
      '',
      taskDescription,
      '</task>',
    ].join('\n'),
  );

  return blocks.join('\n\n');
}

type CompiledAgent = ReturnType<typeof createAgent>;

// Bounded by config.llms — no eviction needed.
const agentCache = new Map<string, CompiledAgent>();

function buildAgent(model: string): CompiledAgent {
  const modelConfig = llms.find((m) => m.model === model);

  if (!modelConfig) {
    throw new Error(`Unknown model: ${model}`);
  }

  const llm = buildChatModel(modelConfig, false);
  const messageTokenCache = new WeakMap<BaseMessage, number>();
  const middleware = [
    modelRetryMiddleware({ maxRetries: 3 }),
    toolOutputCapMiddleware(),
    dynamicSystemPromptMiddleware<SandboxAgentToolContext>(
      (_state, runtime) => runtime.context.systemPrompt,
    ),
    todoListMiddleware(),
    duplicateCallGuardMiddleware({
      readToolNames: new Set(tools.getReadNames()),
    }),
    extractProjectMemoryMiddleware({
      llm,
      provider: modelConfig.provider,
      curationGuidance: MEMORY_CURATION_GUIDANCE,
      phrasingGuidance: MEMORY_PHRASING_GUIDANCE,
      reflectPrompt: MEMORY_REFLECT_PROMPT,
    }),
    replyCriticMiddleware({ llm, provider: modelConfig.provider }),
    noteReplyTrackingMiddleware(),
    summarizeContextMiddleware({
      llm,
      modelConfig,
      fraction: 0.7,
      preserveLatestToolNames: ['write_todos'],
      messageTokenCache,
    }),
    noToolCallGuardMiddleware({
      message:
        "You're concluding without having called a single tool this run. If " +
        "you're recapping earlier work, that doesn't confirm the task is " +
        'actually done — check the current state of the repo (git status, ' +
        'test/build output) before deciding nothing further is needed.',
    }),
    trailingQuestionGuardMiddleware(),
    discussionCheckGuardMiddleware(),
    contextUsageMiddleware(modelConfig, messageTokenCache),
    llmBackendLimiterMiddleware(modelConfig),
  ];

  return createAgent({
    model: llm,
    tools: tools.getAll(),
    middleware,
    contextSchema: sandboxAgentToolContextSchema,
  });
}

function getAgent(model: string): CompiledAgent {
  let agent = agentCache.get(model);
  if (!agent) {
    agent = buildAgent(model);
    agentCache.set(model, agent);
  }
  return agent;
}

export const agent = {
  invoke: async function (
    messages: BaseMessage[],
    params: {
      taskTitle: string;
      taskDescription: string;
      taskType: (typeof BRANCH_TYPES)[number];
      repoInstructions: string;
      taskSource: string;
      identifiers: string;
      extraBlocks?: string[];
      model: string;
      sandbox: Sandbox;
      workingDirectory: string;
      worktreePath: string;
      projectId: string;
      issueIid: string | null;
      mrIid: string | null;
      threadId: string;
      workflow: SandboxAgentConfigurable['workflow'];
      recursionLimit: number;
      signal?: AbortSignal;
    },
    graphConfig: LangGraphRunnableConfig,
  ) {
    const {
      taskTitle,
      taskDescription,
      taskType,
      repoInstructions,
      taskSource,
      identifiers,
      extraBlocks,
      model,
      sandbox,
      workingDirectory,
      worktreePath,
      projectId,
      issueIid,
      mrIid,
      threadId,
      workflow,
      recursionLimit,
      signal,
    } = params;
    const sandboxAgent = getAgent(model);
    // Full title/description live in the system prompt's <task> block, re-sent on every model call — no need to repeat them here.
    const humanMessage = `${TASK_VERB[taskType]}. See the <task> block in your system prompt for the full task title and description.`;
    const userMessage = new HumanMessage(humanMessage);
    const updatedMessages = messages.length
      ? messages.concat(userMessage)
      : [userMessage];
    const systemPrompt = buildSystemPrompt({
      taskTitle,
      taskDescription,
      taskType,
      repoInstructions,
      taskSource,
      identifiers: [
        identifiers,
        ...(mrIid ? [`merge_request_iid ${mrIid}`] : []),
      ].join(', '),
      // Resuming on an MR is symmetric across both workflows, unlike the issue-specific pieces above
      extraBlocks: [
        ...(extraBlocks ?? []),
        ...(mrIid
          ? [
              `You're resuming on work that already has an open merge request — you may have been resumed because someone (or the review bot) left new feedback on it. Call \`${MR_DISCUSSIONS_TOOL}\` to read the current full thread before doing anything else. For anything you're not going to act on, call \`${CREATE_DISCUSSION_NOTE_TOOL}\` with that discussion's id to explain why instead of silently ignoring it — a reviewer waiting for a response with neither a fix nor a reply is the failure mode to avoid.`,
            ]
          : []),
      ],
      projectMemories: await memoriesService.listForProject(projectId),
    });
    emitAgentPromptEvent(graphConfig, {
      id: crypto.randomUUID(),
      systemPrompt,
      humanMessage,
    });
    const baseConfigurable = {
      sandbox,
      workingDirectory,
      worktreePath,
      projectId,
      mrIid,
      threadId,
      toolCallCounts: new Map(),
      toolErrorCounts: new Map(),
      toolCallMade: { called: false },
      memoryCandidates: [],
      memoryReflectNudged: { nudged: false },
      noToolCallNudged: { nudged: false },
      trailingQuestionNudged: { nudged: false },
      discussionCheckNudged: { nudged: false },
      postedReplyNoteIds: [],
    };
    // issueIid is only null when workflow is 'task-resolve' — the two agent_node callers guarantee the pairing.
    const configurable: SandboxAgentConfigurable =
      workflow === 'work-item-resolve'
        ? { ...baseConfigurable, workflow, issueIid: issueIid as string }
        : { ...baseConfigurable, workflow };
    const response = await sandboxAgent.invoke(
      { messages: updatedMessages },
      {
        recursionLimit,
        signal,
        configurable,
        context: { systemPrompt },
      },
    );

    return {
      messages: response.messages,
      replyNoteIds: configurable.postedReplyNoteIds,
    };
  },
};
