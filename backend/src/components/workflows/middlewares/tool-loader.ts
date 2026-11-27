import { ToolMessage } from '@langchain/core/messages';
import { type DynamicStructuredTool, tool } from '@langchain/core/tools';
import {
  Command,
  isGraphInterrupt,
  ReducedValue,
  StateSchema,
} from '@langchain/langgraph';
import { createMiddleware, type ToolCallRequest } from 'langchain';
import { z } from 'zod';

import {
  emitToolInputEvent,
  emitToolOutputEvent,
} from '#components/workflows/emit.js';

import { createBm25Index, parseQuery } from '#utils/bm25.js';

const LOAD_TOOLS = 'load_tools';
const KEYWORD_MATCHES = 5;

const firstSentence = (text: string) =>
  text.split(/(?<=\.)\s/)[0].slice(0, 160);

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

const isNameLike = (item: string) =>
  /^[\w-]+$/.test(item) && item.includes('_');

// Any wrapToolCall turns a thrown tool error fatal for the whole run (langchain only feeds it back when no middleware wraps tool calls), so restore that here.
async function runCatching<R extends ToolCallRequest>(
  request: R,
  handler: (
    request: R,
  ) => Promise<ToolMessage | Command> | ToolMessage | Command,
) {
  try {
    return await handler(request);
  } catch (err) {
    if (isGraphInterrupt(err) || request.runtime.signal?.aborted) throw err;
    return new ToolMessage({
      content: `${String(err)}\n Please fix your mistakes.`,
      tool_call_id: request.toolCall.id ?? '',
      name: request.toolCall.name,
      status: 'error',
    });
  }
}

const stateSchema = new StateSchema({
  loadedTools: new ReducedValue(z.array(z.string()).default([]), {
    reducer: (current, next) => [...new Set([...current, ...next])],
  }),
});

/**
 * Binds `tools` lazily: the model sees only their names until it loads them with load_tools.
 * They must not also be passed to createAgent, or they'd be bound from the start.
 */
export function toolLoaderMiddleware(tools: DynamicStructuredTool[]) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  // Only the first sentence of a description — the rest is boilerplate shared by every MCP tool.
  const search = createBm25Index(tools, (t) => ({
    title: t.name,
    body: firstSentence(t.description),
  }));

  const loadTools = tool(
    ({ query }, runtime) => {
      const items = parseQuery(query);

      if (!items.length) {
        throw new Error(
          `${LOAD_TOOLS} needs tool names or keywords as one comma-separated string, e.g. "gitlab__get_merge_request, gitlab__list_pipelines" or "pipeline job logs".`,
        );
      }

      const loaded = new Map<string, DynamicStructuredTool>();
      const problems: string[] = [];

      for (const item of items) {
        // Models often drop the provider prefix; only safe when exactly one tool has that suffix.
        const bySuffix = tools.filter((t) => t.name.endsWith(`__${item}`));
        const exact =
          byName.get(item) ?? (bySuffix.length === 1 ? bySuffix[0] : undefined);
        if (exact) {
          loaded.set(exact.name, exact);
          continue;
        }

        if (isNameLike(item)) {
          // A wrong guess at a specific name could load a similar write tool, so suggest instead of loading.
          const closest = tools
            .map((t) => ({
              name: t.name,
              distance: editDistance(item, t.name),
            }))
            .sort((x, y) => x.distance - y.distance)
            .slice(0, KEYWORD_MATCHES)
            .map((t) => t.name);
          problems.push(
            `"${item}" isn't a tool name. Closest: ${closest.join(', ')}.`,
          );
          continue;
        }

        const matches = search(item, KEYWORD_MATCHES);
        if (!matches.length) problems.push(`Nothing matched "${item}".`);
        for (const match of matches) loaded.set(match.name, match);
      }

      const lines = [...loaded.values()].map(
        (t) => `- ${t.name}: ${firstSentence(t.description)}`,
      );
      const content = [
        lines.length && `Loaded:\n${lines.join('\n')}`,
        problems.length &&
          `${problems.join('\n')}\nRetry ${LOAD_TOOLS} with exact names from the list, or different keywords.`,
      ]
        .filter(Boolean)
        .join('\n\n');

      // Thrown, not returned, so the timeline marks it failed like any other tool error.
      if (!loaded.size) throw new Error(content);

      return new Command({
        update: {
          loadedTools: [...loaded.keys()],
          messages: [
            new ToolMessage({
              content,
              tool_call_id: runtime.toolCall?.id ?? '',
              name: LOAD_TOOLS,
            }),
          ],
        },
      });
    },
    {
      name: LOAD_TOOLS,
      description:
        'Load deferred tools so you can call them. Pass exact tool names and/or keywords describing what you need, as one comma-separated string. Loaded tools stay available for the rest of the conversation.',
      schema: z.object({
        // Optional and array-tolerant so a malformed call reaches the friendly error above instead of a schema failure.
        query: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            'Comma-separated tool names or keywords, e.g. "gitlab__get_merge_request, pipeline job logs"',
          ),
      }),
    },
  );

  const namesPrompt =
    `\n\nThese tools exist but are not loaded yet. Call ${LOAD_TOOLS} with their names or keywords before using them:\n` +
    tools.map((t) => t.name).join(', ');

  return createMiddleware({
    name: 'ToolLoader',
    stateSchema,
    tools: tools.length ? [loadTools] : [],
    wrapModelCall: (request, handler) => {
      if (!tools.length) return handler(request);
      const loaded = request.state.loadedTools.flatMap(
        (name) => byName.get(name) ?? [],
      );
      return handler({
        ...request,
        systemMessage: request.systemMessage.concat(namesPrompt),
        tools: [...request.tools, ...loaded],
      });
    },
    wrapToolCall: async (request, handler) => {
      const deferred = byName.get(request.toolCall.name);
      if (request.tool || !deferred) return runCatching(request, handler);

      // Strict like Claude Code's deferred tools: its args were guessed without the schema, so refuse rather than run or implicitly load it.
      if (!request.state.loadedTools.includes(deferred.name)) {
        const id = request.toolCall.id ?? '';
        const message = `${deferred.name} isn't loaded, so it can't be called. Call ${LOAD_TOOLS} with "${deferred.name}" first, then call it.`;
        emitToolInputEvent(request.runtime, {
          id,
          name: deferred.name,
          input: request.toolCall.args ?? {},
        });
        // Same {error} shape the stream translator emits for a thrown tool error, which the timeline renders as failed.
        emitToolOutputEvent(request.runtime, {
          id,
          output: JSON.stringify({ error: message }),
        });
        return new ToolMessage({
          content: `Error: ${message}`,
          tool_call_id: id,
          name: deferred.name,
          status: 'error',
        });
      }

      return runCatching({ ...request, tool: deferred }, handler);
    },
  });
}
