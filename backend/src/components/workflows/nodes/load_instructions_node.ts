import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import {
  HarnessConfigStatus,
  InstructionStatus,
  type ParsedHarnessConfig,
  WorkflowNode,
} from '#types.js';

import { emitNodeLifecycleEvents } from '#components/workflows/emit.js';

import { config as appConfig } from '#utils/config.js';
import { logger } from '#utils/logger.js';

export type InstructionDoc = { path: string; match?: string[] };

type LoadInstructionsState = {
  noteId?: number;
  config: {
    status: ParsedHarnessConfig['status'];
    parsed: ParsedHarnessConfig['parsed'];
    instructions: { status: InstructionStatus; content: string };
  };
};

export function createLoadInstructionsNode<
  TState extends LoadInstructionsState,
>(options: {
  getDocs: (
    parsed: NonNullable<ParsedHarnessConfig['parsed']>,
  ) => InstructionDoc[];
  resolveContent: (
    docs: InstructionDoc[],
    state: TState,
    config: LangGraphRunnableConfig,
  ) => Promise<{
    content: string;
    status:
      | typeof InstructionStatus.LoadedAll
      | typeof InstructionStatus.LoadedFiltered;
    error?: string;
  }>;
  // task-resolve workflow doesn't have an associated work-item to notify about instruction status
  postNote?: (
    state: TState,
    config: LangGraphRunnableConfig,
    status: InstructionStatus,
  ) => Promise<void>;
}): (
  state: TState,
  config: LangGraphRunnableConfig,
) => Promise<{ config: TState['config'] }> {
  return async (state, config) => {
    const { noteId, config: workflowConfig } = state;
    const { status: repoConfigStatus, parsed: repoConfig } = workflowConfig;

    emitNodeLifecycleEvents(config, {
      event: 'node_start',
      data: { node: WorkflowNode.LoadInstructions },
    });

    let content = '';
    // Surfaced via the node_end payload instead of logged — the run timeline is
    // the primary place this is debugged from.
    let error = '';
    // Set by every branch below. Loading is only the transient pre-load state
    // that the notify-start node writes; this node always resolves to a
    // terminal status.
    let instructionStatus: InstructionStatus;
    const docs = repoConfig ? options.getDocs(repoConfig) : [];

    if (repoConfigStatus === HarnessConfigStatus.Invalid) {
      // Config existed but couldn't be parsed/validated (logged already where it was fetched).
      instructionStatus = InstructionStatus.Failed;
    } else if (!docs.length) {
      // No config, or config present but no instruction docs — nothing to attach.
      instructionStatus = InstructionStatus.Missing;
    } else {
      try {
        const resolved = await options.resolveContent(docs, state, config);
        content = resolved.content;
        instructionStatus = resolved.status;
        error = resolved.error ?? '';
      } catch (err) {
        // Fetching an instruction doc failed — continue the run without them.
        error = err instanceof Error ? err.message : String(err);
        instructionStatus = InstructionStatus.Failed;
      }
    }

    // Reuse the note opened by the workflow's own notify-start node to surface instruction status.
    if (!appConfig.mock.workflow && noteId && options.postNote) {
      await options
        .postNote(state, config, instructionStatus)
        .catch((err) =>
          logger.error(
            { err, noteId },
            'Failed to update note with instruction status',
          ),
        );
    }

    const resolvedConfig = {
      ...workflowConfig,
      instructions: { status: instructionStatus, content },
    };

    emitNodeLifecycleEvents(config, {
      event: 'node_end',
      data: {
        node: WorkflowNode.LoadInstructions,
        payload: {
          status: resolvedConfig.status,
          parsed: resolvedConfig.parsed,
          instructions: resolvedConfig.instructions,
          error,
        },
      },
    });

    return { config: resolvedConfig };
  };
}
