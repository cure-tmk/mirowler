import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

type Matcher = (message: string) => unknown

type CommitlintConfig = {
  ignores?: Matcher[]
}

// The caller's shell branches on `if`, so body detection is mapped to exit 0.
// Unexpected failures fall back to NO_BODY, biasing toward not blocking the commit.
const HAS_BODY = 0
const NO_BODY = 1

const loadIgnores = async (projectDir: string): Promise<Matcher[]> => {
  const configPath = path.join(projectDir, 'commitlint.config.mjs')
  if (!fs.existsSync(configPath)) {
    return []
  }

  try {
    const loaded = (await import(pathToFileURL(configPath).href)) as { default?: CommitlintConfig }
    return loaded.default?.ignores ?? []
  } catch {
    return []
  }
}

const main = async (): Promise<number> => {
  const projectDir = process.argv[2] ?? process.cwd()
  const message = fs.readFileSync(0, 'utf8')

  const ignores = await loadIgnores(projectDir)
  if (ignores.some((matcher) => matcher(message))) {
    return NO_BODY
  }

  const body = message.split('\n').slice(1).join('\n')
  return body.trim() === '' ? NO_BODY : HAS_BODY
}

main().then(
  (code) => process.exit(code),
  () => process.exit(NO_BODY),
)
