import {
  AIMessage,
  type BaseMessage,
  getBufferString,
  ToolMessage,
} from '@langchain/core/messages';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { createMiddleware } from 'langchain';

import type { ContextUsageBreakdown, LLM } from '#types.js';

import { emitContextUsageEvent } from '#components/workflows/emit.js';

import { config } from '#utils/config.js';
import { countTokens } from '#utils/tokenizer.js';

// Matches the tags buildSystemPrompt (mr-review/agent.ts) wraps these blocks in.
const REPO_INSTRUCTIONS_RE =
  /<repository_instructions>[\s\S]*?<\/repository_instructions>/;
const PROJECT_MEMORIES_RE = /<project_memories>[\s\S]*?<\/project_memories>/;

function systemMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) =>
      typeof part === 'object' && part && 'text' in part
        ? String((part as { text: unknown }).text)
        : '',
    )
    .join('');
}

function splitSystemPrompt(content: unknown): {
  base: string;
  repoInstructions: string;
  projectMemories: string;
} {
  const text = systemMessageText(content);
  const repoInstructions = text.match(REPO_INSTRUCTIONS_RE)?.[0] ?? '';
  const projectMemories = text.match(PROJECT_MEMORIES_RE)?.[0] ?? '';
  const base = text
    .replace(REPO_INSTRUCTIONS_RE, '')
    .replace(PROJECT_MEMORIES_RE, '');

  return { base, repoInstructions, projectMemories };
}

// load_skill's own ToolMessage output, split out since skill files can be large.
function partitionSkillMessages(messages: readonly BaseMessage[]): {
  skillMessages: BaseMessage[];
  restMessages: BaseMessage[];
} {
  const skillCallIds = new Set<string>();

  for (const message of messages) {
    if (!AIMessage.isInstance(message)) continue;
    for (const toolCall of message.tool_calls ?? []) {
      if (toolCall.name === 'load_skill' && toolCall.id) {
        skillCallIds.add(toolCall.id);
      }
    }
  }

  const skillMessages: BaseMessage[] = [];
  const restMessages: BaseMessage[] = [];

  for (const message of messages) {
    if (
      ToolMessage.isInstance(message) &&
      skillCallIds.has(message.tool_call_id)
    ) {
      skillMessages.push(message);
    } else {
      restMessages.push(message);
    }
  }

  return { skillMessages, restMessages };
}

// Approximates the wire format — exact provider bytes aren't observable here.
function toolText(tool: unknown): string {
  if (typeof tool !== 'object' || !tool) return '';

  const {
    name = '',
    description = '',
    schema,
  } = tool as {
    name?: string;
    description?: string;
    schema?: unknown;
  };
  let schemaText = '';

  if (schema) {
    try {
      schemaText = JSON.stringify(toJsonSchema(schema as never));
    } catch {
      // Not every tool exposes a convertible schema (e.g. server-side tools) — skip it rather than guessing.
    }
  }

  return `${name}\n${description}\n${schemaText}`;
}

// wrapModelCall fires once per actual model turn — including every internal
// turn inside a single agent.invoke()'s tool-calling loop — and hands back
// the resolved AIMessage directly. This is the only reliable source: Ollama's
// final usage-only chunk never triggers the streaming callback, so
// usage_metadata is always undefined on message-stream events, but it is
// always present here.
export function contextUsageMiddleware(
  modelConfig: LLM,
  // Constructor arg to match summarizeContextMiddleware's own — its countTokens is also handed to langchain's tokenCounter, which never receives runtime, so it can't come from configurable. Shared so messages aren't tokenized twice.
  messageTokenCache: WeakMap<BaseMessage, number> = new WeakMap(),
) {
  // Tool list is stable per run — cache avoids re-tokenizing schemas every turn.
  const toolTokenCache = new WeakMap<object, number>();

  async function sumTokens(
    tokenizerRepo: string,
    messages: readonly BaseMessage[],
  ): Promise<number> {
    let total = 0;

    for (const message of messages) {
      let count = messageTokenCache.get(message);

      if (count === undefined) {
        count = await countTokens(tokenizerRepo, getBufferString([message]));
        messageTokenCache.set(message, count);
      }

      total += count;
    }

    return total;
  }

  async function sumToolTokens(
    tokenizerRepo: string,
    tools: readonly unknown[],
  ): Promise<number> {
    let total = 0;

    for (const tool of tools) {
      if (typeof tool !== 'object' || !tool) continue;

      let count = toolTokenCache.get(tool);

      if (count === undefined) {
        count = await countTokens(tokenizerRepo, toolText(tool));
        toolTokenCache.set(tool, count);
      }

      total += count;
    }

    return total;
  }

  return createMiddleware({
    name: 'ContextUsage',
    wrapModelCall: async (request, handler) => {
      const response = await handler(request);
      const usage = response.usage_metadata;

      if (!usage) return response;

      let breakdown: ContextUsageBreakdown | undefined;
      const { tokenizerRepo } = modelConfig;

      if (tokenizerRepo) {
        const { base, repoInstructions, projectMemories } = splitSystemPrompt(
          request.systemMessage.content,
        );
        const { skillMessages, restMessages } = partitionSkillMessages(
          request.messages,
        );

        const [
          systemPromptTokens,
          repoInstructionsTokens,
          projectMemoriesTokens,
          toolSchemasTokens,
          skillContentTokens,
          messagesTokens,
        ] = await Promise.all([
          countTokens(tokenizerRepo, base),
          countTokens(tokenizerRepo, repoInstructions),
          countTokens(tokenizerRepo, projectMemories),
          sumToolTokens(tokenizerRepo, request.tools),
          sumTokens(tokenizerRepo, skillMessages),
          sumTokens(tokenizerRepo, restMessages),
        ]);

        const autocompactBuffer = Math.round(
          modelConfig.contextWindow * config.summarization.triggerSafetyBuffer,
        );
        const freeSpace = Math.max(
          0,
          modelConfig.contextWindow - usage.total_tokens - autocompactBuffer,
        );

        breakdown = {
          systemPrompt: systemPromptTokens,
          repoInstructions: repoInstructionsTokens,
          projectMemories: projectMemoriesTokens,
          toolSchemas: toolSchemasTokens,
          skillContent: skillContentTokens,
          messages: messagesTokens,
          autocompactBuffer,
          freeSpace,
        };
      }

      emitContextUsageEvent(request.runtime, {
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens,
        totalTokens: usage.total_tokens,
        breakdown,
        subagentId: (
          request.runtime as { configurable?: { subagentId?: string } }
        ).configurable?.subagentId,
      });

      return response;
    },
  });
}
