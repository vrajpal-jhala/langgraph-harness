import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  CloseButton,
  Divider,
  Drawer,
  Group,
  Image,
  Paper,
  Popover,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Switch,
  Textarea,
  Title,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import {
  IconArrowLeft,
  IconLayoutSidebarRightExpand,
  IconPaperclip,
  IconPlayerStop,
  IconPlus,
  IconSend,
} from '@tabler/icons-react';

import type { Run } from '@/types';

import Icon from '@/components/icon';
import ImageLightbox from '@/components/image-lightbox';
import RunTimeline from '@/components/run/run-timeline';
import StatSummary from '@/components/stat-summary';
import TourReplayButton from '@/components/tour-replay-button';
import QueryList from './components/query-list';

import { api, ws } from '@/api';
import { config } from '@/config';
import { Context } from '@/contexts';
import { useRunStream } from '@/hooks/useRunStream';
import { useStickToBottom } from '@/hooks/useStickToBottom';
import { CHAT_TOUR_ID, chatSteps } from '@/tours/steps';
import { hasSeenTour, useTour } from '@/tours/tourState';
import {
  getContextMeter,
  isChatRunInput,
  resolveUploadUrl,
  safeJsonParse,
} from '@/utils';

const MAX_MESSAGE_LENGTH = 20_000;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 6_000_000;

type ModelInfo = NonNullable<
  Awaited<ReturnType<typeof api.models.get>>['data']
>[number];
type ModelName = ModelInfo['model'];

// Chat has no branch picker, so a retry must replace the stale continuation, not append beside it: walk back from the newest run, truncating each retried ancestor at its fork checkpoint and dropping sibling branches — parent_checkpoint_id null just means "continues from the previous run", not "is the thread root".
function buildLinearRuns(runs: Run[]): Run[] {
  if (!runs.length) return runs;

  const checkpointLocation = new Map<
    string,
    { index: number; eventIndex: number }
  >();
  runs.forEach((run, index) => {
    run.events.forEach((event, eventIndex) => {
      // Skip re-emitted fork checkpoints
      if (
        event.event === 'checkpoint' &&
        event.data.id !== run.parent_checkpoint_id
      ) {
        checkpointLocation.set(event.data.id, { index, eventIndex });
      }
    });
  });

  const chain: Run[] = [];
  let index = runs.length - 1;
  // Exclusive upper bound on runs[index]'s events, set once we know which checkpoint the next-newer run forked from.
  let truncateAt: number | null = null;

  while (index >= 0) {
    const run = runs[index];
    let events =
      truncateAt === null ? run.events : run.events.slice(0, truncateAt);

    if (run.parent_checkpoint_id) {
      // Resuming re-emits the fork checkpoint as this run's own first checkpoint event — drop it so "Retry from here" doesn't render twice.
      const forkedFrom = run.parent_checkpoint_id;
      events = events.filter(
        (e) => !(e.event === 'checkpoint' && e.data.id === forkedFrom),
      );
    }

    chain.unshift({ ...run, events });

    if (run.parent_checkpoint_id) {
      const location = checkpointLocation.get(run.parent_checkpoint_id);
      if (!location || location.index >= index) break;
      index = location.index;
      // Exclude the fork checkpoint itself — it already has a continuation, so its own "Retry from here" would be redundant.
      truncateAt = location.eventIndex;
    } else {
      index -= 1;
      truncateAt = null;
    }
  }

  return chain;
}

const ChatPage = () => {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const { handleError } = use(Context);
  const { startTour, registerPageDrawer } = useTour();
  const theme = useMantineTheme();
  const isTablet =
    useMediaQuery(`(max-width: ${theme.breakpoints.md})`) ?? false;

  const {
    runs,
    setRuns,
    collapsed,
    resetCollapsed,
    doStreamRun,
    handleCollapse,
    streamingForRef,
    streaming,
  } = useRunStream();

  const [thread, setThread] = useState<{
    title: string;
    archived_at: Date | null;
  } | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<ModelName | null>(null);
  const [thinking, setThinking] = useState(false);
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [serverTools, setServerTools] = useState(false);
  const [gitlabTools, setGitlabTools] = useState(false);
  const [webSearchTools, setWebSearchTools] = useState(false);
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const displayThread = threadId === 'new' ? { title: 'New chat' } : thread;
  const displayLoadingRuns = threadId === 'new' ? false : loadingRuns;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    () => window.location.hash.replace('#run-', '') || null,
  );
  const [
    queryDrawerOpened,
    {
      open: openQueryDrawer,
      toggle: toggleQueryDrawer,
      close: closeQueryDrawer,
    },
  ] = useDisclosure(false);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Set right before handleSend swaps the 'new' URL for the real thread id, so the initial-load effect's re-run (a route param change, not a fresh mount) skips re-fetching what's already in local state.
  const skipNextLoadRef = useRef(false);
  // Reset alongside the initial-load effect's other per-thread bookkeeping, so switching threads re-arms the one-shot scroll-to-bottom below.
  const initialScrollDoneRef = useRef(false);

  const stickToBottom = useStickToBottom(
    viewportRef,
    runs,
    streaming || retrying || sending,
  );
  const { scrollToBottom } = stickToBottom;

  // Opens an existing conversation at its latest message — the streaming-only effect above wouldn't otherwise fire for a thread with no run in flight.
  useEffect(() => {
    if (initialScrollDoneRef.current || displayLoadingRuns || !runs.length) {
      return;
    }
    initialScrollDoneRef.current = true;
    scrollToBottom();
  }, [displayLoadingRuns, runs.length, scrollToBottom]);

  useEffect(() => {
    const onHashChange = () =>
      setSelectedRunId(window.location.hash.replace('#run-', '') || null);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Lets the tour open/close this page's mobile query drawer for steps whose target only exists inside it.
  useEffect(() => {
    registerPageDrawer({ open: openQueryDrawer, close: closeQueryDrawer });
    return () => registerPageDrawer(null);
  }, [registerPageDrawer, openQueryDrawer, closeQueryDrawer]);

  useEffect(() => {
    if (displayLoadingRuns || !runs.length || hasSeenTour(CHAT_TOUR_ID)) return;
    startTour(CHAT_TOUR_ID, chatSteps);
  }, [displayLoadingRuns, runs.length, startTour]);

  const visibleRuns = useMemo(() => buildLinearRuns(runs), [runs]);

  // Scroll-spy: marks the sidebar row of the query nearest the top as selected; keyed by run ids so it re-observes only when a turn is added, not on every streamed event.
  const runIdsKey = visibleRuns.map((r) => r.id).join(',');
  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    const bubbles = root.querySelectorAll<HTMLElement>('[data-event="input"]');
    if (!bubbles.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (top?.target.id) setSelectedRunId(top.target.id.replace('run-', ''));
      },
      // Shrinks the bottom of the root so the "current" query is the one near the top, not whatever last scrolled into the bottom.
      { root, rootMargin: '0px 0px -60% 0px' },
    );

    bubbles.forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  }, [runIdsKey]);

  useEffect(() => {
    api.models.get().then(({ data, error }) => {
      if (error) return handleError(error.value, 'Failed to fetch models');
      const openRouter = data.filter((m) => m.provider === 'openrouter');
      setModels(openRouter);
      setModel((m) => m ?? openRouter[0]?.model ?? null);
    });
  }, [handleError]);

  useEffect(() => {
    if (!threadId) return;

    // handleSend creates a 'new' thread lazily on first message, so nothing to fetch yet — displayThread/displayLoadingRuns cover the UI for this case.
    if (threadId === 'new') return;

    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    streamingForRef.current = null;
    initialScrollDoneRef.current = false;
    setLoadingRuns(true);

    (async () => {
      const [threadRes, runsRes] = await Promise.all([
        api
          .threads({ id: threadId })
          .get({ fetch: { signal: controller.signal } }),
        api.threads({ id: threadId }).runs.get({
          fetch: { signal: controller.signal },
        }),
      ]).catch(() => [null, null]);

      if (controller.signal.aborted) return;
      if (!threadRes || threadRes.error || !runsRes || runsRes.error) {
        handleError(
          threadRes?.error?.value ?? runsRes?.error?.value,
          'Failed to load chat',
        );
        navigate('/chat');
        return;
      }

      setThread(threadRes.data);
      setRuns(runsRes.data);
      resetCollapsed(runsRes.data);
      setLoadingRuns(false);

      // Restore the composer to whatever this chat last used, rather than resetting to defaults on every (re)load.
      const lastRun = runsRes.data[runsRes.data.length - 1];
      if (lastRun && isChatRunInput(lastRun.input)) {
        setModel(lastRun.input.model);
        setThinking(lastRun.input.reasoning ?? false);
        setServerTools(lastRun.input.tools?.server ?? false);
        setGitlabTools(lastRun.input.tools?.gitlab ?? false);
        setWebSearchTools(lastRun.input.tools?.webSearch ?? false);
      }

      for (const run of runsRes.data.filter((r) => r.status === 'running')) {
        if (controller.signal.aborted) break;
        await doStreamRun(threadId, run, controller);
      }
    })();

    return () => controller.abort();
  }, [
    threadId,
    doStreamRun,
    handleError,
    navigate,
    resetCollapsed,
    setRuns,
    streamingForRef,
  ]);

  // WS: pick up the first-message auto-rename without a reload — the run-creation response is a Run, not a Thread, so it never carries the updated title itself.
  useEffect(() => {
    if (!threadId || threadId === 'new') return;
    const socket = ws.subscribe();
    socket.on('error', (e) => console.error('[ws] error', e));
    socket.subscribe(({ data }) => {
      if (data.type !== 'thread:upserted' || data.payload.id !== threadId) {
        return;
      }
      setThread({
        title: data.payload.title,
        archived_at: data.payload.archived_at,
      });
    });
    return () => {
      socket.close();
    };
  }, [threadId]);

  const handleImageAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';

    if (images.length + files.length > MAX_IMAGES) {
      handleError(undefined, `Up to ${MAX_IMAGES} images per message`);
      return;
    }
    if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
      handleError(
        undefined,
        `Each image must be under ${MAX_IMAGE_BYTES / 1_000_000}MB`,
      );
      return;
    }

    // Uploaded immediately (not read as a data URL) — images state holds the server ref from POST /api/uploads, which the composer preview resolves to a servable URL.
    for (const file of files) {
      const body = new FormData();
      body.append('file', file);
      try {
        const res = await fetch(`${config.apiUrl}/api/uploads`, {
          method: 'POST',
          credentials: 'include',
          body,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.message);
        setImages((prev) => [...prev, data.ref as string]);
      } catch (err) {
        handleError(err, 'Failed to upload image');
      }
    }
  };

  const isArchived = !!thread?.archived_at;

  const handleSend = async () => {
    const trimmed = message.trim();
    // streaming/retrying too — a thread can only ever have one run in flight.
    if (
      !trimmed ||
      sending ||
      streaming ||
      retrying ||
      !threadId ||
      !model ||
      isArchived
    ) {
      return;
    }

    setSending(true);

    let activeThreadId = threadId;
    let createdThread = false;
    if (activeThreadId === 'new') {
      const { data: keyStatus } = await api.settings['openrouter-key'].get();

      if (!keyStatus?.configured) {
        setSending(false);
        handleError(
          undefined,
          'Add your OpenRouter API key in Settings before starting a chat',
        );

        return;
      }

      const { data: newThread, error: threadError } = await api.threads.post({
        title: 'New chat',
        kind: 'chat',
      });
      if (threadError || !newThread) {
        setSending(false);
        handleError(threadError?.value, 'Failed to start chat');
        return;
      }
      activeThreadId = newThread.id;
      createdThread = true;
      skipNextLoadRef.current = true;
      setThread({ title: newThread.title, archived_at: null });
      setLoadingRuns(false);
      navigate(`/chat/${activeThreadId}`, { replace: true });
    }

    const { data: run, error } = await api
      .threads({ id: activeThreadId })
      .runs.post({
        message: trimmed,
        images: images.length ? images : undefined,
        model,
        reasoning: thinking,
        tools: {
          server: serverTools,
          gitlab: gitlabTools,
          webSearch: webSearchTools,
        },
      });
    setSending(false);

    if (error || !run) {
      handleError(error?.value, 'Failed to send message');
      // Otherwise this orphans an empty thread already retitled to the query by buildInput.
      if (createdThread) {
        await api.threads({ id: activeThreadId }).delete();
        setThread(null);
        navigate('/chat/new', { replace: true });
      }
      return;
    }

    setMessage('');
    setImages([]);
    // The run starts immediately — mark it running so the timeline shows live pending indicators until the stream's run_end sets the final status.
    setRuns((prev) => [
      ...prev,
      { ...run, status: 'running', started_at: new Date() },
    ]);
    // Sending is a deliberate action — snap back to the bottom even if the user had scrolled up to read history.
    stickToBottom.scrollToBottom();
    // Native fragment navigation scrolls to it and fires hashchange, updating selectedRunId — same path a query-list click goes through.
    window.location.hash = `run-${run.id}`;

    const controller = new AbortController();
    abortRef.current = controller;
    await doStreamRun(activeThreadId, run, controller);
  };

  const handleAbort = async () => {
    const runId = streamingForRef.current;
    if (!runId || !threadId || aborting) return;
    setAborting(true);
    await api
      .threads({ id: threadId })
      .runs({ runId })
      .abort.post()
      .catch(() => {})
      .finally(() => setAborting(false));
  };

  const handleRetry = async (runId: string, checkpointId?: string) => {
    // sending/streaming too — a thread can only ever have one run in flight.
    if (!threadId || sending || streaming || retrying) return;

    setRetrying(true);
    const { data: run, error } = await api
      .threads({ id: threadId })
      .runs({ runId })
      .retry.post(checkpointId ? { checkpointId } : {});
    setRetrying(false);

    if (error || !run) {
      handleError(error?.value, 'Failed to retry');
      return;
    }

    // No bubble/anchor for a retry — nothing to scroll-to-hash here.
    setRuns((prev) => [...prev, { ...run, status: 'running' }]);
    stickToBottom.scrollToBottom();

    const controller = new AbortController();
    abortRef.current = controller;
    await doStreamRun(threadId, run, controller);
  };

  const handleDecision = async (
    runId: string,
    toolCallId: string,
    decision: 'approve' | 'reject',
  ) => {
    if (!threadId || sending || streaming || retrying) return;

    setRetrying(true);
    const { data: run, error } = await api
      .threads({ id: threadId })
      .runs({ runId })
      .decision.post({ toolCallId, decision });
    setRetrying(false);

    if (error || !run) {
      handleError(error?.value, 'Failed to record decision');
      return;
    }

    // No bubble/anchor for a decision-resume either — same as retry.
    setRuns((prev) => [...prev, { ...run, status: 'running' }]);
    stickToBottom.scrollToBottom();

    const controller = new AbortController();
    abortRef.current = controller;
    await doStreamRun(threadId, run, controller);
  };

  const hasMessages = runs.length > 0;

  const header = (
    <Group
      className="chat-page__header"
      justify="space-between"
      wrap="nowrap"
      gap="xs"
    >
      <Group gap="xs" wrap="nowrap" className="chat-page__header-title">
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={() => navigate('/chat')}
          aria-label="Back to chats"
        >
          <Icon as={IconArrowLeft} />
        </ActionIcon>
        {displayThread ? (
          <>
            <Title order={4} className="chat-page__title">
              {displayThread.title}
            </Title>
            {hasMessages && (
              <TourReplayButton tourId={CHAT_TOUR_ID} steps={chatSteps} />
            )}
          </>
        ) : (
          <Skeleton height={20} width={180} radius="sm" />
        )}
      </Group>
      {isTablet && hasMessages && (
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={toggleQueryDrawer}
          aria-label="Toggle history"
        >
          <Icon as={IconLayoutSidebarRightExpand} />
        </ActionIcon>
      )}
    </Group>
  );

  const contextWindowByModel = useMemo(
    () => Object.fromEntries(models.map((m) => [m.model, m.contextWindow])),
    [models],
  );

  // Walks visibleRuns, not the raw run list — a stale branch's token usage shouldn't feed the running total shown for the current one.
  const { precedingContextTotalByRunId, latestContextUsage } = useMemo(() => {
    const map: Record<string, number> = {};
    let carry = 0;
    let latest: { totalTokens: number; contextWindow: number } | null = null;

    for (const run of visibleRuns) {
      map[run.id] = carry;
      let runningTotal = carry;
      let hadUsage = false;

      for (const e of run.events) {
        if (e.event === 'context_usage') {
          runningTotal = e.data.totalTokens;
          hadUsage = true;
        }
      }

      if (hadUsage) {
        carry = runningTotal;
        const contextWindow = contextWindowByModel[run.input.model];
        if (contextWindow)
          latest = { totalTokens: runningTotal, contextWindow };
      }
    }

    return { precedingContextTotalByRunId: map, latestContextUsage: latest };
  }, [visibleRuns, contextWindowByModel]);

  const {
    percent: contextPercent,
    color: contextColor,
    tooltipLabel: contextTooltipLabel,
  } = getContextMeter(latestContextUsage, 'chat');

  const personalMemoryStats = useMemo(() => {
    const toolOutputs = new Map<string, boolean>();
    for (const run of visibleRuns) {
      for (const { event, data } of run.events) {
        if (event !== 'tool_output') continue;
        const parsedOutput = data.output
          ? (safeJsonParse(data.output) as { error?: unknown } | undefined)
          : undefined;
        if (data.output ? !parsedOutput?.error : true) {
          toolOutputs.set(data.id, true);
        }
      }
    }

    let created = 0;
    let updated = 0;
    let deleted = 0;
    for (const run of visibleRuns) {
      for (const e of run.events) {
        if (e.event !== 'tool_input' || !toolOutputs.has(e.data.id)) continue;
        if (e.data.name === 'create_personal_memory') created++;
        else if (e.data.name === 'update_personal_memory') updated++;
        else if (e.data.name === 'delete_personal_memory') deleted++;
      }
    }

    return (
      [
        { color: 'green', label: 'new', value: created },
        { color: 'blue', label: 'updated', value: updated },
        { color: 'red', label: 'deleted', value: deleted },
      ] as const
    ).filter((s) => s.value > 0);
  }, [visibleRuns]);

  const composer = (
    <Paper
      className="chat-page__composer"
      p="sm"
      radius="md"
      data-tour="chat-composer"
    >
      <Stack gap="md">
        {images.length > 0 && (
          <Group gap="xs">
            {images.map((ref, i) => (
              <Box key={i} pos="relative">
                <Image
                  src={resolveUploadUrl(ref)}
                  w={56}
                  h={56}
                  radius="sm"
                  fit="cover"
                  className="chat-page__composer-image"
                  onClick={() => setLightboxSrc(resolveUploadUrl(ref))}
                />
                <CloseButton
                  size="xs"
                  pos="absolute"
                  top={-6}
                  right={-6}
                  className="chat-page__composer-image-close-button"
                  onClick={() =>
                    setImages((prev) => prev.filter((_, j) => j !== i))
                  }
                />
              </Box>
            ))}
          </Group>
        )}

        <Textarea
          placeholder={
            isArchived
              ? 'This chat is archived and read-only'
              : 'Ask something...'
          }
          disabled={isArchived}
          autosize
          variant="unstyled"
          maxRows={4}
          px={4}
          maxLength={MAX_MESSAGE_LENGTH}
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />

        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs">
            <Popover position="top-start" withArrow shadow="md">
              <Popover.Target>
                <Tooltip label="More options">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="More options"
                    disabled={isArchived}
                  >
                    <Icon as={IconPlus} />
                  </ActionIcon>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap={0} className="chat-composer-menu-switch">
                  <Switch
                    size="xs"
                    label="Thinking"
                    checked={thinking}
                    labelPosition="left"
                    onChange={(e) => setThinking(e.currentTarget.checked)}
                  />
                  <Switch
                    size="xs"
                    label="Server tools"
                    labelPosition="left"
                    checked={serverTools}
                    onChange={(e) => setServerTools(e.currentTarget.checked)}
                  />
                  <Switch
                    size="xs"
                    label="GitLab tools"
                    labelPosition="left"
                    checked={gitlabTools}
                    onChange={(e) => setGitlabTools(e.currentTarget.checked)}
                  />
                  <Switch
                    size="xs"
                    label="Fetch web pages"
                    labelPosition="left"
                    checked={webSearchTools}
                    onChange={(e) => setWebSearchTools(e.currentTarget.checked)}
                  />
                  <Divider my="xs" />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={handleImageAttach}
                  />
                  <Button
                    variant="subtle"
                    color="gray"
                    size="xs"
                    justify="flex-start"
                    leftSection={<Icon as={IconPaperclip} />}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Attach image
                  </Button>
                </Stack>
              </Popover.Dropdown>
            </Popover>
            {contextPercent !== null && (
              <Tooltip label={contextTooltipLabel}>
                <Badge color={contextColor} size="sm">
                  {contextPercent}%
                </Badge>
              </Tooltip>
            )}
          </Group>

          <Group gap="xs">
            <Select
              size="xs"
              variant="unstyled"
              comboboxProps={{
                width: 180,
              }}
              data={models.map((m) => ({ value: m.model, label: m.name }))}
              value={model}
              onChange={setModel}
              placeholder="Model"
              allowDeselect={false}
              disabled={isArchived}
            />
            {streaming ? (
              <Tooltip label="Stop response">
                <ActionIcon
                  size="lg"
                  color="red"
                  loading={aborting}
                  onClick={handleAbort}
                  aria-label="Stop"
                >
                  <Icon as={IconPlayerStop} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Tooltip label="Send message">
                <ActionIcon
                  size="lg"
                  loading={sending}
                  disabled={!message.trim() || !model || retrying || isArchived}
                  onClick={handleSend}
                  aria-label="Send"
                >
                  <Icon as={IconSend} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Group>
      </Stack>
    </Paper>
  );

  const showConversation = displayLoadingRuns || hasMessages;
  const mainContent = (
    <div className="chat-page__main" data-empty={!showConversation}>
      {showConversation && (
        <ScrollArea
          className="chat-page__timeline"
          type="hover"
          offsetScrollbars="present"
          viewportRef={viewportRef}
          onScrollPositionChange={stickToBottom.onScrollPositionChange}
          p="md"
        >
          {displayLoadingRuns && !hasMessages ? (
            <Stack className="chat-page__loading" gap="md">
              {Array.from({ length: 3 }).map((_, i) => (
                <Stack
                  key={i}
                  gap="xs"
                  align={i % 2 ? 'flex-end' : 'flex-start'}
                >
                  <Skeleton
                    height={16}
                    width={i % 2 ? '55%' : '80%'}
                    radius="sm"
                  />
                  <Skeleton
                    height={16}
                    width={i % 2 ? '35%' : '60%'}
                    radius="sm"
                  />
                </Stack>
              ))}
            </Stack>
          ) : (
            <RunTimeline
              runs={visibleRuns}
              collapsed={collapsed}
              onCollapse={handleCollapse}
              onRetry={isArchived ? undefined : handleRetry}
              onDecision={handleDecision}
              loading={streaming || retrying}
              precedingContextTotalByRunId={precedingContextTotalByRunId}
            />
          )}
        </ScrollArea>
      )}
      {composer}
    </div>
  );

  const queryPane = (
    <>
      <QueryList runs={visibleRuns} selectedRunId={selectedRunId} />
      <StatSummary
        title="Memories"
        tooltip="Durable, personal facts langgraph-harness saved or updated about you in this chat"
        dataTour="chat-memories"
        stats={personalMemoryStats}
      />
    </>
  );

  return (
    <div
      className="chat-page"
      data-breakpoint={isTablet ? 'tablet' : undefined}
    >
      {header}

      {isTablet ? (
        <>
          <Drawer
            classNames={{ body: 'chat-page__drawer' }}
            opened={queryDrawerOpened}
            onClose={closeQueryDrawer}
            position="right"
            size={300}
            padding="xs"
            withCloseButton={false}
          >
            <Stack gap="xs" h="100%">
              {queryPane}
            </Stack>
          </Drawer>
          {mainContent}
        </>
      ) : (
        <div className="chat-page__body">
          {mainContent}
          {hasMessages && (
            <div className="chat-page__query-pane">{queryPane}</div>
          )}
        </div>
      )}
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
};

export default ChatPage;
