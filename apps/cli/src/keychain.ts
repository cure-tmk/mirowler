import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const service = 'mirowler'

export type Credentials = { url: string; auth: string }

const storedUrl = async () => {
  const { stdout } = await run('security', ['find-generic-password', '-s', service])
  return /"acct"<blob>="(.*)"/.exec(stdout)?.[1]
}

const clear = async () => {
  for (;;) {
    try {
      await run('security', ['delete-generic-password', '-s', service])
    } catch {
      return
    }
  }
}

/** Credentials in the macOS login keychain, one Worker at a time: the account is the URL, the password `user:pass`. */
export const keychain = {
  read: async (url?: string): Promise<Credentials | undefined> => {
    try {
      const account = url ?? (await storedUrl())
      if (!account) {
        return undefined
      }
      const { stdout } = await run('security', ['find-generic-password', '-s', service, '-a', account, '-w'])
      return { url: account, auth: stdout.replace(/\n$/, '') }
    } catch {
      return undefined
    }
  },
  save: async (url: string) => {
    await clear()
    // A trailing -w makes security prompt for the password itself, so it never appears in any argv
    const child = spawn('security', ['add-generic-password', '-s', service, '-a', url, '-w'], { stdio: 'inherit' })
    const code = await new Promise<number | null>((resolve, reject) => child.on('error', reject).on('exit', resolve))
    if (code !== 0) {
      throw new Error(`security add-generic-password exited with ${code}`)
    }
  },
  clear,
}

export type Keychain = typeof keychain
