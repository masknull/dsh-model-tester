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

// 测试模式：quick 为连通性探测；throughput 用长输出测真实吞吐。
// 两者都刻意不传 maxTokens：请求侧的输出上限会与推理模型的思维链开销争抢同一份额度，
// 导致上游以 `response incomplete: max_output_tokens` 提前截断（偶发、且随模型而异的假失败）。
// 省略该参数后由服务端使用自身默认额度，探活结果才反映真实可用性。
const MODES = {
  quick: {
    prompt: '连通性测试：请只回复 ok',
  },
  throughput: {
    prompt: '请从 1 一直数到 200，用阿拉伯数字以逗号分隔连续输出，不要解释，不要提前停止。',
  },
}

const clampTimeoutMs = (value) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : TIMEOUT_MS
  return Math.min(Math.max(n, 5000), 120000)
}

const clampRetries = (value) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
  return Math.min(Math.max(n, 0), 2)
}

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

  /** One request-scoped `describe()` snapshot; undefined until first read. */
  let describeSnapshot

  /**
   * Read one namespace's configuration, on either host line.
   *
   * 0.1.5 keeps the old `settings.get(ns)` entry, which is exactly "this
   * namespace's user layer". DSH 0.1.7-alpha.1 removed it (the host's settings
   * service no longer exposes the old read interface, so a caller falls silent
   * to empty — a custom model channel's models then read as none). The
   * replacement is `describe()`, which returns one descriptor per profile
   * entry keyed by `entry.options.id`; pi-ai and deepseek register their
   * provider-directory rows with that same id as `settingsNs`, so the lookup
   * is by name.
   *
   * `user` is read rather than `value` on purpose: `value` is the live value
   * including schema defaults, which would mark every never-configured
   * provider as configured, while `settings.get` used to answer with the
   * user's own layer only.
   */
  const profileAt = (settingsNs, settingsPath) => {
    if (typeof settingsNs !== 'string' || settingsNs.length === 0) return undefined
    let profile
    try {
      if (typeof settings.get === 'function') {
        profile = settings.get(settingsNs)
      } else if (typeof settings.describe === 'function') {
        if (describeSnapshot === undefined) {
          let rows = null
          try {
            const raw = settings.describe()
            if (Array.isArray(raw)) rows = raw
          } catch (error) {
            rows = null
          }
          describeSnapshot = rows
        }
        const row = describeSnapshot === null
          ? undefined
          : describeSnapshot.find((entry) => entry !== null && typeof entry === 'object' && entry.ns === settingsNs)
        profile = row === undefined
          ? undefined
          : row.user !== undefined && row.user !== null ? row.user : row.value
      }
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

  /** Drop the request-scoped snapshot so a later request sees fresh settings. */
  const resetDescribeSnapshot = () => { describeSnapshot = undefined }

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
    // A fresh snapshot per request: rows must reflect the settings as they are
    // now, not as they were during an earlier panel refresh.
    resetDescribeSnapshot()
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

  const attemptOnce = async (provider, model, conf, timeoutMs) => {
    const started = Date.now()
    let outputTokens = null
    let firstTokenAt = null
    let finishAt = null
    let failure = null
    let finishKind = null

    const stream = llm.stream({
      provider,
      model,
      messages: [{
        id: '00000000-0000-4000-8000-000000000001',
        role: 'user',
        content: [{ type: 'text', text: conf.prompt }],
        source: { kind: 'user' },
      }],
      // 刻意不传 maxTokens：DSH 在 undefined 时完全省略该键（adapter.ts 的展开守卫），
      // 上游因此使用自身默认额度。传任何值都会经 pi-ai 的 Math.max(v, 16) 下发 max_output_tokens，
      // 小额度与推理模型的思维链开销争抢同一份额度，导致 response incomplete (max_output_tokens)。
    })
    // iterator 提到 consume 之外：超时中止时需要从外层访问
    const iterator = stream[Symbol.asyncIterator]()

    const consume = async () => {
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
              break
            }
            // 正常结束不在此处 break：usage 帧可能排在 finish 之后，提前退出会把
            // outputTokens 丢成 null（TPS 误显示 '—'）；让循环等流自然 done
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
        ctx.timeout(timeoutMs).then(() => ({ timedOut: true, thrown: null })),
      ])
    } catch (error) {
      outcome = { timedOut: false, thrown: error }
    }

    const latencyMs = Date.now() - started
    if (outcome !== null && typeof outcome === 'object' && outcome.timedOut === true) {
      // 超时后尽力中止底层流，避免该请求在后台继续跑完整个生成（资源泄漏）
      if (typeof iterator.return === 'function') {
        Promise.resolve().then(() => iterator.return()).catch(() => {})
      }
      return { ok: false, latencyMs, failure: { message: '测试超时：' + (timeoutMs / 1000) + ' 秒内无响应', code: 'TIMEOUT', status: null } }
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
      // decode 窗口过短（响应一次性到达、无增量流）时无法测得有效速率：
      // 原实现会退化成把 outputTokens 计数直接当 tok/s 显示（如 8000.0），此处改为显示 '—'
      if (decodeMs >= 50) tps = Math.round((outputTokens / (decodeMs / 1000)) * 10) / 10
    }
    // 不再回传 maxTokens：测试请求刻意不下发该参数，上游额度由服务端决定
    return { ok: true, tps, ttftMs, elapsedMs, outputTokens }
  }

  // 失败自动重试：偶发超时/抖动不直接判死刑；每次尝试独立计时、独立超时
  const testOne = async (provider, model, opts = {}) => {
    const isThroughput = opts !== null && typeof opts === 'object' && opts.mode === 'throughput'
    const conf = isThroughput ? MODES.throughput : MODES.quick
    const timeoutMs = clampTimeoutMs(opts !== null && typeof opts === 'object' ? opts.timeoutMs : undefined)
    const maxAttempts = clampRetries(opts !== null && typeof opts === 'object' ? opts.retries : undefined) + 1
    let attempts = 0
    let last = null
    for (;;) {
      attempts += 1
      last = await attemptOnce(provider, model, conf, timeoutMs)
      if (last !== null && typeof last === 'object' && last.ok === true) break
      if (attempts >= maxAttempts) break
    }
    return { ...(last || {}), mode: isThroughput ? 'throughput' : 'quick', attempts }
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
        sendJson(res, 200, await testOne(provider, model, args !== null && typeof args === 'object' ? args : {}))
      } catch (error) {
        sendJson(res, 500, { ok: false, latencyMs: 0, failure: { message: errorText(error), code: 'ROUTE_ERROR', status: null } })
      }
    },
  }), 'model-tester: POST ' + TEST_ROUTE)
}
