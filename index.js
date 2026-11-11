/**
 * Host half of the Obsidian canvas bundle: authenticated Web routes that save
 * a `.canvas` file, list the files of its vault, and serve one vault file for
 * embedding. Every route applies the Connection's Host/Origin checks and
 * browser authentication before touching the filesystem.
 *
 * The vault root of a canvas is its nearest ancestor directory holding
 * `.obsidian`, otherwise its nearest ancestor holding `.git`, otherwise the
 * canvas's own directory. File nodes resolve their vault-relative `file`
 * against that root and may not leave it.
 */
import { lstat, open, readdir, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

export const inject = ['webServer', 'connection']

/** Route pathnames; the browser addresses them without the leading slash. */
const SAVE_PATH = '/obsidian-canvas/save'
const VAULT_PATH = '/obsidian-canvas/vault'
const FILE_PATH = '/obsidian-canvas/file'

/** Configuration defaults; each field can be overridden in the row's `config`. */
const DEFAULTS = {
  /** Largest canvas document the save route accepts, in bytes. */
  maxCanvasBytes: 32 * 1024 * 1024,
  /** Largest embedded file the file route serves, in bytes. */
  maxFileBytes: 64 * 1024 * 1024,
  /** Most files the vault listing returns. */
  maxVaultFiles: 5000,
}

/** Directories never descended by the vault listing. */
const SKIPPED_DIRECTORIES = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.venv', '__pycache__'])

const MEDIA_TYPES = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  canvas: 'application/json; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  pdf: 'application/pdf',
}

/**
 * Validate the row's configuration, filling omitted fields.
 * @param {unknown} config - row `config`, possibly undefined.
 * @returns {typeof DEFAULTS} the resolved limits.
 */
function resolveConfig(config) {
  const resolved = { ...DEFAULTS }
  if (config === undefined || config === null) return resolved
  if (typeof config !== 'object') throw new Error('obsidian-canvas: config must be an object')
  for (const [key, value] of Object.entries(config)) {
    if (!(key in DEFAULTS)) throw new Error(`obsidian-canvas: unknown config field "${key}"`)
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`obsidian-canvas: config.${key} must be a positive integer`)
    resolved[key] = value
  }
  return resolved
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function sendError(res, status, code, message) {
  sendJson(res, status, { code, message })
}

/**
 * Collect a request body up to a byte ceiling.
 * @returns {Promise<string | null>} UTF-8 text, or null past the ceiling.
 */
async function readBoundedBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > limit) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

function queryOf(req) {
  return new URL(String(req.url), 'http://localhost').searchParams
}

/**
 * Resolve an absolute `.canvas` path to its real location.
 * @returns {Promise<string>} the real path of an existing regular `.canvas` file.
 */
async function realCanvasPath(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw httpError(400, 'bad-request', 'canvas path must be absolute')
  if (!candidate.toLowerCase().endsWith('.canvas')) throw httpError(400, 'bad-request', 'path must name a .canvas file')
  let real
  try {
    real = await realpath(candidate)
  } catch (error) {
    throw httpError(404, 'not-found', `canvas not found: ${candidate} (${error.code ?? error.message})`)
  }
  if (!real.toLowerCase().endsWith('.canvas')) throw httpError(400, 'bad-request', 'path must resolve to a .canvas file')
  const info = await stat(real)
  if (!info.isFile()) throw httpError(400, 'bad-request', 'canvas path is not a regular file')
  return real
}

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

async function isDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory()
  } catch (_error) {
    // A missing or unreadable marker means this ancestor is not a vault root.
    return false
  }
}

/**
 * Find the vault root of a canvas file.
 * @param {string} canvas - real canvas path.
 * @returns {Promise<string>} the vault root directory.
 */
async function vaultRootOf(canvas) {
  const start = path.dirname(canvas)
  for (const marker of ['.obsidian', '.git']) {
    let directory = start
    for (;;) {
      if (await isDirectory(path.join(directory, marker))) return directory
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return start
}

/**
 * Resolve a vault-relative file inside the vault root.
 * @returns {Promise<string>} the real path of an existing regular file inside the root.
 */
async function vaultFile(root, relative) {
  if (typeof relative !== 'string' || relative.length === 0) throw httpError(400, 'bad-request', 'file must be a non-empty string')
  const resolved = path.resolve(root, relative.replace(/^\/+/, ''))
  let real
  try {
    real = await realpath(resolved)
  } catch (_error) {
    // A missing file is the ordinary "File not found" card, not a server fault.
    throw httpError(404, 'not-found', `file not found: ${relative}`)
  }
  const realRoot = await realpath(root)
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw httpError(403, 'forbidden', 'file is outside the vault')
  const info = await stat(real)
  if (!info.isFile()) throw httpError(404, 'not-found', `not a file: ${relative}`)
  return real
}

/**
 * List vault files breadth first, skipping hidden and dependency directories.
 * @returns {Promise<{ files: string[], truncated: boolean }>} `/`-separated vault-relative paths.
 */
async function listVault(root, limit) {
  const files = []
  const queue = ['']
  while (queue.length > 0) {
    const relative = queue.shift()
    let entries
    try {
      entries = await readdir(path.join(root, relative), { withFileTypes: true })
    } catch (_error) {
      // An unreadable directory contributes no files; the rest of the vault still lists.
      continue
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) queue.push(child)
      } else if (entry.isFile() && !entry.name.startsWith('.')) {
        files.push(child)
        if (files.length >= limit) return { files, truncated: true }
      }
    }
  }
  return { files, truncated: false }
}

/**
 * Replace a file's contents through a sibling temporary file and rename.
 * @param {string} target - real path of the existing file.
 * @param {string} text - complete new contents.
 */
async function writeAtomically(target, text) {
  const info = await lstat(target)
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
  const handle = await open(temporary, 'wx', info.mode & 0o777)
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

/**
 * Check that text is a JSON Canvas document before it replaces a file.
 * @returns {string | undefined} a rejection message, or undefined when valid.
 */
function canvasRejection(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    return `text is not JSON: ${error.message}`
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return 'canvas must be a JSON object'
  if (data.nodes !== undefined && !Array.isArray(data.nodes)) return 'nodes must be an array'
  if (data.edges !== undefined && !Array.isArray(data.edges)) return 'edges must be an array'
  return undefined
}

/** Register the save, vault, and file routes. */
export function apply(ctx, config) {
  const limits = resolveConfig(config)

  /** Wrap a handler with the trust fence, a method check, and typed failures. */
  const route = (method, handler) => async (req, res) => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if (req.method !== method) {
      res.statusCode = 405
      res.setHeader('allow', method)
      res.end()
      return
    }
    try {
      await handler(req, res)
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error)
        return
      }
      if (typeof error.status === 'number') sendError(res, error.status, error.code, error.message)
      else sendError(res, 500, 'internal', error.message)
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SAVE_PATH,
    handler: route('POST', async (req, res) => {
      const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') throw httpError(415, 'unsupported-media-type', 'content-type must be application/json')
      const body = await readBoundedBody(req, limits.maxCanvasBytes + 64 * 1024)
      if (body === null) throw httpError(413, 'payload-too-large', `canvas exceeds ${limits.maxCanvasBytes} bytes`)
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch (_error) {
        // The request envelope is malformed; the status names the fault.
        throw httpError(400, 'bad-request', 'request body must be JSON')
      }
      if (typeof parsed?.path !== 'string' || typeof parsed?.text !== 'string') {
        throw httpError(400, 'bad-request', 'request body needs string "path" and "text"')
      }
      const rejection = canvasRejection(parsed.text)
      if (rejection !== undefined) throw httpError(422, 'invalid-canvas', rejection)
      const target = await realCanvasPath(parsed.path)
      await writeAtomically(target, parsed.text)
      const info = await stat(target)
      sendJson(res, 200, { path: target, bytes: info.size, mtimeMs: info.mtimeMs })
    }),
  }), `obsidian-canvas: POST ${SAVE_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: VAULT_PATH,
    handler: route('GET', async (req, res) => {
      const canvas = await realCanvasPath(queryOf(req).get('canvas'))
      const root = await vaultRootOf(canvas)
      const listing = await listVault(root, limits.maxVaultFiles)
      sendJson(res, 200, { root, canvas: path.relative(root, canvas).split(path.sep).join('/'), ...listing })
    }),
  }), `obsidian-canvas: GET ${VAULT_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FILE_PATH,
    handler: route('GET', async (req, res) => {
      const query = queryOf(req)
      const canvas = await realCanvasPath(query.get('canvas'))
      const root = await vaultRootOf(canvas)
      const target = await vaultFile(root, query.get('file'))
      const info = await stat(target)
      if (info.size > limits.maxFileBytes) throw httpError(413, 'payload-too-large', `file exceeds ${limits.maxFileBytes} bytes`)
      const extension = path.extname(target).slice(1).toLowerCase()
      const bytes = await readFile(target)
      res.statusCode = 200
      res.setHeader('content-type', MEDIA_TYPES[extension] ?? 'application/octet-stream')
      res.setHeader('cache-control', 'no-store')
      res.setHeader('x-content-type-options', 'nosniff')
      if (extension === 'svg') res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      res.end(bytes)
    }),
  }), `obsidian-canvas: GET ${FILE_PATH}`)
}
