import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { parseResponse } from 'hono/client'
import { type FormEvent, useState } from 'react'
import { HStack, Stack } from 'styled-system/jsx'
import { client, errorBody, httpStatus } from '~/api'
import { Badge, Button, Field, Heading, Input, Link, Table } from '~/components/ui'
import { formatTime } from '~/format'

const channelApi = client.api.channels[':id']

type ChannelInput = { displayName: string; secretName: string }

export const fetchChannels = () => parseResponse(client.api.channels.$get())

type Channel = Awaited<ReturnType<typeof fetchChannels>>[number]

// The channel routes read their JSON body without a validator, so hc leaves `json` untyped; it still sends it
const createChannel = (json: ChannelInput) => {
  const args = { json }
  return parseResponse(client.api.channels.$post(args))
}

const updateChannel = (id: string, json: ChannelInput) => {
  const args = { param: { id }, json }
  return parseResponse(channelApi.$put(args))
}

const useInvalidateChannels = () => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['channels'] })
}

export const Channels = () => {
  const { data, error } = useQuery({ queryKey: ['channels'], queryFn: fetchChannels })

  return (
    <Stack gap="6">
      <Heading as="h1" textStyle="xl">
        Channels
      </Heading>
      {error ? (
        <p role="alert">{error.message}</p>
      ) : !data ? (
        <p>Loading…</p>
      ) : data.length === 0 ? (
        <p>No channels yet</p>
      ) : (
        <Table.Root>
          <Table.Head>
            <Table.Row>
              <Table.Header>Name</Table.Header>
              <Table.Header>Secret name</Table.Header>
              <Table.Header>Secret</Table.Header>
              <Table.Header>Created</Table.Header>
              <Table.Header />
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {data.map((channel) => (
              <ChannelRow key={channel.id} channel={channel} />
            ))}
          </Table.Body>
        </Table.Root>
      )}
      <CreateChannel />
    </Stack>
  )
}

const CreateChannel = () => {
  const invalidate = useInvalidateChannels()
  const [formKey, setFormKey] = useState(0)
  const create = useMutation({
    mutationFn: createChannel,
    onSuccess: async () => {
      setFormKey((k) => k + 1)
      await invalidate()
    },
  })

  return (
    <Stack gap="2">
      <Heading as="h2" textStyle="lg">
        Add channel
      </Heading>
      <ChannelForm
        key={formKey}
        initial={{ displayName: '', secretName: '' }}
        submitLabel="Add"
        pending={create.isPending}
        error={create.error}
        onSubmit={create.mutate}
      />
    </Stack>
  )
}

const ChannelRow = ({ channel }: { channel: Channel }) => {
  const invalidate = useInvalidateChannels()
  const [editing, setEditing] = useState(false)
  const param = { id: channel.id }

  const update = useMutation({
    mutationFn: (json: ChannelInput) => updateChannel(channel.id, json),
    onSuccess: async () => {
      await invalidate()
      setEditing(false)
    },
  })
  const remove = useMutation({
    mutationFn: () => parseResponse(channelApi.$delete({ param })),
    onSuccess: invalidate,
  })
  const test = useMutation({ mutationFn: () => parseResponse(channelApi.test.$post({ param })) })

  const confirmDelete = () => {
    if (window.confirm(`Delete the channel "${channel.displayName}"?`)) {
      remove.mutate()
    }
  }

  if (editing) {
    return (
      <Table.Row>
        <Table.Cell colSpan={5}>
          <ChannelForm
            initial={channel}
            submitLabel="Save"
            pending={update.isPending}
            error={update.error}
            onSubmit={update.mutate}
            onCancel={() => {
              update.reset()
              setEditing(false)
            }}
          />
        </Table.Cell>
      </Table.Row>
    )
  }

  return (
    <Table.Row>
      <Table.Cell>{channel.displayName}</Table.Cell>
      <Table.Cell>{channel.secretName}</Table.Cell>
      <Table.Cell>
        <Badge colorPalette={channel.secretConfigured ? 'green' : 'red'}>
          {channel.secretConfigured ? 'Configured' : 'Not set'}
        </Badge>
      </Table.Cell>
      <Table.Cell>{formatTime(channel.createdAt)}</Table.Cell>
      <Table.Cell>
        <Stack gap="1">
          <HStack gap="2">
            <Button size="sm" variant="outline" onClick={() => test.mutate()} loading={test.isPending}>
              Send test
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="outline" colorPalette="red" onClick={confirmDelete} loading={remove.isPending}>
              Delete
            </Button>
          </HStack>
          {test.isSuccess && <p role="status">Test message sent</p>}
          {test.error && <p role="alert">Test message failed: {test.error.message}</p>}
          {remove.error && <DeleteError error={remove.error} />}
        </Stack>
      </Table.Cell>
    </Table.Row>
  )
}

const DeleteError = ({ error }: { error: Error }) => {
  const monitors = errorBody(error)?.monitors
  if (httpStatus(error) !== 409 || !monitors) {
    return <p role="alert">{error.message}</p>
  }
  return (
    <p role="alert">
      Used by{' '}
      {monitors.map((m, i) => (
        <span key={m.id}>
          {i > 0 && ', '}
          <Link asChild>
            <RouterLink to="/monitors/$monitorId" params={{ monitorId: m.id }}>
              {m.name}
            </RouterLink>
          </Link>
        </span>
      ))}
      ; remove the channel from these monitors before deleting it
    </p>
  )
}

const ChannelForm = ({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: ChannelInput
  submitLabel: string
  pending: boolean
  error: Error | null
  onSubmit: (input: ChannelInput) => void
  onCancel?: () => void
}) => {
  const [displayName, setDisplayName] = useState(initial.displayName)
  const [secretName, setSecretName] = useState(initial.secretName)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit({ displayName: displayName.trim(), secretName })
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="3" maxW="md">
        <Field.Root required>
          <Field.Label>Display name</Field.Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field.Root>
        <Field.Root required>
          <Field.Label>Secret name</Field.Label>
          <Input
            value={secretName}
            onChange={(e) => setSecretName(e.target.value)}
            pattern="SLACK_[A-Z0-9_]+"
            placeholder="SLACK_WEBHOOK_TEAM"
          />
          <Field.HelperText>
            The name of the Worker Secret holding the Slack webhook URL: SLACK_ followed by A-Z, 0-9 or _
          </Field.HelperText>
        </Field.Root>
        {error && <p role="alert">{error.message}</p>}
        <HStack gap="2">
          <Button type="submit" loading={pending}>
            {submitLabel}
          </Button>
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </HStack>
      </Stack>
    </form>
  )
}
