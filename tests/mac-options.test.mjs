import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { normalizeOptions } = require('electron-builder/out/builder')
const { computeArchToTargetNamesMap } = require('app-builder-lib/out/targets/targetFactory')
const { Platform } = require('app-builder-lib')
const { Arch } = require('builder-util')

async function targets(args) {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const raw = normalizeOptions(args).targets.get(Platform.MAC)
  return computeArchToTargetNamesMap(raw, { platformSpecificBuildOptions: pkg.build.mac }, Platform.MAC)
}
test('default mac command resolves to both architectures without downloads', async () => {
  const result = await targets({ mac: [] })
  assert.equal(result.size, 2)
  assert.deepEqual(result.get(Arch.arm64), ['dmg', 'zip'])
  assert.deepEqual(result.get(Arch.x64), ['dmg', 'zip'])
})
for (const arch of ['arm64', 'x64']) {
  test(`explicit ${arch} command does not also build the other architecture`, async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    assert.ok(pkg.scripts[`dist:mac:${arch}`].includes(`--mac dmg zip --${arch}`))
    const result = await targets({ mac: ['dmg', 'zip'], [arch]: true })
    assert.equal(result.size, 1)
    assert.deepEqual(result.get(Arch[arch]), ['dmg', 'zip'])
  })
}
