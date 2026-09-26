import type { Child } from 'hono/jsx'

export const Layout = ({ title, children }: { title: string; children: Child }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} | mirowler</title>
    </head>
    <body>
      <header>
        <a href="/">mirowler</a>
      </header>
      <main>
        <h1>{title}</h1>
        {children}
      </main>
    </body>
  </html>
)
