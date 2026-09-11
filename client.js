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
  '.mt-settings{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--dsw-alias-label-secondary);}',
  '.mt-settings label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;}',
  '.mt-settings select,.mt-settings input{font-size:12px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
  '.mt-settings input{width:56px;}',
  '.mt-mode-chip{margin-left:8px;}',
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
const callTest = async (provider, model, opts) => callRoute('/model-tester/test', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(Object.assign({ provider, model }, opts || {})),
})

// 面板设置持久化在 localStorage：测试模式 / 超时秒数 / 失败重试次数
const SETTINGS_KEY = 'dsh-model-tester:settings'

const loadSettings = () => {
  const fallback = { mode: 'quick', timeoutSec: 30, retries: 1 }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (raw === null) return fallback
    const value = JSON.parse(raw)
    if (value === null || typeof value !== 'object') return fallback
    return {
      mode: value.mode === 'throughput' ? 'throughput' : 'quick',
      timeoutSec: typeof value.timeoutSec === 'number' && Number.isFinite(value.timeoutSec)
        ? Math.min(Math.max(Math.round(value.timeoutSec), 5), 120)
        : 30,
      retries: value.retries === 0 || value.retries === 1 || value.retries === 2 ? value.retries : 1,
    }
  } catch (error) {
    return fallback
  }
}

function ModelTesterPanel() {
  const [state, setState] = React.useState({ phase: 'loading', rows: [], error: null })
  const [results, setResults] = React.useState({})
  const [running, setRunning] = React.useState(false)
  const [progress, setProgress] = React.useState({ done: 0, total: 0 })
  const [settings, setSettings] = React.useState(loadSettings)

  const updateSettings = (patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch (error) { /* 存不上就用会话内值 */ }
      return next
    })
  }
  const testOpts = { mode: settings.mode, timeoutMs: settings.timeoutSec * 1000, retries: settings.retries }

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
        // vision 过滤只针对自动注册的条目（settingsNs 为空）；用户显式配置的渠道不隐藏
        const models = (Array.isArray(row.models) ? row.models : []).filter((m) => {
          if (typeof row.settingsNs === 'string' && row.settingsNs.length > 0) return true
          return !isHiddenModel(m)
        })
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
      value = await callTest(provider, model, testOpts)
    } catch (error) {
      value = { ok: false, failure: { message: errorText(error), code: 'HTTP_ERROR', status: null } }
    }
    applyResult(key, value !== null && typeof value === 'object' && value.ok === true
      ? { status: 'ok', result: value }
      : { status: 'fail', result: value })
  }

  const runItems = async (items) => {
    if (items.length === 0) return
    setRunning(true)
    setProgress({ done: 0, total: items.length })
    setResults((prev) => {
      const next = { ...prev }
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
          value = await callTest(item.provider, item.model, testOpts)
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

  const runAll = async () => {
    if (running) return
    const items = []
    for (const row of state.rows) {
      for (const m of row.models) items.push({ provider: row.provider, model: m.id })
    }
    if (items.length === 0) return
    await runItems(items)
  }

  const runChannel = async (row) => {
    if (running) return
    const items = (Array.isArray(row.models) ? row.models : []).map((m) => ({ provider: row.provider, model: m.id }))
    if (items.length === 0) return
    await runItems(items)
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
    el('div', { className: 'mt-title', key: 't' }, '模型可用性测试',
      settings.mode === 'throughput'
        ? el('span', { className: 'mt-chip mt-chip-running mt-mode-chip', key: 'mode-chip' }, '吞吐模式')
        : null),
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

  // 测试选项：模式（快速探测 / 吞吐实测）、超时秒数、失败重试次数；改动即持久化
  children.push(el('div', { className: 'mt-settings', key: 'settings' },
    el('label', { key: 'mode' }, '模式',
      el('select', {
        value: settings.mode,
        disabled: running,
        onChange: (e) => { updateSettings({ mode: e.target.value }) },
      },
        el('option', { value: 'quick' }, '快速探测（16 tok）'),
        el('option', { value: 'throughput' }, '吞吐实测（长输出）'),
      )),
    el('label', { key: 'timeout' }, '超时',
      el('input', {
        type: 'number', min: 5, max: 120, value: settings.timeoutSec, disabled: running,
        onChange: (e) => {
          const n = Math.round(Number(e.target.value))
          updateSettings({ timeoutSec: Number.isFinite(n) && e.target.value !== '' ? Math.min(Math.max(n, 5), 120) : 30 })
        },
      }), '秒'),
    el('label', { key: 'retries' }, '失败重试',
      el('select', {
        value: settings.retries,
        disabled: running,
        onChange: (e) => { updateSettings({ retries: Number(e.target.value) }) },
      },
        el('option', { value: 0 }, '不重试'),
        el('option', { value: 1 }, '1 次'),
        el('option', { value: 2 }, '2 次'),
      )),
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
      providerChildren.push(el('button', {
        className: 'mt-retest', key: 'chan-run',
        disabled: running,
        title: '只测试该渠道下的全部模型',
        onClick: () => { runChannel(row) },
      }, '测试本渠道'))
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
          // 显示输出 token 数：帮助识别 usage 上报异常的渠道（如 16 上限却报 8000）
          if (typeof r.result.outputTokens === 'number') {
            parts.push(el('span', { className: 'mt-metric', key: 'toks' }, '输出 ' + r.result.outputTokens + ' tok'))
          }
        }
        if (status === 'fail' && r.result !== undefined && r.result.failure !== null && r.result.failure !== undefined) {
          const f = r.result.failure
          const tries = typeof r.result.attempts === 'number' && r.result.attempts > 1
            ? ' · 已测 ' + r.result.attempts + ' 次'
            : ''
          const text = (typeof f.message === 'string' && f.message.length > 0 ? f.message : '未知失败')
            + ' (' + (typeof f.code === 'string' ? f.code : '?')
            + (typeof f.status === 'number' ? ' · HTTP ' + f.status : '') + ')' + tries
          parts.push(el('span', { className: 'mt-detail', key: 'detail' }, text))
        }
        parts.push(el('button', {
          className: 'mt-retest', key: 'retest', disabled: running || status === 'running',
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
