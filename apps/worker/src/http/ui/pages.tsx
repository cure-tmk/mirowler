import { Hono } from 'hono'
import { getMonitor, listMonitors } from '../../db/monitors'
import { listRunsByMonitor } from '../../db/runs'
import type { AppEnv } from '../../env'
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
    const monitors = await listMonitors(c.env.DB)
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
