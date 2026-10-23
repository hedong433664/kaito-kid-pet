import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, lstat, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = fileURLToPath(new URL('..', import.meta.url))

const installerPattern = /\.(exe|msi|msix|appx|dmg|pkg|deb|rpm|AppImage|zip|7z|tar\.gz|tar\.xz)$/i
const sidecarPattern = /\.blockmap$|^(?:latest|beta|alpha)(?:-[\w-]+)?\.(?:yml|yaml|json)$|^builder-(?:debug|effective-config)\.(?:yml|yaml)$/i
const unpackedPattern = /^(?:win(?:-(?:arm64|ia32|x64))?-unpacked|linux(?:-(?:arm64|ia32|x64))?-unpacked|mac(?:-(?:arm64|x64|universal))?)(?:\.tmp)?$|^(?:kaito-kid-pet|MyDesktopPet)\.app$/i

function isInside(parent, target) {
  const relative = path.relative(parent, target)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}
export function resolveOutputDirectory(root, configured = 'release') {
  const destination = path.resolve(root, configured)
  const first = path.relative(root, destination).split(path.sep)[0]
  if (!isInside(root, destination) || ['src', 'public', 'electron', 'scripts', 'tests', 'node_modules', '.git', '.vscode'].includes(first)) {
    throw new Error(`Refusing to clean an unsafe output directory: ${destination}`)
  }
  return destination
}
export function assertBuildHost(args, host = process.platform) {
  if (host !== 'darwin' && args.some((arg) => ['--mac', '--macos', '-m'].includes(arg.split('=')[0]))) {
    throw new Error('本项目的 macOS DMG/ZIP 打包流程需要在 macOS 上执行。请在 Mac 上运行 npm run dist:mac；当前系统请使用 npm run dist:win。')
  }
}

// Only recognized build artifacts are removed. Keep unrelated files and never follow links.
export async function cleanReleaseArtifacts(destination, { onWarning = console.warn, remove = rm } = {}) {
  const absolute = path.resolve(destination)
  if (absolute === path.parse(absolute).root) throw new Error(`Refusing to clean a filesystem root: ${absolute}`)
  const directory = await lstat(absolute)
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error(`Output must be a real directory: ${absolute}`)
  const resolved = await realpath(absolute)
  const removed = [], skipped = []
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const target = path.join(absolute, entry.name)
    if (!isInside(absolute, target) || entry.isSymbolicLink()) continue
    if (entry.isFile() && (installerPattern.test(entry.name) || sidecarPattern.test(entry.name))) {
      try { await remove(target) }
      catch (error) { throw new Error(`Cannot remove old installer ${target}. Close any running installer or application holding it.`, { cause: error }) }
      removed.push(entry.name)
    } else if (entry.isDirectory() && unpackedPattern.test(entry.name)) {
      const actual = await realpath(target)
      if (!isInside(resolved, actual)) throw new Error(`Refusing to remove an unpacked directory outside output: ${actual}`)
      try {
        await remove(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 })
        removed.push(entry.name)
      } catch (error) {
        skipped.push(entry.name)
        onWarning(`旧构建目录被占用，暂时保留，不影响新包生成：${target} (${error.code ?? error.message})`)
      }
    }
  }
  return { removed, skipped }
}

export async function publishArtifacts(staging, destination) {
  if (path.resolve(staging) === path.resolve(destination)) throw new Error('Staging and release directories must be different.')
  const entries = await readdir(staging, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  if (!files.some((name) => installerPattern.test(name))) {
    throw new Error('No installer was produced; this packaging command requires an installer target.')
  }
  await mkdir(destination, { recursive: true })
  // Do this only after a new build succeeded, so a failed build retains the last working installer.
  try {
    const { removed } = await cleanReleaseArtifacts(destination)
    if (removed.length) console.log(`Cleared ${removed.length} old release artifacts.`)
  } catch (error) {
    throw new Error(`${error.message} Finished build retained at ${staging}.`, { cause: error })
  }
  const published = []
  for (const name of files) {
    const target = path.join(destination, name)
    try { await copyFile(path.join(staging, name), target) }
    catch (error) {
      throw new Error(`Cannot publish ${target}. Close any running installer using this file. Finished build retained at ${staging}.`, { cause: error })
    }
    published.push(target)
  }
  return published
}

export async function packageApp(args = process.argv.slice(2)) {
  assertBuildHost(args)
  const pkg = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const destination = resolveOutputDirectory(projectRoot, pkg.build?.directories?.output ?? 'release')
  const temporaryRoot = path.resolve(os.tmpdir())
  const prefix = `${pkg.name.replace(/[^a-z0-9-]/gi, '-')}-pack-`
  const staging = await mkdtemp(path.join(temporaryRoot, prefix))
  const relative = path.relative(projectRoot, staging)
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    throw new Error('The system temporary directory is inside this project. Set TEMP/TMP to a directory outside the workspace before packaging.')
  }
  console.log(`Packaging outside the workspace: ${staging}`)
  const cli = require.resolve('electron-builder/cli.js')
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, `--config.directories.output=${staging}`], {
      cwd: projectRoot, stdio: 'inherit', shell: false, windowsHide: true,
      env: { ...process.env, ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR ?? 'https://cdn.npmmirror.com/binaries/electron-builder-binaries/' },
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  if (result.code !== 0) {
    throw new Error(`electron-builder failed (${result.signal ?? result.code}). Diagnostic output retained at ${staging}`)
  }
  await mkdir(destination, { recursive: true })
  const actualOutput = await realpath(destination)
  if (!isInside(await realpath(projectRoot), actualOutput)) {
    throw new Error(`Output resolves outside the workspace: ${actualOutput}. Finished build retained at ${staging}`)
  }
  const published = await publishArtifacts(staging, destination)
  console.log(`\nFinished packages:\n${published.map((file) => `  ${file}`).join('\n')}`)
  // Delete only the unique temporary directory created by this invocation.
  if (path.dirname(staging) !== temporaryRoot || !path.basename(staging).startsWith(prefix)) {
    throw new Error(`Refusing to clean an unexpected staging directory: ${staging}`)
  }
  try { await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }) }
  catch (error) { console.warn(`Package created; temporary files could not be removed: ${staging} (${error.message})`) }
  return published
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  packageApp().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
