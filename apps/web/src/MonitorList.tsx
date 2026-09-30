import { useQuery } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { css, cx } from 'styled-system/css'
import { Box, HStack } from 'styled-system/jsx'
import { client } from '~/api'
import { Badge, Button, Heading, Link, Table } from '~/components/ui'
import { formatRate, formatState, formatTime } from '~/format'

// overflow-wrap: anywhere does not narrow a colspan cell in Chromium's table layout; word-break: break-word does
export const wrapAnywhere = css({ whiteSpace: 'normal', wordBreak: 'break-word' })

const fetchMonitors = async () => (await client.api.monitors.$get()).json()

export const HealthBadges = ({ monitor }: { monitor: { enabled: boolean; attention: boolean; delayed: boolean } }) => (
  <HStack gap="1">
    <Badge colorPalette={monitor.enabled ? 'green' : 'gray'}>{monitor.enabled ? 'Enabled' : 'Disabled'}</Badge>
    {monitor.attention && <Badge colorPalette="red">Attention</Badge>}
    {monitor.delayed && <Badge colorPalette="red">Delayed</Badge>}
  </HStack>
)

export const MonitorList = () => {
  const { data, error } = useQuery({ queryKey: ['monitors'], queryFn: fetchMonitors })

  return (
    <>
      <HStack justify="space-between" mb="4">
        <Heading as="h1" textStyle="xl">
          Monitors
        </Heading>
        <Button asChild>
          <RouterLink to="/monitors/new">New monitor</RouterLink>
        </Button>
      </HStack>
      {error ? (
        <p role="alert">{error.message}</p>
      ) : !data ? (
        <p>Loading…</p>
      ) : data.length === 0 ? (
        <p>No monitors yet</p>
      ) : (
        <Box overflowX="auto">
          <Table.Root>
            <Table.Head>
              <Table.Row>
                <Table.Header>Name</Table.Header>
                <Table.Header>URL</Table.Header>
                <Table.Header>Status</Table.Header>
                <Table.Header>Next run</Table.Header>
                <Table.Header>Last run</Table.Header>
                <Table.Header>Consecutive unknown</Table.Header>
                <Table.Header>Failure rate</Table.Header>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {data.map((monitor) => (
                <Table.Row key={monitor.id}>
                  <Table.Cell className={cx(wrapAnywhere, css({ minW: '12rem' }))}>
                    <Link asChild className={css({ maxW: '20rem' })}>
                      <RouterLink to="/monitors/$monitorId" params={{ monitorId: monitor.id }}>
                        {monitor.name}
                      </RouterLink>
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    <Link
                      href={monitor.source.url}
                      target="_blank"
                      rel="noreferrer"
                      title={monitor.source.url}
                      className={css({ display: 'block', maxW: '12rem', truncate: true })}
                    >
                      {monitor.source.url}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    <HealthBadges monitor={monitor} />
                  </Table.Cell>
                  <Table.Cell>{monitor.enabled ? formatTime(monitor.nextRunAt) : '—'}</Table.Cell>
                  <Table.Cell>
                    {monitor.lastRun
                      ? `${formatTime(monitor.lastRun.at)} (${formatState(monitor.lastRun.state)})`
                      : '—'}
                  </Table.Cell>
                  <Table.Cell>{monitor.consecutiveUnknown}</Table.Cell>
                  <Table.Cell>{formatRate(monitor.failureRate)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}
    </>
  )
}
