import type { Child } from 'hono/jsx'

export const Layout = ({ title, children }: { title: string; children: Child }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} | mirowler</title>
    </head>
    <body>
      <header>
        <a href="/">mirowler</a>
        <nav>
          <a href="/">Monitors</a> | <a href="/channels">Channels</a>
        </nav>
      </header>
      <main>
        <h1>{title}</h1>
        {children}
      </main>
    </body>
  </html>
)
