import { monitorConfigSchema, previewInputSchema } from '@mirowler/core/monitor'
import { z } from 'zod'
import type { Client } from './client.ts'

/** One admin API call, shared by the CLI (`monitors create`) and the MCP server (`monitors_create`). */
export type Operation = {
  name: string
  description: string
  input: z.ZodObject
  readOnly?: true
  destructive?: true
  call: (client: Client, input: unknown) => Promise<unknown>
}

type Definition<S extends z.ZodObject> = Omit<Operation, 'input' | 'call'> & {
  input: S
  call: (client: Client, input: z.infer<S>) => Promise<unknown>
}

// The CLI passes its arguments unvalidated so that the Worker's 400 reaches the user; the MCP SDK parses them first
const define = <S extends z.ZodObject>(op: Definition<S>): Operation => ({
  ...op,
  call: (client, input) => op.call(client, input as z.infer<S>),
})

const json = async (res: Promise<{ json: () => Promise<unknown> }>) => (await res).json()

const id = z.string().describe('Monitor id')
const channelId = z.string().describe('Channel id')
const channel = z.object({
  displayName: z.string(),
  secretName: z
    .string()
    .describe('Name of the Worker Secret holding the Slack webhook URL: SLACK_ followed by A-Z, 0-9, _'),
})

const configRules = [
  'Match a positive "can buy / in stock" marker, never the absence of an out-of-stock label.',
  'When the state lives in an attribute, use a css_attr extractor with parse "text".',
  "The evaluator's field must equal the extractor's parse mode.",
  'A change evaluator ignores the trigger.',
  'Recommended flow: preview, then monitors_create, monitors_run, and runs_list to check the recorded state.',
].join(' ')

const monitors = (client: Client) => client.api.monitors
const monitor = (client: Client) => client.api.monitors[':id']

export const operations: Operation[] = [
  define({
    name: 'monitors.list',
    description: 'List monitors with their health.',
    input: z.object({}),
    readOnly: true,
    call: (client) => json(monitors(client).$get()),
  }),
  define({
    name: 'monitors.get',
    description: 'Get one monitor with its health and baseline observation.',
    input: z.object({ id }),
    readOnly: true,
    call: (client, { id }) => json(monitor(client).$get({ param: { id } })),
  }),
  define({
    name: 'monitors.create',
    description: `Create a monitor from a full config. ${configRules}`,
    input: z.object({ body: monitorConfigSchema }),
    call: (client, { body }) => json(monitors(client).$post({ json: body })),
  }),
  define({
    name: 'monitors.update',
    description: `Replace a monitor's config. ${configRules}`,
    input: z.object({ id, body: monitorConfigSchema }),
    call: (client, { id, body }) => {
      // Without a validator hc types no body or query, and an inline literal next to `param` fails the excess property check
      const args = { param: { id }, json: body }
      return json(monitor(client).$put(args))
    },
  }),
  define({
    name: 'monitors.enable',
    description: 'Enable a monitor.',
    input: z.object({ id }),
    call: (client, { id }) =>
      json(monitor(client)[':action{enable|disable}'].$post({ param: { id, action: 'enable' } })),
  }),
  define({
    name: 'monitors.disable',
    description: 'Disable a monitor.',
    input: z.object({ id }),
    call: (client, { id }) =>
      json(monitor(client)[':action{enable|disable}'].$post({ param: { id, action: 'disable' } })),
  }),
  define({
    name: 'monitors.run',
    description: 'Run a monitor now. Returns the run id; the run finishes in the background, so poll runs_list for it.',
    input: z.object({ id }),
    call: (client, { id }) => json(monitor(client).run.$post({ param: { id } })),
  }),
  define({
    name: 'monitors.delete',
    description: 'Delete a monitor and its history.',
    input: z.object({ id }),
    destructive: true,
    call: (client, { id }) => json(monitor(client).$delete({ param: { id } })),
  }),
  define({
    name: 'runs.list',
    description: "List a monitor's runs, newest first. Pass the returned nextCursor as cursor for the next page.",
    input: z.object({ id, cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
    readOnly: true,
    call: (client, { id, cursor, limit }) => {
      const query = { ...(cursor && { cursor }), ...(limit !== undefined && { limit: String(limit) }) }
      const args = { param: { id }, query }
      return json(monitor(client).runs.$get(args))
    },
  }),
  define({
    name: 'notifications.list',
    description: "List a monitor's notifications.",
    input: z.object({ id }),
    readOnly: true,
    call: (client, { id }) => json(monitor(client).notifications.$get({ param: { id } })),
  }),
  define({
    name: 'channels.list',
    description: 'List Slack channels and whether their secret is configured.',
    input: z.object({}),
    readOnly: true,
    call: (client) => json(client.api.channels.$get()),
  }),
  define({
    name: 'channels.create',
    description: 'Create a Slack channel.',
    input: z.object({ body: channel }),
    call: (client, { body }) => json(client.api.channels.$post({ json: body })),
  }),
  define({
    name: 'channels.update',
    description: 'Replace a Slack channel.',
    input: z.object({ id: channelId, body: channel }),
    call: (client, { id, body }) => {
      const args = { param: { id }, json: body }
      return json(client.api.channels[':id'].$put(args))
    },
  }),
  define({
    name: 'channels.delete',
    description: 'Delete a Slack channel. Fails with the using monitors while any monitor uses it.',
    input: z.object({ id: channelId }),
    destructive: true,
    call: (client, { id }) => json(client.api.channels[':id'].$delete({ param: { id } })),
  }),
  define({
    name: 'channels.test',
    description: 'Send a test message to a Slack channel.',
    input: z.object({ id: channelId }),
    call: (client, { id }) => json(client.api.channels[':id'].test.$post({ param: { id } })),
  }),
  define({
    name: 'preview',
    description: `Fetch, extract and optionally evaluate once without saving anything. ${configRules}`,
    input: z.object({ body: previewInputSchema }),
    readOnly: true,
    call: (client, { body }) => json(client.api.preview.$post({ json: body })),
  }),
]
