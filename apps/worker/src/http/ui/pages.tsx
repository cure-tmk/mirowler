import { type Monitor, monitorConfigSchema } from '@mirowler/core'
import { type Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { assertPublicHttpsUrl } from '../../adapters/httpFetcher'
import { type Channel, insertChannel, listChannels } from '../../db/channels'
import {
  getMonitor,
  insertMonitor,
  listMonitorHealth,
  type MonitorHealth,
  updateMonitorConfig,
} from '../../db/monitors'
import { listHistoryByMonitor } from '../../db/runs'
import type { AppEnv } from '../../env'
import { runNow } from '../../scheduled'
import { sendTestMessage } from '../../scheduled/retryNotifications'
import { isValidChannelInput } from '../api/channels'
import { Layout } from './Layout'
import { defaultFormValues, type FormErrors, type FormValues, formToConfig, MonitorForm, readForm } from './monitorForm'

export const ATTENTION_THRESHOLD = 3

type History = Awaited<ReturnType<typeof listHistoryByMonitor>>

const MessagePage = ({ title, message, back }: { title: string; message: string; back: string }) => (
  <Layout title={title}>
    <p>{message}</p>
    <a href={back}>Back</a>
  </Layout>
)

const ChannelsPage = ({
  channels,
  error,
  input,
}: {
  channels: Channel[]
  error?: string
  input?: { displayName: string; secretName: string }
}) => (
  <Layout title="Channels">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Kind</th>
          <th>ID</th>
          <th>Secret name</th>
          <th>Created</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {channels.map((ch) => (
          <tr>
            <td>{ch.displayName}</td>
            <td>{ch.kind}</td>
            <td>{ch.id}</td>
            <td>{ch.secretName}</td>
            <td>{ch.createdAt}</td>
            <td>
              <form method="post" action={`/channels/${ch.id}/test`}>
                <button type="submit">Send test</button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <h2>Add channel</h2>
    {error && <p role="alert">{error}</p>}
    <form method="post" action="/channels">
      <label>
        Display name <input name="displayName" required value={input?.displayName} />
      </label>
      <br />
      <label>
        Secret name <input name="secretName" required pattern="[A-Z0-9_]+" value={input?.secretName} />
      </label>
      <br />
      <label>
        Kind{' '}
        <select name="kind" disabled>
          <option value="slack_webhook">slack_webhook</option>
        </select>
      </label>
      <br />
      <button type="submit">Add</button>
    </form>
  </Layout>
)

const MonitorsPage = ({
  monitors,
  channels,
  values,
  errors,
}: {
  monitors: MonitorHealth[]
  channels: Channel[]
  values: FormValues
  errors?: FormErrors
}) => (
  <Layout title="Monitors">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>URL</th>
          <th>Enabled</th>
          <th>Next run</th>
          <th>Status</th>
          <th>Consecutive unknown</th>
          <th>Failure rate</th>
          <th>Last run</th>
        </tr>
      </thead>
      <tbody>
        {monitors.map((m) => (
          <tr>
            <td>
              <a href={`/monitors/${m.id}`}>{m.name}</a>
            </td>
            <td>{m.source.url}</td>
            <td>{m.enabled ? 'yes' : 'no'}</td>
            <td>
              {m.nextRunAt}
              {m.delayed && ' (delayed)'}
            </td>
            <td>{(m.delayed || m.consecutiveUnknown >= ATTENTION_THRESHOLD) && <strong>ATTENTION</strong>}</td>
            <td>{m.consecutiveUnknown}</td>
            <td>{m.failureRate === null ? '' : `${Math.round(m.failureRate * 100)}%`}</td>
            <td>{m.lastRun && `${m.lastRun.at} ${m.lastRun.state ?? ''}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <h2>Add monitor</h2>
    <MonitorForm channels={channels} values={values} errors={errors} />
  </Layout>
)

const configTextOf = (monitor: Monitor) => {
  const parsed = monitorConfigSchema.safeParse(monitor)
  return JSON.stringify(parsed.success ? parsed.data : monitor, null, 2)
}

const MonitorPage = ({
  monitor,
  history,
  configText,
  errors,
}: {
  monitor: Monitor
  history: History
  configText: string
  errors?: string[]
}) => (
  <Layout title={monitor.name}>
    <p>{monitor.source.url}</p>
    <form method="post" action={`/monitors/${monitor.id}/run`}>
      <button type="submit">Run now</button>
    </form>
    <h2>Edit</h2>
    {errors && (
      <ul role="alert">
        {errors.map((e) => (
          <li>{e}</li>
        ))}
      </ul>
    )}
    <form method="post" action={`/monitors/${monitor.id}/edit`}>
      <label>
        Config JSON (version {monitor.configVersion})
        <br />
        <textarea name="config" rows={16} cols={80} required>
          {configText}
        </textarea>
      </label>
      <br />
      <button type="submit">Save</button>
    </form>
    <h2>History</h2>
    <table>
      <thead>
        <tr>
          <th>Scheduled at</th>
          <th>Started at</th>
          <th>Finished at</th>
          <th>Status</th>
          <th>State</th>
          <th>Value</th>
          <th>Reason</th>
          <th>Error</th>
          <th>Config version</th>
        </tr>
      </thead>
      {history.map((r) => (
        <tbody>
          <tr>
            <td>{r.scheduledAt}</td>
            <td>{r.startedAt}</td>
            <td>{r.finishedAt}</td>
            <td>{r.status}</td>
            <td>{r.state}</td>
            <td>{r.value ? JSON.stringify(r.value) : ''}</td>
            <td>{r.reason}</td>
            <td>{r.error}</td>
            <td>{r.configVersion}</td>
          </tr>
          {r.events.map((e) => (
            <tr>
              <td colspan={9}>
                Event {e.kind}: {e.summary}
                <table>
                  <tr>
                    <th>Channel</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Last error</th>
                    <th>Sent at</th>
                  </tr>
                  {e.notifications.map((n) => (
                    <tr>
                      <td>{n.channel}</td>
                      <td>{n.status === 'failed' ? <strong>FAILED</strong> : n.status}</td>
                      <td>{n.attempts}</td>
                      <td>{n.lastError}</td>
                      <td>{n.sentAt}</td>
                    </tr>
                  ))}
                </table>
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  </Layout>
)

const renderMonitorPage = async (
  c: Context<AppEnv>,
  monitor: Monitor,
  edit?: { configText: string; errors: string[] },
) => {
  const history = await listHistoryByMonitor(c.env.DB, monitor.id)
  return c.html(
    <MonitorPage
      monitor={monitor}
      history={history}
      configText={edit?.configText ?? configTextOf(monitor)}
      errors={edit?.errors}
    />,
    edit ? 400 : 200,
  )
}

const renderMonitorsPage = async (
  c: Context<AppEnv>,
  values: FormValues,
  errors?: FormErrors,
  status: ContentfulStatusCode = 200,
) => {
  const [monitors, channels] = await Promise.all([listMonitorHealth(c.env.DB, new Date()), listChannels(c.env.DB)])
  return c.html(<MonitorsPage monitors={monitors} channels={channels} values={values} errors={errors} />, status)
}

const parseEditedConfig = (configText: string) => {
  let json: unknown
  try {
    json = JSON.parse(configText)
  } catch {
    return { errors: ['Config must be valid JSON'] }
  }
  const parsed = monitorConfigSchema.safeParse(json)
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
  }
  try {
    assertPublicHttpsUrl(parsed.data.source.url)
  } catch (e) {
    return { errors: [`source.url: ${e instanceof Error ? e.message : String(e)}`] }
  }
  return { config: parsed.data }
}

export const pages = new Hono<AppEnv>()
  .get('/', (c) => renderMonitorsPage(c, defaultFormValues))
  .post('/monitors', async (c) => {
    const values = readForm(await c.req.parseBody({ all: true }))
    const { config, errors } = formToConfig(values)
    if (!config) {
      return renderMonitorsPage(c, values, errors, 400)
    }
    const id = await insertMonitor(c.env.DB, config, new Date().toISOString())
    return c.redirect(`/monitors/${id}`)
  })
  .get('/monitors/:id', async (c) => {
    const monitor = await getMonitor(c.env.DB, c.req.param('id'))
    if (!monitor) {
      return c.notFound()
    }
    return renderMonitorPage(c, monitor)
  })
  .post('/monitors/:id/edit', async (c) => {
    const id = c.req.param('id')
    const form = await c.req.parseBody()
    const configText = typeof form.config === 'string' ? form.config : ''
    const { config, errors } = parseEditedConfig(configText)
    if (config && (await updateMonitorConfig(c.env.DB, id, config, new Date().toISOString()))) {
      return c.redirect(`/monitors/${id}`)
    }
    const monitor = await getMonitor(c.env.DB, id)
    if (!monitor) {
      return c.notFound()
    }
    return renderMonitorPage(c, monitor, { configText, errors: errors ?? [] })
  })
  .post('/monitors/:id/run', async (c) => {
    const id = c.req.param('id')
    if (await runNow(c.env, id)) {
      return c.redirect(`/monitors/${id}`)
    }
    if (!(await getMonitor(c.env.DB, id))) {
      return c.html(<MessagePage title="Run now" message="Monitor not found" back="/" />, 404)
    }
    return c.html(
      <MessagePage title="Run now" message="The monitor is already running" back={`/monitors/${id}`} />,
      409,
    )
  })
  .get('/channels', async (c) => c.html(<ChannelsPage channels={await listChannels(c.env.DB)} />))
  .post('/channels', async (c) => {
    const form = await c.req.parseBody()
    const input = { displayName: form.displayName, secretName: form.secretName }
    if (!isValidChannelInput(input)) {
      return c.html(
        <ChannelsPage
          channels={await listChannels(c.env.DB)}
          error="Display name is required and secret name may only contain A-Z, 0-9 and _"
          input={{
            displayName: typeof input.displayName === 'string' ? input.displayName : '',
            secretName: typeof input.secretName === 'string' ? input.secretName : '',
          }}
        />,
        400,
      )
    }
    await insertChannel(c.env.DB, input, new Date().toISOString())
    return c.redirect('/channels')
  })
  .post('/channels/:id/test', async (c) => {
    const result = await sendTestMessage(c.env, c.req.param('id'))
    const [message, status] = !result
      ? (['Channel not found', 404] as const)
      : result.ok
        ? (['Test message sent', 200] as const)
        : ([`Failed to send: ${result.error}`, 502] as const)
    return c.html(<MessagePage title="Send test" message={message} back="/channels" />, status)
  })
