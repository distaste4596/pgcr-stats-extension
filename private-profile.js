// keep clears and ranks visible when bungie hides the activity history
{
  const empty = () => ({ Response: { activities: [] }, ErrorCode: 1, ThrottleSeconds: 0, ErrorStatus: 'Success', Message: 'Ok', MessageData: {} })
  const proto = XMLHttpRequest.prototype
  const open = proto.open
  const status = Object.getOwnPropertyDescriptor(proto, 'status').get
  const response = Object.getOwnPropertyDescriptor(proto, 'response').get
  const hiddenPaths = new Set()

  const isHidden = xhr => xhr.readyState === 4 && xhr.psUrl?.includes('/Stats/Activities/') && xhr.responseType === 'json'
    && response.call(xhr)?.ErrorStatus === 'DestinyPrivacyRestriction'

  proto.open = function (method, url) {
    this.psUrl = String(url)
    // tie slow responses to the profile that requested them
    this.psPath = location.pathname
    return open.apply(this, arguments)
  }
  Object.defineProperty(proto, 'status', { get() { return isHidden(this) ? 200 : status.call(this) } })
  Object.defineProperty(proto, 'response', {
    get() {
      if (!isHidden(this)) return response.call(this)
      hiddenPaths.add(this.psPath)
      return empty()
    }
  })

  new MutationObserver(() => {
    const banner = document.getElementById('ps-private')
    if (!hiddenPaths.has(location.pathname)) return banner?.remove()
    const header = document.querySelector('main .side-container > .row.no-margin')
    if (!header) return banner?.remove()
    if (banner?.nextElementSibling === header) return
    const el = banner || document.createElement('div')
    el.id = 'ps-private'
    el.innerHTML = `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      <div><b>This profile is private</b><span>The activity history can't be loaded, so recent runs are missing. Clears, ranks and fastest times still show.</span></div>`
    header.before(el)
  }).observe(document, { childList: true, subtree: true })
}
