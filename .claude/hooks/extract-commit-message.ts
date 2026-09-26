import fs from 'node:fs'
import path from 'node:path'

type HeredocBodies = Map<string, string>

type StrippedCommand = {
  command: string
  bodies: HeredocBodies
}

const EMPTY = ''
const NUL = '\u0000'
const SEPARATOR = '\u0000SEP'

const collectHeredocs = (command: string): StrippedCommand => {
  const bodies: HeredocBodies = new Map()
  const lines = command.split('\n')
  const kept: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const opener = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/)

    if (!opener) {
      kept.push(line)
      continue
    }

    const delimiter = opener[2]
    const token = `__HEREDOC_${bodies.size}__`
    const body: string[] = []

    let j = i + 1
    for (; j < lines.length; j += 1) {
      if (lines[j].trim() === delimiter) {
        break
      }
      body.push(lines[j])
    }

    bodies.set(token, body.join('\n'))
    kept.push(line.replace(opener[0], `'${token}'`))
    i = j
  }

  return { command: kept.join('\n'), bodies }
}

const tokenize = (command: string): string[] => {
  const tokens: string[] = []
  let current = EMPTY
  let started = false
  let quote: "'" | '"' | null = null

  const push = () => {
    if (started) {
      tokens.push(current)
    }
    current = EMPTY
    started = false
  }

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]

    if (quote === "'") {
      if (char === "'") {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (quote === '"') {
      if (char === '\\' && i + 1 < command.length && '"\\$`\n'.includes(command[i + 1])) {
        i += 1
        current += command[i] === '\n' ? EMPTY : command[i]
        continue
      }
      if (char === '"') {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      started = true
      continue
    }

    if (char === '\\' && i + 1 < command.length) {
      i += 1
      if (command[i] !== '\n') {
        current += command[i]
        started = true
      }
      continue
    }

    // Anything after `#` is a shell comment. It's ignored even if it contains
    // the literal text `git commit`, since it never executes.
    if (char === '#' && !started) {
      while (i < command.length && command[i] !== '\n') {
        i += 1
      }
      push()
      tokens.push(SEPARATOR)
      continue
    }

    if (/\s/.test(char) && char !== '\n') {
      push()
      continue
    }

    if (char === ';' || char === '&' || char === '|' || char === '\n' || char === '(' || char === ')') {
      push()
      tokens.push(SEPARATOR)
      continue
    }

    current += char
    started = true
  }

  push()
  return tokens
}

const segmentsOf = (tokens: string[]): string[][] => {
  const segments: string[][] = [[]]
  for (const token of tokens) {
    if (token === SEPARATOR) {
      segments.push([])
    } else {
      segments[segments.length - 1].push(token)
    }
  }
  return segments
}

const VALUE_TAKING_GLOBAL_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

const isGitCommit = (segment: string[]): boolean => {
  const gitIndex = segment.findIndex((token) => token === 'git' || token.endsWith('/git'))
  if (gitIndex === -1) {
    return false
  }

  for (let i = gitIndex + 1; i < segment.length; i += 1) {
    const token = segment[i]
    if (VALUE_TAKING_GLOBAL_OPTIONS.has(token)) {
      i += 1
      continue
    }
    if (token.startsWith('-')) {
      continue
    }
    return token === 'commit'
  }

  return false
}

const readFileMessage = (projectDir: string, filePath: string): string | null => {
  try {
    return fs.readFileSync(path.resolve(projectDir, filePath), 'utf8')
  } catch {
    return null
  }
}

const COMMAND_SUBSTITUTION = /^\$\((?:cat\s+)?'?(__HEREDOC_\d+__)'?\s*\)$/
const SHELL_EXPANSION = /[$`]/

const resolveValue = (value: string, bodies: HeredocBodies): string => {
  const direct = bodies.get(value)
  if (direct !== undefined) {
    return direct
  }
  if (!SHELL_EXPANSION.test(value)) {
    return value
  }

  const substituted = value.trim().match(COMMAND_SUBSTITUTION)
  const body = substituted ? bodies.get(substituted[1]) : undefined
  if (body !== undefined) {
    return body
  }

  // An unresolved substitution would cause a false block if passed to
  // commitlint as-is, so drop it instead.
  return EMPTY
}

const resolveFileValue = (
  value: string,
  bodies: HeredocBodies,
  projectDir: string,
  segmentHeredoc: string | null,
): string | null => {
  const heredoc = bodies.get(value)
  if (heredoc !== undefined) {
    return heredoc
  }
  // `-F -` reads from stdin; only consider the heredoc attached to this same segment.
  if (value === '-') {
    return segmentHeredoc
  }
  return readFileMessage(projectDir, value)
}

const extract = (segment: string[], bodies: HeredocBodies, projectDir: string): string | null => {
  // Multiple `-m` flags are joined by git into paragraphs (i.e. become the body),
  // so collect them all and reassemble the same way.
  const messages: string[] = []
  const segmentHeredoc = segment.reduce<string | null>((found, token) => found ?? bodies.get(token) ?? null, null)

  for (let i = 0; i < segment.length; i += 1) {
    const token = segment[i]

    if (token.startsWith('--message=')) {
      messages.push(resolveValue(token.slice('--message='.length), bodies))
      continue
    }

    if (token.startsWith('--file=')) {
      messages.push(resolveFileValue(token.slice('--file='.length), bodies, projectDir, segmentHeredoc) ?? '')
      continue
    }

    // `-m` / `-F` can appear standalone, as `-m<value>` attached directly, or
    // bundled into a short option group like `-am`. The first `m`/`F` ends the
    // group, so `-mFix` is `-m Fix`, not `-m` followed by `-F ix`.
    const bundled = token.match(/^-([A-Za-z]*?)([mF])(.*)$/)
    const isMessage = token === '--message' || bundled?.[2] === 'm'
    const isFile = token === '--file' || bundled?.[2] === 'F'
    if (!isMessage && !isFile) {
      continue
    }

    const attached = bundled?.[3] ?? ''
    const resolve = (raw: string) =>
      isMessage ? resolveValue(raw, bodies) : (resolveFileValue(raw, bodies, projectDir, segmentHeredoc) ?? '')

    if (attached !== '') {
      messages.push(resolve(attached))
      continue
    }

    const value = segment[i + 1]
    if (value !== undefined) {
      messages.push(resolve(value))
      i += 1
    }
  }

  return messages.length > 0 ? messages.join('\n\n') : null
}

const main = (): string => {
  const projectDir = process.argv[2] ?? process.cwd()

  let payload: unknown
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'))
  } catch {
    return EMPTY
  }

  const command = (payload as { tool_input?: { command?: unknown } })?.tool_input?.command
  if (typeof command !== 'string' || !command.includes('commit')) {
    return EMPTY
  }

  const { command: stripped, bodies } = collectHeredocs(command)
  const messages: string[] = []

  for (const segment of segmentsOf(tokenize(stripped))) {
    if (!isGitCommit(segment)) {
      continue
    }
    const message = extract(segment, bodies, projectDir)
    if (message !== null) {
      messages.push(message)
    }
  }

  // A chained command runs each commit independently, so pass all messages
  // through, NUL-separated.
  return messages.join(NUL)
}

process.stdout.write(main())
