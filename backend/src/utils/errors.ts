export class AppError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'AppError';
  }

  toResponse() {
    return Response.json({ message: this.message }, { status: this.status });
  }
}

// deliberate workflow abort
export class RunAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunAbortedError';
  }
}

export const errors = {
  threads: {
    notFound: () => new AppError(404, 'Thread not found'),
    forbidden: () => new AppError(403, 'Thread belongs to another session'),
    archived: () =>
      new AppError(409, 'Thread is archived and is now read-only'),
  },
  chat: {
    missingOpenRouterKey: () =>
      new AppError(400, 'No OpenRouter API key saved — add one in Settings'),
    missingGitlabToken: () =>
      new AppError(400, 'GitLab tools enabled but no linked GitLab token'),
    unsupportedProvider: (model: string) =>
      new AppError(400, `Chat supports OpenRouter models only, got: ${model}`),
  },
  taskResolve: {
    invalidRepo: (detail: string) => new AppError(400, detail),
  },
  schedules: {
    notFound: () => new AppError(404, 'Schedule not found'),
    notActive: () => new AppError(409, 'Schedule is not active'),
    notPaused: () => new AppError(409, 'Schedule is not paused'),
    cancelled: () => new AppError(409, 'Schedule is cancelled'),
  },
  runs: {
    notFound: () => new AppError(404, 'Run not found'),
    notActive: () => new AppError(409, 'Run is not currently active'),
    alreadyRunning: () =>
      new AppError(409, 'This thread already has a run in progress'),
    unknownModel: (model: string) =>
      new AppError(400, `Unknown model: ${model}`),
    forbidden: () => new AppError(403, 'Forbidden'),
    notInterrupted: () =>
      new AppError(409, 'Run is not paused awaiting a decision'),
    notImmediate: () =>
      new AppError(405, "This thread's workflow doesn't start runs this way"),
  },
  workflows: {
    notFound: () => new AppError(404, 'Workflow not found'),
  },
  monitoring: {
    forbidden: () => new AppError(403, 'Forbidden'),
    unavailable: () => new AppError(502, 'Monitoring service unavailable'),
  },
  memories: {
    notFound: () => new AppError(404, 'Memory not found'),
    invalidQuery: () =>
      new AppError(400, 'Provide either projectId or scope=personal'),
  },
  uploads: {
    notFound: () => new AppError(404, 'File not found'),
    invalidRef: () => new AppError(400, 'Invalid file reference'),
    missingFile: () => new AppError(400, 'No file in request'),
    tooLarge: () => new AppError(413, 'File too large'),
    unsupportedType: (mime: string) =>
      new AppError(400, `Unsupported file type: ${mime}`),
  },
};
