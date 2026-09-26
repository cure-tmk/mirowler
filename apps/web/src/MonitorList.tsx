import { useQuery } from '@tanstack/react-query'
import { client } from '~/api'
import { Badge, Heading, Link, Table } from '~/components/ui'

const fetchMonitors = async () => (await client.api.monitors.$get()).json()

export const MonitorList = () => {
  const { data, error } = useQuery({ queryKey: ['monitors'], queryFn: fetchMonitors })

  return (
    <>
      <Heading as="h1" textStyle="xl" mb="4">
        Monitors
      </Heading>
      {error ? (
        <p role="alert">{error.message}</p>
      ) : !data ? (
        <p>Loading…</p>
      ) : data.length === 0 ? (
        <p>No monitors yet</p>
      ) : (
        <Table.Root>
          <Table.Head>
            <Table.Row>
              <Table.Header>Name</Table.Header>
              <Table.Header>URL</Table.Header>
              <Table.Header>Status</Table.Header>
              <Table.Header>Next run</Table.Header>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {data.map((monitor) => (
              <Table.Row key={monitor.id}>
                <Table.Cell>{monitor.name}</Table.Cell>
                <Table.Cell>
                  <Link href={monitor.source.url} target="_blank" rel="noreferrer">
                    {monitor.source.url}
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  <Badge colorPalette={monitor.enabled ? 'green' : 'gray'}>
                    {monitor.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </Table.Cell>
                <Table.Cell>{monitor.enabled ? new Date(monitor.nextRunAt).toLocaleString() : '—'}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </>
  )
}
