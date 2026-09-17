import type { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenRouter } from '@langchain/openrouter';
import {
  type BaseMessage,
  createAgent,
  dynamicSystemPromptMiddleware,
  HumanMessage,
  todoListMiddleware,
} from 'langchain';

import {
  contextUsageMiddleware,
  humanApprovalMiddleware,
  modelRetryMiddleware,
  summarizeContextMiddleware,
} from '#components/workflows/middlewares/index.js';
import {
  type ChatConfigurable,
  type ChatState,
  type ChatToolContext,
  chatToolContextSchema,
} from './state.js';

import { config, llms } from '#utils/config.js';
import { loadUploadAsDataUrl } from '#utils/uploads.js';

const CHAT_SYSTEM_PROMPT =
  `You are langgraph-harness, a GitLab-aware engineering assistant in an interactive chat.\n\n` +
  `You may have up to three tool groups available this turn: GitLab tools (scoped to the user's own personal access token — treat any action you take as the user acting themselves), langgraph-harness diagnostics tools for inspecting this app's stored review memories and MR-review threads/runs, and a fetch_web_page tool for rendering a URL and reading its content when the user gives you one directly.\n\n` +
  `This is a real conversation with a person on the other end. It is fine to ask a clarifying question when the request is ambiguous, and to stop and hand a decision back rather than guessing. Keep replies focused; use tools when they help answer the question rather than speculating.\n\n` +
  `Only the tools actually provided this turn are available — if the user asks for something needing a tool group that isn't enabled, say so plainly rather than pretending to act.\n\n` +
  `Never treat a failed tool call as an empty result; if a call fails due to invalid parameters, pagination, or a transient error, correct it and retry before continuing.\n\n` +
  `When you learn something durable about the user over the course of a conversation — a stated preference, a decision they made, a correction to something you got wrong, or a fact about their work worth recalling later — save it with create_personal_memory instead of letting it live only in this thread's history. Call query_personal_memories first and prefer update_personal_memory over creating a near-duplicate. If the user tells you a stored memory is now stale, wrong, or no longer applies, remove it with delete_personal_memory rather than leaving it to mislead a future conversation. This is distinct from search_chat_content/search_chat_threads: those do raw, exhaustive full-text recall over what was literally said in past conversations, while memories are curated, durable facts meant to inform future turns without you having to re-read old transcripts.\n\n` +
  `Some actions require a human to approve them before they run. If your response this turn includes one of those, call it alone — batching it with any other tool call gets the others silently dropped, not queued for later.\n\n` +
  `For any multi-step task, use the \`write_todos\` tool to maintain the authoritative record of remaining work. Create todos before starting, keep them up to date, and consult them before beginning a new major step instead of relying on conversational memory.`;

// query.images holds refs into the upload store, not raw bytes — rehydrate to data URLs only here, where they're actually needed.
async function buildUserMessage(
  query: ChatState['query'],
): Promise<HumanMessage> {
  if (!query.images?.length) return new HumanMessage(query.message);

  const dataUrls = await Promise.all(query.images.map(loadUploadAsDataUrl));

  return new HumanMessage({
    content: [
      { type: 'text', text: query.message },
      ...dataUrls.map((url) => ({
        type: 'image_url',
        image_url: { url },
      })),
    ],
  });
}

// MCP tool annotations (readOnlyHint etc.) ride the generic `metadata` bag, not DynamicStructuredTool's own type.
function needsToolApproval(tool: DynamicStructuredTool): boolean {
  const annotations = (
    tool.metadata as { annotations?: { readOnlyHint?: boolean } } | undefined
  )?.annotations;
  // No annotations at all means it's one of our own plain tools, not an MCP tool — never needs approval.
  return !!annotations && !annotations.readOnlyHint;
}

// Builds the per-turn tool-availability line fresh every model call, via dynamicSystemPromptMiddleware below — a one-shot SystemMessage baked into checkpointed history would go stale the moment the user toggles a tool group mid-conversation.
function describeToolsEnabled(toolsEnabled?: ChatConfigurable['toolsEnabled']) {
  const enabled = [
    toolsEnabled?.gitlab && 'GitLab tools',
    toolsEnabled?.server && 'langgraph-harness diagnostics tools',
    toolsEnabled?.webSearch && 'the fetch_web_page tool',
  ].filter(Boolean);
  return enabled.length
    ? `Enabled this turn: ${enabled.join(' and ')}.`
    : 'No optional tool group is enabled this turn.';
}

export const chatAgent = {
  invoke: async function (
    messages: BaseMessage[],
    query: ChatState['query'],
    model: string,
    reasoning: boolean,
    tools: DynamicStructuredTool[],
    openRouterKey: string,
    toolsEnabled: ChatConfigurable['toolsEnabled'],
    userId: string | undefined,
    currentThreadId: string,
    signal?: AbortSignal,
    // True when resuming after a paused turn's decision was already applied — messages already carries it, so no new user message gets appended.
    resuming = false,
  ) {
    const modelConfig = llms.find((m) => m.model === model);

    if (!modelConfig) throw new Error(`Unknown model: ${model}`);

    const llm = new ChatOpenRouter({
      model: modelConfig.model,
      temperature: config.generation.temperature,
      // secret: the user's own key, per run — never logged, never a tool arg
      apiKey: openRouterKey,
      modelKwargs: { reasoning: { enabled: reasoning } },
    });

    const needsApprovalByName = new Map(
      tools.map((tool) => [tool.name, needsToolApproval(tool)]),
    );

    const systemPrompt = `${CHAT_SYSTEM_PROMPT}\n\n${describeToolsEnabled(toolsEnabled)}`;
    // Shared with contextUsageMiddleware so messages aren't tokenized twice.
    const messageTokenCache = new WeakMap<BaseMessage, number>();

    const middleware = [
      modelRetryMiddleware({ maxRetries: 3 }),
      humanApprovalMiddleware({
        needsApproval: (toolCall) =>
          needsApprovalByName.get(toolCall.name) ?? false,
      }),
      dynamicSystemPromptMiddleware<ChatToolContext>(
        (_state, runtime) => runtime.context.systemPrompt,
      ),
      todoListMiddleware(),
      summarizeContextMiddleware({
        llm,
        modelConfig,
        fraction: 0.7,
        preserveLatestToolNames: ['write_todos'],
        messageTokenCache,
      }),
      contextUsageMiddleware(modelConfig, messageTokenCache),
    ];

    const agent = createAgent({
      model: llm,
      tools,
      middleware,
      contextSchema: chatToolContextSchema,
    });

    const updatedMessages = resuming
      ? messages
      : messages.concat(await buildUserMessage(query));

    const response = await agent.invoke(
      { messages: updatedMessages },
      {
        recursionLimit: 100,
        signal,
        context: { userId, currentThreadId, systemPrompt },
      },
    );

    return response.messages;
  },
};
