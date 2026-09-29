import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Client } from './client.ts'
import { operations } from './operations.ts'

/** An MCP server exposing every operation as a tool named like `monitors_create`. */
export const createServer = (client: Client) => {
  const server = new McpServer({ name: 'mirowler', version: '0.0.0' })
  for (const op of operations) {
    server.registerTool(
      op.name.replace('.', '_'),
      {
        description: op.description,
        inputSchema: op.input,
        annotations: { readOnlyHint: op.readOnly ?? false, destructiveHint: op.destructive ?? false },
      },
      async (input) => ({ content: [{ type: 'text', text: JSON.stringify(await op.call(client, input), null, 2) }] }),
    )
  }
  return server
}
