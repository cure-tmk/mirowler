const SEVIRITY = {
  Disabled: 0,
  Warning: 1,
  Error: 2,
}

const matcher = (regexp) => (c) => c.match(regexp)

/**
 * @see https://commitlint.js.org/reference/configuration.html
 * @typedef {import('@commitlint/types').UserConfig} UserConfig
 */
const configuration = {
  parserPreset: 'conventional-changelog-conventionalcommits',
  defaultIgnores: false,
  // Defaults minus fixup!, squash!, and semver.
  // from: https://github.com/conventional-changelog/commitlint/blob/master/%40commitlint/is-ignored/src/defaults.ts
  ignores: [
    matcher(/^((Merge pull request)|(Merge (.*?) into (.*?)|(Merge branch (.*?)))(?:\r?\n)*$)/m),
    matcher(/^(Merge tag (.*?))(?:\r?\n)*$/m),
    matcher(/^(R|r)evert (.*)/),
    matcher(/^(Merged (.*?)(in|into) (.*)|Merged PR (.*): (.*))/),
    matcher(/^Merge remote-tracking branch(\s*)(.*)/),
    matcher(/^Automatic merge(.*)/),
    matcher(/^Auto-merged (.*?) into (.*)/),
  ],
  rules: {
    'body-leading-blank': [SEVIRITY.Error, 'always'],
    'body-max-line-length': [SEVIRITY.Warning, 'always', 72],
    'header-max-length': [SEVIRITY.Warning, 'always', 72],
    'scope-empty': [SEVIRITY.Error, 'always'],
    'subject-empty': [SEVIRITY.Error, 'never'],
    'subject-max-length': [SEVIRITY.Warning, 'always', 50],
    'type-case': [SEVIRITY.Error, 'always', 'lower-case'],
    'type-empty': [SEVIRITY.Error, 'never'],
    'type-enum': [
      SEVIRITY.Error,
      'always',
      ['feat', 'fix', 'chore', 'refactor', 'update', 'docs', 'clean', 'revert', 'release'],
    ],
  },
}

export default configuration
