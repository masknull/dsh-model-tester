/**
 * dsh-model-tester — browser half.
 *
 * Hand-written closure-factory bundle following the dsh client bundle contract
 * (the same artifact shape packages/client/tsdown.client.ts emits): the bundle
 * registers a factory under window.__ModuleLoader__ and resolves externals
 * through the injected require (module table — react is a platform module).
 *
 * Registers the tester panel into the `settings.models.footer` slot of the
 * Models settings page and talks to the host half over its authenticated
 * HTTP routes (/model-tester/list, /model-tester/test).
 */
window.__ModuleLoader__.load({ id: 'dsh-model-tester', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const React = require('react')
const el = React.createElement

const CSS = [
  '.mt-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px;margin:10px 0 4px;font-size:13px;color:var(--dsw-alias-label-primary);}',
  '.mt-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}',
  '.mt-title{font-weight:600;font-size:13px;}',
  '.mt-actions{display:flex;gap:8px;}',
  '.mt-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;}',
  '.mt-btn:disabled{opacity:0.5;cursor:default;}',
  '.mt-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);}',
  '.mt-summary{margin-top:8px;color:var(--dsw-alias-label-secondary);}',
  '.mt-progress{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);margin-top:8px;overflow:hidden;}',
  '.mt-progress-bar{height:100%;background:var(--dsw-alias-brand-primary);transition:width 0.2s;}',
  '.mt-provider{margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);}',
  '.mt-provider-head{display:flex;align-items:center;gap:8px;font-weight:600;flex-wrap:wrap;}',
  '.mt-badge{font-size:11px;font-weight:500;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary);}',
  '.mt-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);}',
  '.mt-model{display:flex;align-items:center;gap:10px;padding:4px 0 4px 2px;flex-wrap:wrap;}',
  '.mt-model-id{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;}',
  '.mt-model-name{color:var(--dsw-alias-label-secondary);font-size:12px;}',
  '.mt-chip{font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);}',
  '.mt-chip-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}',
  '.mt-chip-fail{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}',
  '.mt-chip-running{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}',
  '.mt-metric{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;}',
  '.mt-detail{font-size:12px;color:var(--dsw-alias-state-error-primary);word-break:break-all;flex-basis:100%;}',
  '.mt-retest{margin-left:auto;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;font-size:12px;font-weight:600;padding:4px 16px;cursor:pointer;white-space:nowrap;}',
  '.mt-retest:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
  '.mt-retest:disabled{opacity:0.4;cursor:default;}',
  '.mt-error{color:var(--dsw-alias-state-error-primary);margin-top:8px;}',
  '.mt-empty{color:var(--dsw-alias-label-secondary);margin-top:8px;}',
].join('\n')

const STATUS_CHIP = {
  pending: ['mt-chip', '待测'],
  running: ['mt-chip mt-chip-running', '测试中'],
  ok: ['mt-chip mt-chip-ok', '可用'],
  fail: ['mt-chip mt-chip-fail', '失败'],
}

const errorText = (error) => {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

const keyOf = (provider, model) => provider + '\u0000' + model

const isHiddenModel = (m) => {
  const id = typeof m.id === 'string' ? m.id.toLowerCase() : ''
  const name = typeof m.name === 'string' ? m.name.toLowerCase() : ''
  return id.includes('vision') || name.includes('vision')
}

const callRoute = async (path, init) => {
  let res
  try {
    res = await fetch(path, init)
  } catch (error) {
    throw new Error('网络请求失败：' + errorText(error))
  }
  const text = await res.text()
  let value = null
  try { value = JSON.parse(text) } catch (error) { /* non-JSON body */ }
  if (!res.ok) {
    const message = value !== null && typeof value === 'object' && value.failure !== null && typeof value.failure === 'object'
      ? value.failure.message
      : (value !== null && typeof value === 'object' && typeof value.message === 'string' ? value.message : text.slice(0, 200))
    throw new Error('HTTP ' + res.status + '：' + message)
  }
  if (value === null || typeof value !== 'object') throw new Error('响应不是 JSON 对象')
  return value
}

const callList = async () => callRoute('/model-tester/list')
const callTest = async (provider, model) => callRoute('/model-tester/test', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ provider, model }),
})

function ModelTesterPanel() {
  const [state, setState] = React.useState({ phase: 'loading', rows: [], error: null })
  const [results, setResults] = React.useState({})
  const [running, setRunning] = React.useState(false)
  const [progress, setProgress] = React.useState({ done: 0, total: 0 })

  const refresh = async () => {
    setState({ phase: 'loading', rows: [], error: null })
    setResults({})
    try {
      const value = await callList()
      const rawRows = value !== null && typeof value === 'object' && Array.isArray(value.rows) ? value.rows : []
      const rows = []
      for (const row of rawRows) {
        if (row === null || typeof row !== 'object') continue
        if (row.active !== true || row.configured !== true) continue
        const models = (Array.isArray(row.models) ? row.models : []).filter((m) => !isHiddenModel(m))
        if (models.length === 0) continue
        rows.push({ ...row, models })
      }
      setState({ phase: 'ready', rows, error: null })
    } catch (error) {
      setState({ phase: 'error', rows: [], error: errorText(error) })
    }
  }

  React.useEffect(() => { refresh() }, [])

  const applyResult = (key, patch) => {
    setResults((prev) => ({ ...prev, [key]: { ...(prev[key] || { status: 'pending' }), ...patch } }))
  }

  const testOne = async (provider, model) => {
    const key = keyOf(provider, model)
    applyResult(key, { status: 'running' })
    let value
    try {
      value = await callTest(provider, model)
    } catch (error) {
      value = { ok: false, failure: { message: errorText(error), code: 'HTTP_ERROR', status: null } }
    }
    applyResult(key, value !== null && typeof value === 'object' && value.ok === true
      ? { status: 'ok', result: value }
      : { status: 'fail', result: value })
  }

  const runAll = async () => {
    if (running) return
    const items = []
    for (const row of state.rows) {
      for (const m of row.models) items.push({ provider: row.provider, model: m.id })
    }
    if (items.length === 0) return
    setRunning(true)
    setProgress({ done: 0, total: items.length })
    setResults(() => {
      const next = {}
      for (const item of items) next[keyOf(item.provider, item.model)] = { status: 'pending' }
      return next
    })
    let index = 0
    let done = 0
    const worker = async () => {
      for (;;) {
        const current = index
        index += 1
        if (current >= items.length) return
        const item = items[current]
        const key = keyOf(item.provider, item.model)
        applyResult(key, { status: 'running' })
        let value
        try {
          value = await callTest(item.provider, item.model)
        } catch (error) {
          value = { ok: false, failure: { message: errorText(error), code: 'HTTP_ERROR', status: null } }
        }
        applyResult(key, value !== null && typeof value === 'object' && value.ok === true
          ? { status: 'ok', result: value }
          : { status: 'fail', result: value })
        done += 1
        setProgress({ done, total: items.length })
      }
    }
    const limit = Math.min(3, items.length)
    await Promise.all(Array.from({ length: limit }, () => worker()))
    setRunning(false)
  }

  const totalModels = state.rows.reduce((n, row) => n + row.models.length, 0)
  let okCount = 0
  let failCount = 0
  for (const row of state.rows) {
    for (const m of row.models) {
      const r = results[keyOf(row.provider, m.id)]
      if (r !== undefined && r.status === 'ok') okCount += 1
      else if (r !== undefined && r.status === 'fail') failCount += 1
    }
  }

  const children = []
  children.push(el('div', { className: 'mt-head', key: 'head' },
    el('div', { className: 'mt-title', key: 't' }, '模型可用性测试'),
    el('div', { className: 'mt-actions', key: 'a' },
      el('button', {
        className: 'mt-btn', key: 'refresh',
        disabled: running || state.phase === 'loading',
        onClick: () => { refresh() },
      }, '刷新列表'),
      el('button', {
        className: 'mt-btn mt-btn-primary', key: 'run',
        disabled: running || state.phase !== 'ready' || totalModels === 0,
        onClick: () => { runAll() },
      }, running ? ('测试中 ' + progress.done + ' / ' + progress.total) : '一键测试全部'),
    ),
  ))

  if (state.phase === 'loading') {
    children.push(el('div', { className: 'mt-empty', key: 'loading' }, '正在加载模型列表…'))
  }
  if (state.phase === 'error') {
    children.push(el('div', { className: 'mt-error', key: 'err' }, '加载失败：' + state.error))
  }
  if (state.phase === 'ready' && totalModels === 0) {
    children.push(el('div', { className: 'mt-empty', key: 'empty' }, '未发现可测试的模型：请先在上方添加提供方与模型，然后点“刷新列表”。'))
  }
  if (state.phase === 'ready' && totalModels > 0) {
    const tested = okCount + failCount
    const summary = running
      ? ('正在测试 ' + progress.done + ' / ' + progress.total)
      : (tested > 0
        ? ('可用 ' + okCount + ' · 失败 ' + failCount + ' · 共 ' + totalModels + ' 个模型')
        : ('共 ' + totalModels + ' 个模型，点击“一键测试全部”开始'))
    children.push(el('div', { className: 'mt-summary', key: 'summary' }, summary))
    if (running) {
      const pct = progress.total > 0 ? Math.round(progress.done * 100 / progress.total) : 0
      children.push(el('div', { className: 'mt-progress', key: 'progress' },
        el('div', { className: 'mt-progress-bar', style: { width: pct + '%' } })))
    }
    state.rows.forEach((row, rowIndex) => {
      const providerChildren = [
        el('span', { key: 'name' }, row.displayName),
        el('span', { className: 'mt-badge', key: 'pid' }, row.provider),
      ]
      if (typeof row.configError === 'string' && row.configError.length > 0) {
        providerChildren.push(el('span', { className: 'mt-badge mt-badge-warn', key: 'cfgerr', title: row.configError }, '配置异常'))
      }
      const modelChildren = row.models.map((m, modelIndex) => {
        const key = keyOf(row.provider, m.id)
        const r = results[key]
        const status = r !== undefined ? r.status : 'pending'
        const chip = STATUS_CHIP[status] || STATUS_CHIP.pending
        const parts = [el('span', { className: 'mt-model-id', key: 'id' }, m.id)]
        if (m.name !== m.id) parts.push(el('span', { className: 'mt-model-name', key: 'name' }, m.name))
        parts.push(el('span', { className: chip[0], key: 'chip' }, chip[1]))
        if (status === 'ok' && r.result !== undefined) {
          const tps = typeof r.result.tps === 'number' ? r.result.tps.toFixed(1) + ' tok/s' : '—'
          const ttft = typeof r.result.ttftMs === 'number' ? (r.result.ttftMs / 1000).toFixed(2) + ' s' : '—'
          const elapsed = typeof r.result.elapsedMs === 'number' ? (r.result.elapsedMs / 1000).toFixed(2) + ' s' : '—'
          parts.push(el('span', { className: 'mt-metric', key: 'tps' }, tps))
          parts.push(el('span', { className: 'mt-metric', key: 'ttft' }, '首 token ' + ttft))
          parts.push(el('span', { className: 'mt-metric', key: 'elapsed' }, '耗时 ' + elapsed))
        }
        if (status === 'fail' && r.result !== undefined && r.result.failure !== null && r.result.failure !== undefined) {
          const f = r.result.failure
          const text = (typeof f.message === 'string' && f.message.length > 0 ? f.message : '未知失败')
            + ' (' + (typeof f.code === 'string' ? f.code : '?')
            + (typeof f.status === 'number' ? ' · HTTP ' + f.status : '') + ')'
          parts.push(el('span', { className: 'mt-detail', key: 'detail' }, text))
        }
        parts.push(el('button', {
          className: 'mt-retest', key: 'retest', disabled: running,
          onClick: () => { testOne(row.provider, m.id) },
        }, status === 'pending' ? '测试' : '重测'))
        return el('div', { className: 'mt-model', key: rowIndex + '-' + modelIndex }, parts)
      })
      children.push(el('div', { className: 'mt-provider', key: rowIndex + '-' + row.provider },
        el('div', { className: 'mt-provider-head' }, providerChildren),
        modelChildren,
      ))
    })
  }

  return el('div', { className: 'mt-panel' }, children)
}

exports.inject = ['slots']

exports.apply = function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-model-tester'
    tag.dataset.pluginCss = 'dsh-model-tester/panel.css'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'model-tester: panel stylesheet')

  slots.inject('settings.models.footer', () => slots.register(
    { name: 'settings.models.footer', id: 'model-tester-footer' },
    ModelTesterPanel,
  ))
}

return module.exports; } });
