import { Hono } from 'hono'
import { listChannels } from '../../db/channels'
import { getMonitor, listMonitors } from '../../db/monitors'
import { listRunsByMonitor } from '../../db/runs'
import type { AppEnv } from '../../env'
import { runNow } from '../../scheduled'
import { sendTestMessage } from '../../scheduled/retryNotifications'
import { Layout } from './Layout'

const exampleConfig = JSON.stringify(
  {
    name: 'Item price',
    schedule: { type: 'interval', minutes: 60 },
    source: { type: 'http', url: 'https://example.com/item' },
    extractor: { type: 'css_text', selector: '.price', parse: 'jpy' },
    evaluator: { type: 'rule', field: 'jpy', op: 'lte', value: 10000 },
    trigger: { type: 'on_enter' },
    channelIds: ['<channel id>'],
  },
  null,
  2,
)

export const pages = new Hono<AppEnv>()
  .get('/', async (c) => {
    const [monitors, channels] = await Promise.all([listMonitors(c.env.DB), listChannels(c.env.DB)])
    return c.html(
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
        <h2>Channels</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>ID</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr>
                <td>{ch.displayName}</td>
                <td>{ch.id}</td>
                <td>
                  <form method="post" action={`/channels/${ch.id}/test`}>
                    <button type="submit">Send test</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Add monitor</h2>
        <form method="post" action="/api/monitors">
          <label>
            Config JSON
            <br />
            <textarea name="config" rows={16} cols={80} required>
              {exampleConfig}
            </textarea>
          </label>
          <br />
          <button type="submit">Add</button>
        </form>
      </Layout>,
    )
  })
  .get('/monitors/:id', async (c) => {
    const monitor = await getMonitor(c.env.DB, c.req.param('id'))
    if (!monitor) {
      return c.notFound()
    }
    const runs = await listRunsByMonitor(c.env.DB, monitor.id)
    return c.html(
      <Layout title={monitor.name}>
        <p>{monitor.source.url}</p>
        <form method="post" action={`/monitors/${monitor.id}/run`}>
          <button type="submit">Run now</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Scheduled at</th>
              <th>Status</th>
              <th>State</th>
              <th>Value</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr>
                <td>{r.scheduledAt}</td>
                <td>{r.status}</td>
                <td>{r.state}</td>
                <td>{r.value ? JSON.stringify(r.value) : ''}</td>
                <td>{r.error ?? r.reason}</td>
              </tr>
            ))}
          </tbody>
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
        <a href="/">Back</a>
      </Layout>,
      status,
    )
  })
