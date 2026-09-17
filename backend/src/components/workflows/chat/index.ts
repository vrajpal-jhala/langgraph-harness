import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { END, START, StateGraph } from '@langchain/langgraph';
import { type Static } from 'elysia';

import {
  type ChatRunInput,
  LLMProvider,
  type ResumePayload,
  type RunContext,
  type RunEvent,
  RunKind,
  type Workflow,
} from '#types.js';

import { runsDal } from '#components/runs/dal.js';
import { threadsDal } from '#components/threads/dal.js';
import { threadsService } from '#components/threads/service.js';
import { translateRunStream } from '#components/workflows/stream-translator.js';
import { chatAgentNode } from './nodes/agent_node.js';
import { chatState } from './state.js';
import { buildChatTools, chatMcpServer } from './tools.js';
import { type sendChatMessageSchema } from './validation.js';

import { config, llms } from '#utils/config.js';
import { checkpointer } from '#utils/db.js';
import { errors } from '#utils/errors.js';
import { createLoop } from '#utils/loop.js';
import {
  deleteUpload,
  listUploadFilenames,
  UPLOAD_FILENAME_RE,
} from '#utils/uploads.js';

const CHAT_WORKFLOW_NAME = 'Chat';
const CHAT_WORKFLOW_DESCRIPTION =
  'Interactive GitLab-aware assistant with server-data diagnostics.';

const KNOWN_LC_SOURCES = new Set(['summarization']);

async function buildChatWorkflow() {
  return new StateGraph(chatState)
    .addNode('agent', chatAgentNode)
    .addEdge(START, 'agent')
    .addEdge('agent', END)
    .compile({
      name: CHAT_WORKFLOW_NAME,
      description: CHAT_WORKFLOW_DESCRIPTION,
      checkpointer,
    });
}

type CompiledChat = Awaited<ReturnType<typeof buildChatWorkflow>>;

let compiledChat: CompiledChat | null = null;

// Plain checkpoint replay can't resume a paused run (no self-loop back into 'agent'), so we fork the latest checkpoint with the tool result injected and asNode: '__start__' to re-enter 'agent' with it appended.
async function* resumeWithDecision(
  threadId: string,
  runId: string,
  decision: ResumePayload,
  tools: DynamicStructuredTool[],
  secrets: { gitlabToken?: string; openRouterKey: string; userId?: string },
  signal?: AbortSignal,
): AsyncGenerator<RunEvent> {
  if (!compiledChat) throw new Error('Chat workflow not initialized');

  const latest = await compiledChat.getState({
    configurable: { thread_id: threadId },
  });
  const lastAiMessage = [...latest.values.messages]
    .reverse()
    .find((m): m is AIMessage => AIMessage.isInstance(m));
  const toolCall = lastAiMessage?.tool_calls?.find(
    (tc) => tc.id === decision.toolCallId,
  );
  if (!toolCall?.id) {
    throw new Error(`No pending tool call ${decision.toolCallId} to resolve`);
  }

  yield {
    event: 'tool_input',
    data: {
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.args,
      timestamp: Date.now(),
    },
  };

  let toolMessage: ToolMessage;
  if (decision.decision === 'approve') {
    const tool = tools.find((t) => t.name === toolCall.name);
    if (!tool) throw new Error(`Unknown tool: ${toolCall.name}`);
    try {
      toolMessage = await tool.invoke({
        type: 'tool_call',
        name: toolCall.name,
        args: toolCall.args,
        id: toolCall.id,
      });
    } catch (err) {
      toolMessage = new ToolMessage({
        status: 'error',
        content: err instanceof Error ? err.message : String(err),
        tool_call_id: toolCall.id,
      });
    }
  } else {
    toolMessage = new ToolMessage({
      content: JSON.stringify({
        error:
          "The user declined this action. This is a user decision, not an error — do not retry this action or speculate about technical causes; acknowledge the user's choice.",
      }),
      tool_call_id: toolCall.id,
    });
  }

  yield {
    event: 'tool_output',
    data: {
      id: toolCall.id,
      output:
        typeof toolMessage.content === 'string'
          ? toolMessage.content
          : JSON.stringify(toolMessage.content),
      timestamp: Date.now(),
    },
  };

  const forkConfig = await compiledChat.updateState(
    latest.config,
    { messages: [toolMessage] },
    '__start__',
  );

  const raw = await compiledChat.stream(null, {
    ...forkConfig,
    configurable: {
      ...forkConfig.configurable,
      run_id: runId,
      chatTools: tools,
      openRouterKey: secrets.openRouterKey,
      userId: secrets.userId,
      currentThreadId: threadId,
      resuming: true,
    },
    streamMode: ['messages', 'tools', 'custom', 'checkpoints'],
    signal,
  });

  yield* translateRunStream(raw, KNOWN_LC_SOURCES);
}

// Archives, not deletes
async function sweepStaleThreads() {
  const staleIds = await threadsDal.findStaleThreadIds(
    RunKind.Chat,
    config.chat.retentionMs,
  );
  await threadsService.sweepStale(staleIds, 'chat-cleanup');
}

// One "is it referenced" check covers both an orphaned failed-upload and an upload freed by the thread sweep above, which is why this runs after it.
async function sweepUnreferencedUploads() {
  const filenames = await listUploadFilenames();
  for (const filename of filenames) {
    if (!UPLOAD_FILENAME_RE.test(filename)) {
      await deleteUpload(filename); // stray temp file from an interrupted write
      continue;
    }
    const referenced = await runsDal.isUploadReferenced(
      `/api/uploads/${filename}`,
    );
    if (!referenced) await deleteUpload(filename);
  }
}

const cleanupLoop = createLoop(async () => {
  await sweepStaleThreads();
  await sweepUnreferencedUploads();
}, config.chat.cleanupIntervalMs);

export const chatWorkflow: Workflow<
  ChatRunInput,
  { gitlabToken?: string; openRouterKey: string; userId?: string }
> = {
  id: 'chat',
  kind: RunKind.Chat,
  name: CHAT_WORKFLOW_NAME,
  description: CHAT_WORKFLOW_DESCRIPTION,
  checkAccess: (thread, session) => {
    if (thread.user_id !== session.id) throw errors.threads.forbidden();
  },
  validateInput: (input, secrets) => {
    if (!secrets.openRouterKey) throw errors.chat.missingOpenRouterKey();
    if (input.tools.gitlab && !secrets.gitlabToken) {
      throw errors.chat.missingGitlabToken();
    }
  },
  startMode: 'immediate',
  interruptible: true,
  buildInput: async (threadId, body) => {
    const { message, images, model, reasoning, tools } = body as Static<
      typeof sendChatMessageSchema
    >;

    // Two concurrent runs on the same thread would race on the same checkpointer thread_id.
    if (await runsDal.hasActive(threadId)) throw errors.runs.alreadyRunning();

    const modelConfig = llms.find((m) => m.model === model);
    if (!modelConfig || modelConfig.provider !== LLMProvider.OpenRouter) {
      throw errors.chat.unsupportedProvider(model);
    }

    // Only rename the default 'New chat' title on the thread's first message.
    const isFirstMessage = (await runsDal.getByThread(threadId)).length === 0;
    if (isFirstMessage) {
      const TITLE_MAX_LENGTH = 60;
      // Collapsed so a multi-line/pasted message doesn't leave literal newlines in the title.
      const collapsed = message.replace(/\s+/g, ' ').trim();
      // Ellipsis marks truncation but isn't counted toward the cap, so length never exceeds TITLE_MAX_LENGTH + 1.
      const title =
        collapsed.length > TITLE_MAX_LENGTH
          ? `${collapsed.slice(0, TITLE_MAX_LENGTH).trimEnd()}...`
          : collapsed;
      await threadsDal.update(threadId, { title });
    }

    // Storing refs, not raw bytes, means a retry/resume, which copies this input verbatim, references the same file instead of duplicating it.
    return {
      kind: RunKind.Chat,
      query: { message, images },
      model,
      reasoning: reasoning ?? false,
      tools,
    };
  },
  init: async () => {
    compiledChat = await buildChatWorkflow();
    await chatMcpServer.start();
    cleanupLoop.start();
  },
  cleanup: () => {
    cleanupLoop.stop();
    chatMcpServer.stop();
  },
  getGraphMermaid: async () => {
    if (!compiledChat) throw new Error('Chat workflow not initialized');
    const graph = await compiledChat.getGraphAsync();
    return graph.drawMermaid();
  },
  stream: async function* (
    input: ChatRunInput,
    ctx: RunContext,
    secrets: { gitlabToken?: string; openRouterKey: string; userId?: string },
  ): AsyncGenerator<RunEvent> {
    if (!compiledChat) throw new Error('Chat workflow not initialized');

    const { query, model, reasoning, tools: toolsEnabled } = input;
    const { id: threadId, runId, signal } = ctx;

    const { tools, close } = await buildChatTools({
      server: toolsEnabled.server,
      gitlab: toolsEnabled.gitlab,
      webSearch: toolsEnabled.webSearch,
      gitlabToken: secrets.gitlabToken,
    });

    try {
      if (ctx.mode === 'resume') {
        yield* resumeWithDecision(
          threadId,
          runId,
          ctx.decision,
          tools,
          secrets,
          signal,
        );
        return;
      }

      const fromCheckpointId =
        ctx.mode === 'retry' ? ctx.fromCheckpointId : undefined;

      const raw = await compiledChat.stream(
        // null resumes from the checkpoint instead of starting fresh state.
        fromCheckpointId ? null : { query, model, reasoning, messages: [] },
        {
          configurable: {
            thread_id: threadId,
            run_id: runId,
            // Secrets + tools ride the runtime config, never the checkpointed state.
            chatTools: tools,
            openRouterKey: secrets.openRouterKey,
            userId: secrets.userId,
            toolsEnabled,
            currentThreadId: threadId,
            ...(fromCheckpointId && { checkpoint_id: fromCheckpointId }),
          },
          streamMode: ['messages', 'tools', 'custom', 'checkpoints'],
          signal,
        },
      );

      yield* translateRunStream(raw, KNOWN_LC_SOURCES);
    } finally {
      await close();
    }
  },
};
