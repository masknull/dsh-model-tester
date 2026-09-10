/**
 * dsh-model-tester — host half.
 *
 * Serves two authenticated HTTP routes for the browser panel registered into
 * the Models settings page (`settings.models.footer`):
 *   GET  /model-tester/list  — every configurable provider joined with its
 *                              configured/active state and its model list
 *                              (user models from settings, adapter catalog
 *                              fallback via llm.listModels)
 *   POST /model-tester/test  — one real streaming call (llm.stream) against
 *                              {provider, model}, returning availability,
 *                              TPS, first-token latency, and total elapsed
 *
 * Requests are gated through the client-connection service's requestRejection,
 * the same trust boundary open-in-app uses for its routes.
 */

export const name = 'model-tester'

export const inject = ['llm', 'settings', 'timer', 'webServer', 'connection']

const TIMEOUT_MS = 30000
const MAX_BODY_BYTES = 65536
const LIST_ROUTE = '/model-tester/list'
const TEST_ROUTE = '/model-tester/test'

const errorText = (error) => {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

const sendJson = (res, status, value) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

const readBoundedBody = (req) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      reject(new Error('request body too large'))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  req.on('error', reject)
})

export function apply(ctx) {
  const llm = ctx.llm
  const settings = ctx.settings
  const connection = ctx.connection

  const profileAt = (settingsNs, settingsPath) => {
    if (typeof settingsNs !== 'string' || settingsNs.length === 0) return undefined
    let profile
    try {
      profile = settings.get(settingsNs)
    } catch (error) {
      return undefined
    }
    const path = Array.isArray(settingsPath) ? settingsPath : []
    for (const key of path) {
      if (profile !== null && typeof profile === 'object') profile = profile[key]
      else return undefined
    }
    return profile !== null && typeof profile === 'object' ? profile : undefined
  }

  const normalizeModelList = (value) => {
    if (!Array.isArray(value)) return []
    const out = []
    for (const m of value) {
      if (m === null || typeof m !== 'object') continue
      if (typeof m.id !== 'string' || m.id.length === 0) continue
      out.push({ id: m.id, name: typeof m.name === 'string' && m.name.length > 0 ? m.name : m.id })
    }
    return out
  }

  const modelsFor = async (entry, activeSet) => {
    const profile = profileAt(entry.settingsNs, entry.settingsPath)
    if (profile !== undefined && Array.isArray(profile.models) && profile.models.length > 0) {
      return normalizeModelList(profile.models)
    }
    if (activeSet.has(entry.provider)) {
      try {
        return normalizeModelList(await llm.listModels(entry.provider))
      } catch (error) {
        return []
      }
    }
    return []
  }

  const listRows = async () => {
    const registeredRaw = llm.listProviders()
    const registered = Array.isArray(registeredRaw) ? registeredRaw : []
    const activeSet = new Set()
    for (const p of registered) {
      if (p !== null && typeof p === 'object' && typeof p.id === 'string' && p.id.length > 0) activeSet.add(p.id)
    }
    const directoryRaw = llm.listConfigurableProviders()
    const directory = Array.isArray(directoryRaw) ? directoryRaw : []
    const seen = new Set()
    const rows = []
    for (const entry of directory) {
      if (entry === null || typeof entry !== 'object' || typeof entry.provider !== 'string' || entry.provider.length === 0) continue
      seen.add(entry.provider)
      const path = Array.isArray(entry.settingsPath) ? entry.settingsPath : []
      const ns = typeof entry.settingsNs === 'string' ? entry.settingsNs : ''
      const models = await modelsFor(entry, activeSet)
      rows.push({
        provider: entry.provider,
        displayName: typeof entry.displayName === 'string' && entry.displayName.length > 0 ? entry.displayName : entry.provider,
        settingsNs: ns,
        active: activeSet.has(entry.provider),
        configured: activeSet.has(entry.provider) || profileAt(ns, path) !== undefined,
        configError: typeof entry.error === 'string' && entry.error.length > 0 ? entry.error : null,
        models,
      })
    }
    for (const p of registered) {
      if (p === null || typeof p !== 'object' || typeof p.id !== 'string' || seen.has(p.id)) continue
      let models = []
      try {
        models = normalizeModelList(await llm.listModels(p.id))
      } catch (error) {
        models = []
      }
      rows.push({
        provider: p.id,
        displayName: typeof p.name === 'string' && p.name.length > 0 ? p.name : p.id,
        settingsNs: '',
        active: true,
        configured: true,
        configError: null,
        models,
      })
    }
    return rows
  }

  const testOne = async (provider, model) => {
    const started = Date.now()
    let outputTokens = null
    let firstTokenAt = null
    let finishAt = null
    let failure = null
    let finishKind = null

    const consume = async () => {
      const stream = llm.stream({
        provider,
        model,
        messages: [{
          id: '00000000-0000-4000-8000-000000000001',
          role: 'user',
          content: [{ type: 'text', text: '连通性测试：请只回复 ok' }],
          source: { kind: 'user' },
        }],
        maxTokens: 16,
      })
      const iterator = stream[Symbol.asyncIterator]()
      try {
        for (;;) {
          const step = await iterator.next()
          if (step.done === true) break
          const chunk = step.value
          if (chunk === null || typeof chunk !== 'object') continue
          if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
            if (firstTokenAt === null) firstTokenAt = Date.now()
          } else if (chunk.type === 'usage' && chunk.usage !== null && typeof chunk.usage === 'object') {
            if (typeof chunk.usage.outputTokens === 'number') outputTokens = chunk.usage.outputTokens
          } else if (chunk.type === 'finish') {
            finishAt = Date.now()
            const reason = chunk.reason !== null && typeof chunk.reason === 'object' ? chunk.reason : {}
            finishKind = typeof reason.kind === 'string' ? reason.kind : 'stop'
            const f = reason.failure !== null && typeof reason.failure === 'object' ? reason.failure : null
            if (finishKind === 'error' || finishKind === 'aborted') {
              failure = {
                message: f !== null && typeof f.message === 'string' && f.message.length > 0 ? f.message : '未知的提供方失败',
                code: f !== null && typeof f.code === 'string' ? f.code : 'UNKNOWN',
                status: f !== null && typeof f.status === 'number' ? f.status : null,
              }
            }
            break
          }
        }
      } finally {
        if (typeof iterator.return === 'function') {
          try { await iterator.return() } catch (error) { /* closing a settled stream is best effort */ }
        }
      }
    }

    let outcome
    try {
      outcome = await Promise.race([
        consume().then(() => ({ timedOut: false, thrown: null })).catch((error) => ({ timedOut: false, thrown: error })),
        ctx.timeout(TIMEOUT_MS).then(() => ({ timedOut: true, thrown: null })),
      ])
    } catch (error) {
      outcome = { timedOut: false, thrown: error }
    }

    const latencyMs = Date.now() - started
    if (outcome !== null && typeof outcome === 'object' && outcome.timedOut === true) {
      return { ok: false, latencyMs, failure: { message: '测试超时：' + (TIMEOUT_MS / 1000) + ' 秒内无响应', code: 'TIMEOUT', status: null } }
    }
    const thrown = outcome !== null && typeof outcome === 'object' ? outcome.thrown : null
    if (thrown !== null && thrown !== undefined) {
      return { ok: false, latencyMs, failure: { message: errorText(thrown), code: 'CONSUMER_ERROR', status: null } }
    }
    if (failure !== null) {
      return { ok: false, latencyMs, failure }
    }
    if (finishKind === null) {
      return { ok: false, latencyMs, failure: { message: '模型流未返回结束原因', code: 'NO_FINISH', status: null } }
    }
    const ttftMs = firstTokenAt !== null ? firstTokenAt - started : null
    const elapsedMs = finishAt !== null ? finishAt - started : latencyMs
    let tps = null
    if (firstTokenAt !== null && finishAt !== null && typeof outputTokens === 'number' && outputTokens >= 0) {
      const decodeMs = finishAt - firstTokenAt
      if (decodeMs > 0) tps = Math.round((outputTokens / (decodeMs / 1000)) * 10) / 10
      else tps = outputTokens
    }
    return { ok: true, tps, ttftMs, elapsedMs, outputTokens }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LIST_ROUTE,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        sendJson(res, rejection, { code: 'unauthorized', message: 'unauthorized' })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { code: 'method-not-allowed', message: 'GET only' })
        return
      }
      try {
        sendJson(res, 200, { rows: await listRows() })
      } catch (error) {
        sendJson(res, 500, { code: 'list-failed', message: errorText(error) })
      }
    },
  }), 'model-tester: GET ' + LIST_ROUTE)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TEST_ROUTE,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        sendJson(res, rejection, { code: 'unauthorized', message: 'unauthorized' })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { code: 'method-not-allowed', message: 'POST only' })
        return
      }
      const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') {
        sendJson(res, 415, { code: 'unsupported-media-type', message: 'content-type must be application/json' })
        return
      }
      let args = null
      try {
        args = JSON.parse(await readBoundedBody(req))
      } catch (error) {
        sendJson(res, 400, { code: 'bad-request', message: errorText(error) })
        return
      }
      const provider = args !== null && typeof args === 'object' && typeof args.provider === 'string' ? args.provider : ''
      const model = args !== null && typeof args === 'object' && typeof args.model === 'string' ? args.model : ''
      if (provider.length === 0 || model.length === 0) {
        sendJson(res, 400, { ok: false, latencyMs: 0, failure: { message: '无效的请求参数', code: 'BAD_REQUEST', status: null } })
        return
      }
      try {
        sendJson(res, 200, await testOne(provider, model))
      } catch (error) {
        sendJson(res, 500, { ok: false, latencyMs: 0, failure: { message: errorText(error), code: 'ROUTE_ERROR', status: null } })
      }
    },
  }), 'model-tester: POST ' + TEST_ROUTE)
}
