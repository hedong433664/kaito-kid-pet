import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { publishArtifacts, cleanReleaseArtifacts, resolveOutputDirectory, assertBuildHost } from '../scripts/package.mjs'

async function fixture(t) {
  const parent = path.resolve(os.tmpdir())
  const root = await mkdtemp(path.join(parent, 'pet-package-test-'))
  t.after(async () => {
    assert.equal(path.dirname(root), parent)
    assert.ok(path.basename(root).startsWith('pet-package-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const staging = path.join(root, 'staging'), destination = path.join(root, 'release')
  await mkdir(staging)
  return { root, staging, destination }
}

test('publish finished installer and metadata, not unpacked ASAR directories', async (t) => {
  const { staging, destination } = await fixture(t)
  await writeFile(path.join(staging, 'Pet Setup.exe'), 'installer')
  await writeFile(path.join(staging, 'Pet Setup.exe.blockmap'), 'blockmap')
  await writeFile(path.join(staging, 'latest.yml'), 'metadata')
  await mkdir(path.join(staging, 'win-unpacked'))
  const files = await publishArtifacts(staging, destination)
  assert.equal(files.length, 3)
  assert.deepEqual((await readdir(destination)).sort(), ['Pet Setup.exe', 'Pet Setup.exe.blockmap', 'latest.yml'])
})
test('new build removes old installers, sidecars and recognized stale unpacked folders', async (t) => {
  const { staging, destination } = await fixture(t)
  await mkdir(path.join(destination, 'win-unpacked.tmp', 'resources'), { recursive: true })
  await writeFile(path.join(destination, 'win-unpacked.tmp', 'resources', 'default_app.asar'), 'stale')
  await mkdir(path.join(destination, 'user-notes'))
  for (const name of ['MyDesktopPet Setup 0.1.0.exe', 'kaito-kid-pet-old.dmg', 'old.zip', 'old.exe.blockmap', 'latest-mac.yml', 'builder-debug.yml']) {
    await writeFile(path.join(destination, name), 'old')
  }
  await writeFile(path.join(destination, 'README.txt'), 'keep me')
  await writeFile(path.join(staging, 'kaito-kid-pet-new.exe'), 'new')
  await publishArtifacts(staging, destination)
  assert.deepEqual((await readdir(destination)).sort(), ['README.txt', 'kaito-kid-pet-new.exe', 'user-notes'])
  assert.equal(await readFile(path.join(destination, 'README.txt'), 'utf8'), 'keep me')
})
test('failed build does not delete the last working installer', async (t) => {
  const { staging, destination } = await fixture(t)
  await mkdir(destination)
  await writeFile(path.join(destination, 'last-working.exe'), 'keep')
  await writeFile(path.join(staging, 'builder-effective-config.yaml'), 'metadata')
  await assert.rejects(publishArtifacts(staging, destination), /No installer/)
  assert.equal(await readFile(path.join(destination, 'last-working.exe'), 'utf8'), 'keep')
})
test('locked obsolete unpacked directory warns and does not stop cleanup', async (t) => {
  const { destination } = await fixture(t)
  await mkdir(path.join(destination, 'win-unpacked.tmp'), { recursive: true })
  await writeFile(path.join(destination, 'old.exe'), 'old')
  const warnings = []
  const result = await cleanReleaseArtifacts(destination, {
    onWarning: (message) => warnings.push(message),
    remove: (target, options) => {
      if (path.basename(target) === 'win-unpacked.tmp') throw Object.assign(new Error('locked'), { code: 'EBUSY' })
      return rm(target, options)
    },
  })
  assert.deepEqual(result.removed, ['old.exe'])
  assert.deepEqual(result.skipped, ['win-unpacked.tmp'])
  assert.equal(warnings.length, 1)
})
test('locked installer fails clearly rather than silently publishing mixed versions', async (t) => {
  const { destination } = await fixture(t)
  await mkdir(destination)
  await writeFile(path.join(destination, 'old.exe'), 'old')
  await assert.rejects(cleanReleaseArtifacts(destination, {
    remove: () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }) },
  }), /Cannot remove old installer/)
})
test('cleanup does not follow directory links outside the release directory', async (t) => {
  const { root, destination } = await fixture(t)
  const outside = path.join(root, 'retained')
  await mkdir(outside); await mkdir(destination)
  await writeFile(path.join(outside, 'keep.exe'), 'keep')
  await symlink(outside, path.join(destination, 'mac'), process.platform === 'win32' ? 'junction' : 'dir')
  await cleanReleaseArtifacts(destination)
  assert.equal(await readFile(path.join(outside, 'keep.exe'), 'utf8'), 'keep')
  assert.deepEqual(await readdir(destination), ['mac'])
})
test('output guard rejects project root, source folders and paths outside project', () => {
  const root = path.resolve('project-fixture')
  assert.equal(resolveOutputDirectory(root), path.join(root, 'release'))
  for (const output of ['.', '..', '../outside', 'src', 'public', 'electron', 'node_modules']) {
    assert.throws(() => resolveOutputDirectory(root, output), /unsafe output/)
  }
})
test('macOS package entry is rejected on Windows and accepted on macOS', () => {
  assert.throws(() => assertBuildHost(['--mac'], 'win32'), /macOS/)
  assert.throws(() => assertBuildHost(['--mac=dmg'], 'linux'), /macOS/)
  assert.doesNotThrow(() => assertBuildHost(['--mac', '--arm64'], 'darwin'))
  assert.doesNotThrow(() => assertBuildHost(['--win'], 'win32'))
})
test('macOS config builds separate DMG and ZIP for Intel and Apple Silicon', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.scripts['dist:mac'].includes('--mac'))
  assert.ok(pkg.scripts['dist:mac:arm64'].includes('--arm64'))
  assert.ok(pkg.scripts['dist:mac:x64'].includes('--x64'))
  assert.deepEqual(pkg.build.mac.target, [
    { target: 'dmg', arch: ['arm64', 'x64'] }, { target: 'zip', arch: ['arm64', 'x64'] },
  ])
  assert.ok(pkg.build.mac.artifactName.includes('${arch}'))
})
