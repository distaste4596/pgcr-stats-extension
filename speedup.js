{
  const proto = XMLHttpRequest.prototype
  const { open, send, abort, setRequestHeader } = proto
  const readyState = Object.getOwnPropertyDescriptor(proto, 'readyState').get
  // keep the private profile overrides
  const status = Object.getOwnPropertyDescriptor(proto, 'status').get
  const response = Object.getOwnPropertyDescriptor(proto, 'response').get
  const prefetched = new Map()
  // onload can request the next page before our load listener runs
  const live = new Set()
  const AHEAD = 10
  const MAX_SAVED = 50

  const pageUrl = (url, page) => {
    const u = new URL(url, location.href)
    u.searchParams.set('page', page)
    return u.href
  }

  const finish = (xhr, json) => {
    xhr.psCached = json
    xhr.psWaiting = false
    for (const type of ['readystatechange', 'load', 'loadend']) xhr.dispatchEvent(new ProgressEvent(type))
  }

  const save = (key, r) => {
    if (r?.ErrorCode !== 1) return
    try {
      // full responses are too large to cache and the site only reads character ids and light level
      const { characters, mergedAllCharacters } = r.Response
      const Response = {
        characters: characters.map(({ characterId }) => ({ characterId })),
        mergedAllCharacters: { merged: { allTime: { highestLightLevel: mergedAllCharacters?.merged?.allTime?.highestLightLevel } } },
        mergedDeletedCharacters: {}
      }
      const saved = Object.keys(localStorage).filter(k => k.startsWith('ps-stats:') && k !== key)
        .map(k => [k, JSON.parse(localStorage.getItem(k))?.savedAt || 0])
        .sort((a, b) => b[1] - a[1])
      for (const [k] of saved.slice(MAX_SAVED - 1)) localStorage.removeItem(k)
      localStorage.setItem(key, JSON.stringify({ ...r, Response, savedAt: Date.now() }))
    } catch {}
  }

  const stalePaths = new Set()
  const showStale = () => {
    const banner = document.getElementById('ps-stale')
    if (!stalePaths.has(location.pathname)) return banner?.remove()
    const header = document.querySelector('main .side-container > .row.no-margin')
    if (!header) return banner?.remove()
    // sit above the private banner so both observers stay settled
    const next = document.getElementById('ps-private') || header
    if (banner?.nextElementSibling === next) return
    const el = banner || document.createElement('div')
    if (!banner) {
      el.id = 'ps-stale'
      el.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>
        <div><b>New character found</b><span>Its runs are missing from this load. Click to reload.</span></div>`
      el.onclick = () => location.reload()
    }
    next.before(el)
  }
  new MutationObserver(showStale).observe(document, { childList: true, subtree: true })

  const prefetchAfter = (url, json, headers) => {
    const u = new URL(url)
    const count = +u.searchParams.get('count')
    if (!count || json?.Response?.activities?.length !== count) return
    const page = +u.searchParams.get('page')
    for (let i = page + 1; i <= page + AHEAD; i++) {
      u.searchParams.set('page', i)
      const next = u.href
      if (!prefetched.has(next) && !live.has(next)) {
        prefetched.set(next, { path: location.pathname, json: fetch(next, { headers }).then(r => r.json()).catch(() => {}) })
      }
    }
  }

  proto.open = function () {
    this.psCached = null
    this.psSend = null
    this.psHeaders = {}
    this.psWaiting = false
    return open.apply(this, arguments)
  }
  proto.abort = function () {
    const waiting = this.psWaiting
    this.psSend = null
    this.psCached = null
    this.psWaiting = false
    abort.apply(this, arguments)
    // native abort fires nothing when the real send never ran
    if (waiting) for (const type of ['abort', 'loadend']) this.dispatchEvent(new ProgressEvent(type))
  }
  proto.setRequestHeader = function (name, value) {
    this.psHeaders[name] = value
    return setRequestHeader.apply(this, arguments)
  }
  proto.send = function () {
    const token = this.psSend = {}
    if (/\/Stats\/Activities\/\?.*\bpage=\d+/.test(this.psUrl)) {
      const page = +new URL(this.psUrl, location.href).searchParams.get('page')
      const url = pageUrl(this.psUrl, page)
      for (const [key, { path }] of prefetched) {
        if (path !== location.pathname || (page === 0 && pageUrl(key, 0) === url)) prefetched.delete(key)
      }
      const real = () => {
        this.psWaiting = false
        live.add(url)
        this.addEventListener('loadend', () => live.delete(url), { once: true })
        this.addEventListener('load', () => this.psSend === token && prefetchAfter(url, response.call(this), this.psHeaders), { once: true })
        return send.apply(this, arguments)
      }
      const entry = prefetched.get(url)
      const pending = entry?.json
      if (!pending) return real()
      // keep the marker so later load handlers cannot prefetch this page again
      entry.json = null
      this.psWaiting = true
      pending.then(json => {
        if (this.psSend !== token) return
        if (json?.ErrorCode !== 1) return real()
        prefetchAfter(url, json, this.psHeaders)
        finish(this, json)
      })
      return
    }
    if (!/\/Account\/\d+\/Stats\/(\?|$)/.test(this.psUrl)) return send.apply(this, arguments)
    const key = 'ps-stats:' + this.psUrl
    let cached
    try { cached = JSON.parse(localStorage.getItem(key)) } catch {}
    if (!cached) {
      this.addEventListener('load', () => this.psSend === token && save(key, response.call(this)), { once: true })
      return send.apply(this, arguments)
    }
    const path = location.pathname
    // the last refresh already saved any new character into this cache
    stalePaths.delete(path)
    fetch(this.psUrl, { headers: this.psHeaders }).then(r => r.json()).then(r => {
      save(key, r)
      const ids = new Set(cached.Response.characters.map(({ characterId }) => characterId))
      if (r?.ErrorCode === 1 && r.Response.characters.some(({ characterId }) => !ids.has(characterId))) {
        stalePaths.add(path)
        showStale()
      }
    }).catch(() => {})
    this.psWaiting = true
    setTimeout(() => {
      if (this.psSend === token) finish(this, cached)
    })
  }
  Object.defineProperty(proto, 'readyState', { get() { return this.psCached ? 4 : readyState.call(this) } })
  Object.defineProperty(proto, 'status', { get() { return this.psCached ? 200 : status.call(this) } })
  Object.defineProperty(proto, 'response', { get() { return this.psCached || response.call(this) } })
}
