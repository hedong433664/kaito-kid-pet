import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const number = '(?:0|[1-9]\\d*)'
const identifier = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)'
const semver = new RegExp(`^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`)

export function validateVersion(pkg, lock, tag = '') {
  const version = pkg.version
  if (typeof version !== 'string' || !semver.test(version)) throw new Error('package.json must contain a valid semantic version.')
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('package.json and package-lock.json root versions must match.')
  }
  if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package version ${version}; expected v${version}.`)
  return version
}
export function expectedInstallers(pkg, platform) {
  const name = pkg.build.productName
  if (platform === 'windows') return [`${name} Setup ${pkg.version}.exe`, `${name} Setup ${pkg.version}.exe.blockmap`]
  if (platform === 'macos') return ['arm64', 'x64'].flatMap((arch) => ['dmg', 'zip'].map((ext) => `${name}-${pkg.version}-mac-${arch}.${ext}`))
  throw new Error(`Unsupported release platform: ${platform}`)
}
export async function verifyInstallers(pkg, platform, directory) {
  const names = expectedInstallers(pkg, platform)
  for (const name of names) {
    const file = path.join(directory, name)
    const info = await stat(file).catch(() => undefined)
    if (!info?.isFile() || info.size === 0) throw new Error(`Missing or empty release artifact: ${file}`)
  }
  return names
}
async function main() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  const version = validateVersion(pkg, lock, process.env.RELEASE_TAG ?? '')
  const index = process.argv.indexOf('--artifacts')
  if (index !== -1) {
    const names = await verifyInstallers(pkg, process.argv[index + 1], path.join(root, 'release'))
    console.log(`Verified ${names.length} ${process.argv[index + 1]} release files for ${version}.`)
  } else console.log(`Release version verified: ${version}`)
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
