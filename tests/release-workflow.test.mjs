import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const workflow = yaml.load(await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'))
const { validateVersion, expectedInstallers, verifyInstallers } = await import('../scripts/validate-release.mjs')

test('release workflow uses tag-triggered Windows and macOS builds and a gated publish job', () => {
  assert.deepEqual(workflow.on.push.tags, ['v*'])
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'))
  assert.deepEqual(Object.keys(workflow.jobs), ['validate', 'build-windows', 'build-macos', 'publish'])
  assert.ok(workflow.jobs.publish.if.includes("github.event_name == 'push'"))
  assert.deepEqual(workflow.jobs.publish.needs.sort(), ['build-macos', 'build-windows'])
  assert.equal(workflow.jobs.publish.permissions.contents, 'write')
  assert.equal(workflow.jobs.validate.permissions, undefined)
  assert.ok(workflow.jobs['build-windows'].steps.some((step) => step.run?.includes('npm run dist:win')))
  assert.ok(workflow.jobs['build-macos'].steps.some((step) => step.run?.includes('npm run dist:mac')))
  assert.ok(workflow.jobs.publish.steps.some((step) => step.run?.includes('gh release create')))
})
test('release validation requires exact package and lockfile versions', () => {
  const pkg = { version: '1.0.0', build: { productName: 'kaito-kid-pet' } }
  const lock = { version: '1.0.0', packages: { '': { version: '1.0.0' } } }
  assert.equal(validateVersion(pkg, lock, 'v1.0.0'), '1.0.0')
  assert.throws(() => validateVersion(pkg, lock, 'v1.0.1'), /does not match/)
  assert.throws(() => validateVersion(pkg, { ...lock, version: '0.9.0' }), /must match/)
  assert.deepEqual(expectedInstallers(pkg, 'windows'), ['kaito-kid-pet Setup 1.0.0.exe', 'kaito-kid-pet Setup 1.0.0.exe.blockmap'])
  assert.deepEqual(expectedInstallers(pkg, 'macos'), [
    'kaito-kid-pet-1.0.0-mac-arm64.dmg', 'kaito-kid-pet-1.0.0-mac-arm64.zip',
    'kaito-kid-pet-1.0.0-mac-x64.dmg', 'kaito-kid-pet-1.0.0-mac-x64.zip',
  ])
})

test('only publish has write access; official actions are pinned and builders cannot publish', () => {
  assert.equal(workflow.permissions.contents, 'read')
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (name !== 'publish') assert.notEqual(job.permissions?.contents, 'write')
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/)
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false)
    }
  }
  for (const name of ['build-windows', 'build-macos']) {
    const build = workflow.jobs[name].steps.find((step) => step.run?.includes('npm run dist:'))
    assert.ok(build.run.endsWith('-- --publish never'))
  }
})
test('invalid semantic versions are rejected and prereleases retain an exact tag match', () => {
  for (const version of ['01.0.0', '1.0', '1.0.0-', '1.0.0-alpha..1', '1.0.0-01', '1.0.0; echo bad']) {
    assert.throws(() => validateVersion({ version }, {}), /valid semantic version/)
  }
  const version = '1.0.1-beta.1+build.2'
  assert.equal(validateVersion({ version }, { version, packages: { '': { version } } }, `v${version}`), version)
})
test('artifact verification rejects empty files and incomplete macOS architectures', async (t) => {
  const parent = path.resolve(os.tmpdir())
  const directory = await mkdtemp(path.join(parent, 'kid-release-test-'))
  t.after(async () => {
    assert.equal(path.dirname(directory), parent)
    assert.ok(path.basename(directory).startsWith('kid-release-test-'))
    await rm(directory, { recursive: true, force: true })
  })
  const pkg = { version: '1.0.0', build: { productName: 'kaito-kid-pet' } }
  const files = expectedInstallers(pkg, 'macos')
  for (const name of files.slice(0, 3)) await writeFile(path.join(directory, name), 'asset')
  await assert.rejects(verifyInstallers(pkg, 'macos', directory), /Missing or empty/)
  await writeFile(path.join(directory, files[3]), '')
  await assert.rejects(verifyInstallers(pkg, 'macos', directory), /Missing or empty/)
  await writeFile(path.join(directory, files[3]), 'asset')
  assert.deepEqual(await verifyInstallers(pkg, 'macos', directory), files)
})
