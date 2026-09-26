import { type Monitor, monitorConfigSchema } from '@mirowler/core'
import { Hono } from 'hono'
import { type Channel, insertChannel, listChannels } from '../../db/channels'
import { getMonitor, insertMonitor, listMonitors } from '../../db/monitors'
import { listHistoryByMonitor } from '../../db/runs'
import type { AppEnv } from '../../env'
import { runNow } from '../../scheduled'
import { sendTestMessage } from '../../scheduled/retryNotifications'
import { isValidChannelInput } from '../api/channels'
import { Layout } from './Layout'
import { defaultFormValues, type FormErrors, type FormValues, formToConfig, MonitorForm, readForm } from './monitorForm'

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
  monitors: Monitor[]
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
            <td>{m.nextRunAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <h2>Add monitor</h2>
    <MonitorForm channels={channels} values={values} errors={errors} />
  </Layout>
)

export const pages = new Hono<AppEnv>()
  .get('/', async (c) => {
    const [monitors, channels] = await Promise.all([listMonitors(c.env.DB), listChannels(c.env.DB)])
    return c.html(<MonitorsPage monitors={monitors} channels={channels} values={defaultFormValues} />)
  })
  .post('/monitors', async (c) => {
    const values = readForm(await c.req.parseBody({ all: true }))
    const { config, errors } = formToConfig(values)
    if (!config) {
      const [monitors, channels] = await Promise.all([listMonitors(c.env.DB), listChannels(c.env.DB)])
      return c.html(<MonitorsPage monitors={monitors} channels={channels} values={values} errors={errors} />, 400)
    }
    const id = await insertMonitor(c.env.DB, config, new Date().toISOString())
    return c.redirect(`/monitors/${id}`)
  })
  .get('/monitors/:id', async (c) => {
    const monitor = await getMonitor(c.env.DB, c.req.param('id'))
    if (!monitor) {
      return c.notFound()
    }
    const history = await listHistoryByMonitor(c.env.DB, monitor.id)
    return c.html(
      <Layout title={monitor.name}>
        <p>{monitor.source.url}</p>
        <form method="post" action={`/monitors/${monitor.id}/run`}>
          <button type="submit">Run now</button>
        </form>
        <h2>Edit</h2>
        <form method="post" action={`/api/monitors/${monitor.id}/edit`}>
          <label>
            Config JSON (version {monitor.configVersion})
            <br />
            <textarea name="config" rows={16} cols={80} required>
              {JSON.stringify(monitorConfigSchema.parse(monitor), null, 2)}
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
      </Layout>,
    )
  })
  .post('/monitors/:id/run', async (c) => {
    const id = c.req.param('id')
    if (await runNow(c.env, id)) {
      return c.redirect(`/monitors/${id}`)
    }
    return c.html(
      <Layout title="Run now">
        <p>The monitor is already running or does not exist</p>
        <a href={`/monitors/${id}`}>Back</a>
      </Layout>,
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
    return c.html(
      <Layout title="Send test">
        <p>{message}</p>
        <a href="/channels">Back</a>
      </Layout>,
      status,
    )
  })
