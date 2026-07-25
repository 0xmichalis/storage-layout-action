import {execFileSync} from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {fileAtCommit, gitContext, pickBaseCandidate, resolveBaseCommit} from '../src/git'

describe('pickBaseCandidate', () => {
  const defaults = {baseInput: '', eventName: '', baseRef: '', eventPayload: {}}

  it('prefers the base input over everything else', () => {
    expect(
      pickBaseCandidate({
        ...defaults,
        baseInput: 'origin/main',
        eventName: 'pull_request',
        baseRef: 'main'
      })
    ).toEqual({ref: 'origin/main', description: '`base` input'})
  })

  it('uses the base branch on pull requests', () => {
    expect(pickBaseCandidate({...defaults, eventName: 'pull_request', baseRef: 'staging'})).toEqual(
      {ref: 'staging', description: "pull request base branch 'staging'"}
    )
  })

  it('uses the previous tip on pushes', () => {
    const before = 'a'.repeat(40)
    expect(pickBaseCandidate({...defaults, eventName: 'push', eventPayload: {before}})).toEqual({
      ref: before,
      description: 'commit before the push'
    })
  })

  it('skips pushes that created the branch', () => {
    const result = pickBaseCandidate({
      ...defaults,
      eventName: 'push',
      eventPayload: {before: '0'.repeat(40)}
    })
    expect(result).toHaveProperty('reason')
  })

  it('uses the merge queue base on merge_group events', () => {
    expect(
      pickBaseCandidate({
        ...defaults,
        eventName: 'merge_group',
        eventPayload: {merge_group: {base_sha: 'f'.repeat(40)}}
      })
    ).toEqual({ref: 'f'.repeat(40), description: 'merge queue base'})
  })

  it('skips events without an implicit base', () => {
    const result = pickBaseCandidate({...defaults, eventName: 'workflow_dispatch'})
    expect(result).toHaveProperty('reason')
    expect((result as {reason: string}).reason).toContain('workflow_dispatch')
  })
})

describe('git operations', () => {
  let repo: string

  const git = (...args: string[]): string =>
    execFileSync('git', args, {cwd: repo, encoding: 'utf8'}).trim()

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'))
    execFileSync('git', ['init', '-q', '-b', 'main', repo], {encoding: 'utf8'})
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'test')
    git('config', 'commit.gpgsign', 'false')
  })

  afterEach(() => {
    fs.rmSync(repo, {recursive: true, force: true})
  })

  it('resolves context, commits and file contents', () => {
    fs.mkdirSync(path.join(repo, 'contracts', 'storage-layouts'), {recursive: true})
    fs.writeFileSync(path.join(repo, 'contracts', 'storage-layouts', 'Vault.json'), '{"v":1}')
    git('add', '.')
    git('commit', '-q', '-m', 'initial')
    const sha = git('rev-parse', 'HEAD')

    const context = gitContext(path.join(repo, 'contracts'))
    expect(context?.root).toBe(git('rev-parse', '--show-toplevel'))
    expect(context?.prefix).toBe('contracts')

    const resolved = resolveBaseCommit(repo, {ref: sha, description: 'test'})
    expect(resolved).toEqual({sha, description: 'test'})

    expect(fileAtCommit(repo, sha, 'contracts/storage-layouts/Vault.json')).toBe('{"v":1}')
    expect(fileAtCommit(repo, sha, 'contracts/storage-layouts/Missing.json')).toBeUndefined()
  })

  it('resolves local refs without an origin remote', () => {
    fs.writeFileSync(path.join(repo, 'file.txt'), 'x')
    git('add', '.')
    git('commit', '-q', '-m', 'initial')
    const sha = git('rev-parse', 'HEAD')

    const resolved = resolveBaseCommit(repo, {ref: 'main', description: 'branch'})
    expect(resolved).toEqual({sha, description: 'branch'})
  })

  it('rejects unresolvable and unsafe refs', () => {
    fs.writeFileSync(path.join(repo, 'file.txt'), 'x')
    git('add', '.')
    git('commit', '-q', '-m', 'initial')

    expect(resolveBaseCommit(repo, {ref: 'nope', description: 'x'})).toHaveProperty('reason')
    expect(resolveBaseCommit(repo, {ref: '--upload-pack=evil', description: 'x'})).toHaveProperty(
      'reason'
    )
  })

  it('returns undefined context outside a repository', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'))
    try {
      expect(gitContext(outside)).toBeUndefined()
    } finally {
      fs.rmSync(outside, {recursive: true, force: true})
    }
  })
})
