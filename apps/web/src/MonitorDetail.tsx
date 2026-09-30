import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink, useNavigate, useParams } from '@tanstack/react-router'
import { parseResponse } from 'hono/client'
import { useCallback, useEffect, useState } from 'react'
import { css, cx } from 'styled-system/css'
import { Box, HStack, Stack } from 'styled-system/jsx'
import { client, httpStatus } from '~/api'
import { Badge, Button, Heading, Link, Table } from '~/components/ui'
import { formatRate, formatState, formatTime, formatValue } from '~/format'
import { HealthBadges, wrapAnywhere } from '~/MonitorList'

const monitorApi = client.api.monitors[':id']

type Monitor = Awaited<ReturnType<typeof fetchMonitor>>
type RunsPage = Awaited<ReturnType<typeof fetchRuns>>
type HistoryRun = RunsPage['runs'][number]
type PendingRun = { runId: string; since: number }

const RUN_POLL_MS = 2000
// A run whose isolate dies stays `running` until the stale claim is taken over minutes later; stop polling well before that
const RUN_POLL_WINDOW_MS = 2 * 60_000

export const fetchMonitor = (id: string) => parseResponse(monitorApi.$get({ param: { id } }))

const fetchRuns = (id: string, cursor: string | undefined) => {
  // The route reads `cursor` without a validator, so hc leaves `query` untyped; it still sends it
  const args = { param: { id }, query: cursor ? { cursor } : {} }
  return parseResponse(monitorApi.runs.$get(args))
}

const isFinished = (pages: RunsPage[] | undefined, runId: string) =>
  pages?.some((page) => page.runs.some((run) => run.runId === runId && run.status !== 'running')) ?? false

const useInvalidateMonitor = (id: string) => {
  const queryClient = useQueryClient()
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['monitors', id], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['monitors'], exact: true }),
      ]),
    [queryClient, id],
  )
}

const describeSchedule = (schedule: Monitor['schedule']) =>
  schedule.type === 'interval' ? `Every ${schedule.minutes} min` : `Daily at ${schedule.time} (${schedule.timezone})`

export const MonitorDetail = () => {
  const { monitorId } = useParams({ from: '/monitors/$monitorId' })
  return <MonitorPage key={monitorId} monitorId={monitorId} />
}

const MonitorPage = ({ monitorId }: { monitorId: string }) => {
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null)
  const clearPendingRun = useCallback(() => setPendingRun(null), [])
  const { data: monitor, error } = useQuery({
    queryKey: ['monitors', monitorId],
    queryFn: () => fetchMonitor(monitorId),
  })

  if (!monitor) {
    return error ? (
      <p role="alert">{httpStatus(error) === 404 ? 'Monitor not found' : error.message}</p>
    ) : (
      <p>Loading…</p>
    )
  }
  return (
    <Stack gap="6">
      {error && <p role="alert">{error.message}</p>}
      <Summary monitor={monitor} />
      <Actions monitor={monitor} running={pendingRun !== null} onRun={setPendingRun} />
      <Baseline monitor={monitor} />
      <History monitorId={monitor.id} pendingRun={pendingRun} onRunSettled={clearPendingRun} />
    </Stack>
  )
}

const Summary = ({ monitor }: { monitor: Monitor }) => (
  <Stack gap="2">
    <Heading as="h1" textStyle="xl" className={wrapAnywhere}>
      {monitor.name}
    </Heading>
    <Link href={monitor.source.url} target="_blank" rel="noreferrer" className={wrapAnywhere}>
      {monitor.source.url}
    </Link>
    <HealthBadges monitor={monitor} />
    <p>
      {describeSchedule(monitor.schedule)}, next run {monitor.enabled ? formatTime(monitor.nextRunAt) : '—'}, config
      version {monitor.configVersion}
    </p>
    <p>
      Consecutive unknown {monitor.consecutiveUnknown}, failure rate {formatRate(monitor.failureRate)}
    </p>
  </Stack>
)

const Actions = ({
  monitor,
  running,
  onRun,
}: {
  monitor: Monitor
  running: boolean
  onRun: (run: PendingRun) => void
}) => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const invalidateMonitor = useInvalidateMonitor(monitor.id)
  const param = { id: monitor.id }

  const toggle = useMutation({
    mutationFn: () =>
      parseResponse(
        monitorApi[':action{enable|disable}'].$post({
          param: { ...param, action: monitor.enabled ? 'disable' : 'enable' },
        }),
      ),
    onSuccess: invalidateMonitor,
  })
  const run = useMutation({
    mutationFn: () => parseResponse(monitorApi.run.$post({ param })),
    onSuccess: ({ runId }) => onRun({ runId, since: Date.now() }),
  })
  const remove = useMutation({
    mutationFn: () => parseResponse(monitorApi.$delete({ param })),
    onSuccess: async () => {
      await navigate({ to: '/' })
      queryClient.removeQueries({ queryKey: ['monitors', monitor.id] })
      await queryClient.invalidateQueries({ queryKey: ['monitors'], exact: true })
    },
  })

  const confirmDelete = () => {
    if (window.confirm(`Delete "${monitor.name}" with its whole history? This cannot be undone`)) {
      remove.mutate()
    }
  }

  return (
    <Stack gap="2">
      <HStack gap="2">
        <Button onClick={() => run.mutate()} loading={run.isPending || running} loadingText="Running…">
          Run now
        </Button>
        <Button variant="outline" asChild>
          <RouterLink to="/monitors/$monitorId/edit" params={{ monitorId: monitor.id }}>
            Edit
          </RouterLink>
        </Button>
        <Button variant="outline" onClick={() => toggle.mutate()} loading={toggle.isPending}>
          {monitor.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button variant="outline" colorPalette="red" onClick={confirmDelete} loading={remove.isPending}>
          Delete
        </Button>
      </HStack>
      {run.error && (
        <p role="alert">
          {httpStatus(run.error) === 409
            ? 'A run is already in progress; its result appears in the history when it finishes'
            : run.error.message}
        </p>
      )}
      {toggle.error && <p role="alert">{toggle.error.message}</p>}
      {remove.error && (
        <p role="alert">
          {httpStatus(remove.error) === 409
            ? 'The monitor is running right now; delete it again after the run finishes'
            : remove.error.message}
        </p>
      )}
    </Stack>
  )
}

const Baseline = ({ monitor }: { monitor: Monitor }) => (
  <Stack gap="2">
    <Heading as="h2" textStyle="lg">
      Baseline
    </Heading>
    {monitor.baseline ? (
      <p>
        {formatValue(monitor.baseline.value)} ({formatState(monitor.baseline.state)}), observed{' '}
        {formatTime(monitor.baseline.observedAt)}
      </p>
    ) : (
      <p>No baseline yet; the next valid run records one</p>
    )}
  </Stack>
)

const History = ({
  monitorId,
  pendingRun,
  onRunSettled,
}: {
  monitorId: string
  pendingRun: PendingRun | null
  onRunSettled: () => void
}) => {
  const queryClient = useQueryClient()
  const invalidateMonitor = useInvalidateMonitor(monitorId)
  const pendingRunId = pendingRun?.runId
  const failedSince = (error: Error | null, errorAt: number) =>
    pendingRun !== null && httpStatus(error) !== undefined && errorAt >= pendingRun.since
  const runs = useInfiniteQuery({
    queryKey: ['monitors', monitorId, 'runs'],
    queryFn: ({ pageParam }) => fetchRuns(monitorId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) =>
      pendingRunId &&
      !failedSince(query.state.error, query.state.errorUpdatedAt) &&
      !isFinished(query.state.data?.pages, pendingRunId)
        ? RUN_POLL_MS
        : false,
  })
  const finished = pendingRunId !== undefined && isFinished(runs.data?.pages, pendingRunId)
  const pollFailed = failedSince(runs.error, runs.errorUpdatedAt)

  const settle = useCallback(() => {
    onRunSettled()
    invalidateMonitor()
  }, [onRunSettled, invalidateMonitor])

  useEffect(() => {
    if (pendingRunId) {
      queryClient.setQueryData<InfiniteData<RunsPage>>(['monitors', monitorId, 'runs'], (data) =>
        data ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data,
      )
    }
  }, [pendingRunId, queryClient, monitorId])

  useEffect(() => {
    if (finished || pollFailed) {
      settle()
    }
  }, [finished, pollFailed, settle])

  useEffect(() => {
    if (pendingRunId) {
      const timer = setTimeout(() => {
        settle()
        queryClient.invalidateQueries({ queryKey: ['monitors', monitorId, 'runs'], exact: true })
      }, RUN_POLL_WINDOW_MS)
      return () => clearTimeout(timer)
    }
  }, [pendingRunId, settle, queryClient, monitorId])

  const all = runs.data?.pages.flatMap((page) => page.runs)

  return (
    <Stack gap="2">
      <Heading as="h2" textStyle="lg">
        History
      </Heading>
      {runs.error && <p role="alert">{runs.error.message}</p>}
      {!all ? (
        !runs.error && <p>Loading…</p>
      ) : all.length === 0 ? (
        <p>No runs yet</p>
      ) : (
        <Box overflowX="auto">
          <Table.Root>
            <Table.Head>
              <Table.Row>
                <Table.Header>Scheduled</Table.Header>
                <Table.Header>Finished</Table.Header>
                <Table.Header>Status</Table.Header>
                <Table.Header>State</Table.Header>
                <Table.Header>Value</Table.Header>
                <Table.Header>Details</Table.Header>
              </Table.Row>
            </Table.Head>
            {all.map((run) => (
              <RunRows key={run.runId} run={run} />
            ))}
          </Table.Root>
        </Box>
      )}
      {runs.hasNextPage && (
        <Button
          variant="outline"
          alignSelf="start"
          onClick={() => runs.fetchNextPage()}
          loading={runs.isFetchingNextPage}
        >
          Load older runs
        </Button>
      )}
    </Stack>
  )
}

const statusLabels: Record<string, string> = { running: 'Running', done: 'Done', error: 'Error' }

const notificationColor = (status: string) => (status === 'sent' ? 'green' : status === 'failed' ? 'red' : 'gray')

const RunRows = ({ run }: { run: HistoryRun }) => (
  <Table.Body>
    <Table.Row>
      <Table.Cell>{formatTime(run.scheduledAt)}</Table.Cell>
      <Table.Cell>{formatTime(run.finishedAt)}</Table.Cell>
      <Table.Cell>{statusLabels[run.status] ?? run.status}</Table.Cell>
      <Table.Cell>{formatState(run.state)}</Table.Cell>
      <Table.Cell>{formatValue(run.value)}</Table.Cell>
      <Table.Cell className={cx(wrapAnywhere, css({ minW: '16rem' }))}>{run.error ?? run.reason ?? ''}</Table.Cell>
    </Table.Row>
    {run.events.map((event) => (
      <Table.Row key={event.id}>
        <Table.Cell colSpan={6} className={wrapAnywhere}>
          <Stack gap="1" ps="4">
            <p>
              <strong>{event.kind === 'entered' ? 'Entered' : 'Value changed'}</strong>: {event.summary}
            </p>
            {event.notifications.length === 0 && <p>No notifications</p>}
            {event.notifications.map((n, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: `channel` is a display name that may repeat; the server orders rows by channel id
              <HStack key={i} gap="2" flexWrap="wrap">
                <span>{n.channel}</span>
                <Badge colorPalette={notificationColor(n.status)}>{n.status}</Badge>
                <span>
                  {n.attempts} {n.attempts === 1 ? 'attempt' : 'attempts'}
                </span>
                {n.sentAt && <span>sent {formatTime(n.sentAt)}</span>}
                {n.lastError && <span>last error: {n.lastError}</span>}
              </HStack>
            ))}
          </Stack>
        </Table.Cell>
      </Table.Row>
    ))}
  </Table.Body>
)
