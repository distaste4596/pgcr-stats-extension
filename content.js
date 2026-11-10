const BNET = 'https://www.bungie.net'
const MISSING_ICON = BNET + '/img/misc/missing_icon_d2.png'
const BUNGIE_KEY = '4e5d0cf99f7841a0aea660f88689309c'
const SLOTS = { 1498876634: 'Kinetic', 2465295065: 'Energy', 953998645: 'Power' }
const SLOT_ORDER = ['Kinetic', 'Energy', 'Power', 'Other']
const PLATFORMS = { 1: 'xb', 2: 'ps', 3: 'pc', 4: 'pc', 5: 'stadia', 6: 'epic' }
const MEMBERSHIP_TYPES = { xb: 1, ps: 2, pc: 3, stadia: 5, epic: 6 }
const PROFILE_PATH = /^\/(xb|ps|pc|stadia|epic)\/(\d+)/

const statValue = (values, key) => values?.[key]?.basic.value || 0
const percent = (part, whole) => (whole ? 100 * part / whole : 0).toFixed(1) + '%'
const formatTime = seconds => `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const classNames = s => escapeHtml([...s.classes].join(' / '))
const codeText = code => code ? '#' + String(code).padStart(4, '0') : ''
const nameHtml = (name, code) => escapeHtml(name) + (code ? `<span class="ps-code">${codeText(code)}</span>` : '')
const COPY_BUTTON = `<span class="ps-copy">
  <svg class="ps-copyicon" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12"/><path d="M5 15H3V3h12v2"/></svg>
  <svg class="ps-check" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>
</span>`
const copyText = (button, text) => navigator.clipboard.writeText(text).then(() => {
  button.classList.add('ps-copied')
  setTimeout(() => button.classList.remove('ps-copied'), 1200)
})

let shownId = null
let shownPanel = null
let closeModal = null
let loadoutObserver = null
let manifestCheck = null
let manifestVersion = null
const recent = []
let live = null
let ticker = null
let bungieOffset = 0
const offsets = []
const bungieNow = () => Date.now() + bungieOffset
const settings = { ...DEFAULT_SETTINGS }
const hideCards = () => {
  const root = document.documentElement
  // document_start can run before the html element exists
  if (!root) return document.addEventListener('DOMContentLoaded', hideCards, { once: true })
  root.classList.toggle('ps-hide-loadout', !settings.showLoadout)
  root.classList.toggle('ps-hide-activity', !settings.showActivity)
  root.classList.toggle('ps-hide-fireteam', !settings.showFireteam)
}
chrome.storage.sync.get(settings).then(stored => {
  Object.assign(settings, stored)
  hideCards()
  addActivity()
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return
  let enabled = false
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (!(key in settings)) continue
    enabled ||= newValue && !settings[key]
    settings[key] = newValue
  }
  hideCards()
  addActivity()
  if (enabled && live) {
    live.force = true
    live.fetched = 0
  }
})

const setAccent = () => {
  const nav = document.querySelector('nav')
  if (nav) document.documentElement.style.setProperty('--ps-accent', getComputedStyle(nav).backgroundColor)
}

const check = () => {
  const instanceId = location.pathname.match(/^\/pgcr\/(\d+)/)?.[1]
  if (instanceId !== shownId) {
    closeModal?.()
    shownPanel?.remove()
    shownPanel = null
    shownId = instanceId
  }
  if (!instanceId || shownPanel?.isConnected) return
  const siteCard = document.querySelector('.pgcr-table')?.closest('.card')
  if (!siteCard) return
  if (shownPanel) return siteCard.after(shownPanel)

  const root = document.documentElement
  root.classList.remove('ps-failed')
  setAccent()

  const panel = document.createElement('div')
  panel.id = 'pgcr-stats'
  panel.className = 'card card-top-margin ps-root'
  panel.innerHTML = '<div class="ps-body ps-loading">Loading stats...</div>'
  siteCard.after(panel)
  shownPanel = panel
  render(instanceId, panel).catch(err => {
    if (panel !== shownPanel) return
    root.classList.add('ps-failed')
    panel.innerHTML = `<div class="ps-body ps-loading">PGCR Stats failed: ${escapeHtml(err.message)}</div>`
  })
}

// destiny glyphs render as boxes and filler characters stand in for spaces
const cleanName = text => text.replace(/[\uE000-\uF8FF\u200B-\u200F\u2060\uFEFF]/g, '')
  .replace(/[\s\u115F\u1160\u3164\uFFA0\u2800]+/g, ' ').trim()

const addProfileLinks = () => {
  const [, platform, id] = location.pathname.match(PROFILE_PATH) || []
  const old = document.querySelector('.ps-side-row')
  if (!id) {
    loadoutObserver?.disconnect()
    loadoutObserver = null
    old?.remove()
    return
  }
  if (old && old.dataset.id !== id) old.remove()
  const type = MEMBERSHIP_TYPES[platform]
  const header = document.querySelector('.player-info-memberships')
  // react can leave the old header in place after navigation
  const currentHeader = header?.querySelector(':scope > a.left')?.href.includes(id) ? header : null
  const name = currentHeader?.querySelector('.player-info-display-name')
  const oldClan = currentHeader?.querySelector('.ps-clan')
  if (name && oldClan?.dataset.id !== id) {
    oldClan?.remove()
    const clan = Object.assign(document.createElement('a'), { className: 'ps-clan', target: '_blank', rel: 'noopener' })
    clan.dataset.id = id
    name.after(clan)
    bungieOnce(`${BNET}/Platform/GroupV2/User/${type}/${id}/0/1/`).then(result => {
      const group = result?.results[0]?.group
      if (!group) return
      const tag = cleanName(group.clanInfo?.clanCallsign || '')
      clan.href = `https://raidhub.io/clan/${group.groupId}`
      clan.textContent = cleanName(group.name) + (tag ? ` [${tag}]` : '')
    })
  }
  const h1 = name?.querySelector('h1')
  const oldTag = name?.querySelector('.ps-tag')
  if (h1 && oldTag?.dataset.id !== id) {
    oldTag?.remove()
    const tag = Object.assign(document.createElement('span'), { className: 'ps-root ps-tag' })
    tag.dataset.id = id
    h1.after(tag)
    membershipFor(id).then(membership => {
      if (!membership?.bungieGlobalDisplayNameCode) return
      tag.innerHTML = `<span class="ps-code">${codeText(membership.bungieGlobalDisplayNameCode)}</span>${COPY_BUTTON}`
      tag.addEventListener('click', e => {
        const copyButton = e.target.closest('.ps-copy')
        if (copyButton) copyText(copyButton, membership.bungieGlobalDisplayName + codeText(membership.bungieGlobalDisplayNameCode))
      })
    })
  }

  const ranks = document.querySelector('.card-length')?.parentElement
  if (!ranks || old?.previousElementSibling === ranks) return
  old?.remove()
  const [otherName, otherSite] = location.hostname === 'raid.report'
    ? ['Dungeon Report', 'https://dungeon.report'] : ['Raid Report', 'https://raid.report']
  const links = [
    [otherName, `${otherSite}/${platform}/${id}`, `${otherSite}/favicon.ico`],
    ['PGCR Report', `https://pgcr.report/@${id}/${type}`, 'https://pgcr.report/pgcr-report.svg'],
    ['Bungie.net', `${BNET}/7/en/User/Profile/${type}/${id}`, `${BNET}/7/favicon.ico`]
  ].map(([label, url, icon]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><img src="${escapeHtml(icon)}" alt=""></a>`)
  const row = document.createElement('div')
  row.className = 'left ps-side-row'
  row.dataset.id = id
  row.innerHTML = `<div class="card ps-links">${links.join('')}</div><div class="card ps-root ps-loadout-card"></div>`
  row.addEventListener('click', e => {
    if (e.target.closest('.ps-live-full') && live?.id === id && live.loadout) openLoadout(live.loadout)
  })
  ranks.after(row)
  renderLoadout()
  loadoutObserver?.disconnect()
  loadoutObserver = new ResizeObserver(() => {
    const speed = ranks.querySelector('.speed-rank-padding .rank-card')
    if (!speed) return
    const height = speed.offsetHeight + 'px'
    for (const card of row.children) card.style.height = height
  })
  loadoutObserver.observe(ranks)
}

// bungie's orbit activity has no name
const ORBIT_ACTIVITY = 82913930
const REFRESH = 60000
const CLASSES = ['Titan', 'Hunter', 'Warlock', 'Unknown']
const LOADOUT_SLOTS = [
  ['Subclass', 3284755031], ['Kinetic', 1498876634], ['Energy', 2465295065], ['Power', 953998645],
  ['Helmet', 3448274439], ['Arms', 3551918588], ['Chest', 14239492], ['Legs', 20886954], ['Class Item', 1585787867]
]
// placeholders that fill unused sockets
const HIDDEN_PLUG = /^(Empty |Default |Upgrade Armor$)/
// unlisted plugs like perks keep bungie's order right after the first group
const PLUG_ORDER = [/intrinsics|archetypes/, /origins/, /masterwork|crafting/, /weapon\.mod_|tuning/, /^shader$/, /skins/, /kill_vfx/]
const itemDefs = new Map()
const fixedReplies = new Map()
const bungieOnce = url => {
  if (!fixedReplies.has(url)) fixedReplies.set(url, bungie(url).catch(() => {
    fixedReplies.delete(url)
    return null
  }))
  if (fixedReplies.size > 500) fixedReplies.delete(fixedReplies.keys().next().value)
  return fixedReplies.get(url)
}
const membershipFor = id => bungieOnce(`${BNET}/Platform/User/GetMembershipsById/${id}/-1/`)
  .then(r => r?.destinyMemberships.find(d => d.membershipId === id))
const defUrl = (kind, hash) => `${BNET}/Platform/Destiny2/Manifest/Destiny${kind}Definition/${hash}/`
const manifestDef = (kind, hash) => hash ? bungieOnce(defUrl(kind, hash)) : null
const cacheBust = () => `cache_bust=${Math.floor(Math.random() * 1e15)}`
const TIME_UNITS = [
  ['second', 's', 60], ['minute', 'm', 60], ['hour', 'h', 24], ['day', 'd', 7],
  ['week', 'w', 52 / 12], ['month', 'mo', 12], ['year', 'y', Infinity]
]

const openModal = ({ emblem, name, code, sub }, body) => {
  const overlay = document.createElement('div')
  overlay.className = 'ps-root ps-overlay'
  overlay.innerHTML = `<div class="ps-modal" role="dialog" aria-modal="true">
    <div class="ps-mhead">
      <img class="ps-memblem" src="${escapeHtml(emblem)}">
      <div>
        <div class="ps-mname">${nameHtml(name || 'Loadout', code)}${name ? COPY_BUTTON : ''}</div>
        <div class="ps-msub">${sub}</div>
      </div>
      <span class="ps-close">×</span>
    </div>${body}</div>`
  const overflow = document.body.style.overflow
  const close = () => {
    overlay.remove()
    document.body.style.overflow = overflow
    document.removeEventListener('keydown', onKey)
    closeModal = null
  }
  closeModal = close
  const onKey = e => e.key === 'Escape' && close()
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('.ps-close')) close()
    const copyButton = e.target.closest('.ps-copy')
    if (copyButton) copyText(copyButton, name + codeText(code))
  })
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
  document.body.append(overlay)
  return overlay
}

const checkManifest = () => manifestCheck ??= bungie(`${BNET}/Platform/Destiny2/Manifest/?${cacheBust()}`).then(async ({ version }) => {
  const old = (await chrome.storage.local.get('manifest')).manifest
  if (old === version) return version
  if (parseInt(old) > parseInt(version)) return old
  // keep new defs cached by other tabs
  const stored = await chrome.storage.local.get(null)
  await chrome.storage.local.remove(Object.keys(stored).filter(key => key !== 'manifest' && stored[key]?.v !== version))
  await chrome.storage.local.set({ manifest: version })
  return version
}).then(version => {
  // retry redacted defs after a manifest update
  if (manifestVersion && manifestVersion !== version) itemDefs.clear()
  return manifestVersion = version
}, async () => {
  return manifestVersion ??= (await chrome.storage.local.get('manifest').catch(() => ({}))).manifest
}).finally(() => {
  setTimeout(() => { manifestCheck = null }, 60000)
})

const loadDef = async hash => {
  // bump the prefix when stored fields change
  const key = 'i' + hash
  const version = await checkManifest()
  if (version) {
    const { [key]: stored } = await chrome.storage.local.get(key).catch(() => ({}))
    if (stored?.v === version) return stored.none ? null : stored
  }
  const { displayProperties: { name, icon, description }, iconWatermark, inventory, plug, redacted } =
    // bypass cached defs from older manifests
    await bungie(defUrl('InventoryItem', hash) + '?' + cacheBust())
  if (redacted || !name) {
    if (version) chrome.storage.local.set({ [key]: { v: version, none: true } }).catch(() => {})
    return null
  }
  const def = { v: version, displayProperties: { name, icon, description }, iconWatermark, inventory: { tierType: inventory?.tierType, bucketTypeHash: inventory?.bucketTypeHash },
    plug: { plugCategoryIdentifier: plug?.plugCategoryIdentifier } }
  if (version) chrome.storage.local.set({ [key]: def }).catch(() => {})
  return def
}

const cachedDef = hash => {
  if (!itemDefs.has(hash)) itemDefs.set(hash, loadDef(hash).catch(async err => {
    const delay = err.throttleSeconds > 0 ? err.throttleSeconds * 1000 : 1000
    await new Promise(resolve => setTimeout(resolve, delay))
    return loadDef(hash)
  }).catch(() => {
    itemDefs.delete(hash)
    return null
  }))
  return itemDefs.get(hash)
}

const itemIcon = item => `<span class="ps-licon${item.label === 'Subclass' ? ' ps-subclass' : ''}" title="${escapeHtml(item.name)}">
  <img src="${escapeHtml(BNET + item.icon)}" alt="">${item.watermark ? `<img class="ps-watermark" src="${escapeHtml(BNET + item.watermark)}" alt="">` : ''}</span>`

const openLoadout = loadout => {
  if (closeModal) return
  const { character, items, owner } = loadout
  const itemHtml = items.map((item, i) => !item ? '' : `
    <div class="ps-litem">
      <div class="ps-label">${item.label}</div>
      <div class="ps-lhead">${itemIcon(item)}<span class="ps-name">${escapeHtml(item.name)}</span></div>
      <div class="ps-plugs" data-i="${i}"></div>
    </div>`)
  const overlay = openModal({
    emblem: BNET + character.emblemPath,
    name: owner.name,
    code: owner.code,
    sub: `${CLASSES[character.classType]} · ${character.light} Power`
  }, `
    <div class="ps-mbody ps-loadout">
      <div>${itemHtml.slice(0, 4).join('')}</div>
      <div>${itemHtml.slice(4).join('')}</div>
    </div>`)
  const head = overlay.querySelector('.ps-mhead')
  showBanner(head, { url: BNET + character.emblemBackgroundPath })
  bannerFor(character.emblemHash).then(banner => showBanner(head, banner))
  items.forEach((item, i) => item && Promise.all(item.plugs.map(hash => cachedDef(hash))).then(defs => {
    const rank = def => {
      const group = PLUG_ORDER.findIndex(order => order.test(def?.plug.plugCategoryIdentifier))
      return group < 0 ? 0.5 : group
    }
    overlay.querySelector(`.ps-plugs[data-i="${i}"]`).innerHTML = defs.sort((a, b) => rank(a) - rank(b)).map(def => {
      const name = def?.displayProperties.name.trim()
      // damage_type and frame_identifiers are hidden markers like ergo sum's element and shaped weapon
      if (!name || HIDDEN_PLUG.test(name) || /mementos|trackers|damage_type|frame_identifiers/.test(def.plug.plugCategoryIdentifier)) return ''
      const { icon, description } = def.displayProperties
      return `<img src="${escapeHtml(icon ? BNET + icon : MISSING_ICON)}" alt="" title="${escapeHtml(description ? `${name}\n${description}` : name)}">`
    }).join('')
  }))
}

const loadActivity = async (type, id, since, loadoutSince) => {
  const profile = await bungie(`${BNET}/Platform/Destiny2/${type}/Profile/${id}/?components=100,200,1000&${cacheBust()}`)
  const minted = Date.parse(profile.secondaryComponentsMintedTimestamp)
  const loadoutMinted = Date.parse(profile.responseMintedTimestamp)
  // later bungie replies can contain older data
  const refreshTransitory = (settings.showActivity || settings.showFireteam) && !(minted < since)
  const refreshLoadout = settings.showLoadout && !(loadoutMinted < loadoutSince)
  if (!refreshTransitory && !refreshLoadout) return {}
  const data = refreshTransitory ? profile.profileTransitoryData?.data : null
  const start = Date.parse(data?.currentActivity?.startTime)
  const user = profile.profile?.data?.userInfo
  const [loadoutId, character] = Object.entries(profile.characters?.data || {})
    .sort(([, a], [, b]) => b.dateLastPlayed.localeCompare(a.dateLastPlayed))[0] || []
  const components = [start && settings.showActivity && 204, refreshLoadout && '205,305'].filter(Boolean)
  const needsCharacter = loadoutId && components.length
  const r = needsCharacter
    ? await bungie(`${BNET}/Platform/Destiny2/${type}/Profile/${id}/Character/${loadoutId}/?components=${components}&${cacheBust()}`).catch(() => null) : null
  const activities = r?.activities?.data
  const current = activities && Date.parse(activities.dateActivityStarted) >= start ? activities : null
  const orbit = current?.currentActivityHash === ORBIT_ACTIVITY
  const loadout = refreshLoadout && r ? (async () => {
    const equipped = r.equipment?.data?.items || []
    const sockets = r.itemComponents?.sockets?.data || {}
    const items = await Promise.all(LOADOUT_SLOTS.map(async ([label, bucket]) => {
      const item = equipped.find(item => item.bucketHash === bucket)
      const def = item && await cachedDef(item.itemHash)
      if (!def) return null
      return {
        label,
        name: def.displayProperties.name,
        icon: def.displayProperties.icon,
        watermark: def.iconWatermark,
        tier: def.inventory?.tierType,
        plugs: (sockets[item.itemInstanceId]?.sockets || []).map(socket => socket.plugHash).filter(Boolean)
      }
    }))
    const plugs = items.flatMap(item => item?.plugs || [])
    plugs.forEach(hash => cachedDef(hash))
    for (const path of [character.emblemPath, character.emblemBackgroundPath]) new Image().src = BNET + path
    bannerFor(character.emblemHash)
    return { character, items, owner: { name: user?.bungieGlobalDisplayName || user?.displayName, code: user?.bungieGlobalDisplayNameCode } }
  })().catch(() => undefined) : null
  const [members, loadoutData, [activity, playlist, mode, activityType, place]] = await Promise.all([
    !settings.showFireteam ? [] : Promise.all((data?.partyMembers || []).map(m => membershipFor(m.membershipId)
      .then(membership => ({
        name: membership?.bungieGlobalDisplayName || m.displayName,
        code: membership?.bungieGlobalDisplayNameCode,
        url: PLATFORMS[membership?.membershipType] && `/${PLATFORMS[membership.membershipType]}/${m.membershipId}`,
        leader: m.status & 8
      })))),
    loadout,
    !current || orbit || !settings.showActivity ? [] : Promise.all([
      manifestDef('Activity', current.currentActivityHash),
      manifestDef('Activity', current.currentPlaylistActivityHash),
      manifestDef('ActivityMode', current.currentActivityModeHash)
    ]).then(([activity, playlist, mode]) => {
      const details = playlist || activity
      return Promise.all([
        activity, playlist, mode, manifestDef('ActivityType', details?.activityTypeHash), manifestDef('Place', details?.placeHash)
      ])
    })
  ])
  const update = refreshTransitory ? { minted, members } : {}
  if (needsCharacter && !r) return update
  if (refreshLoadout && loadoutData !== undefined) {
    update.loadoutMinted = loadoutMinted
    update.loadout = loadoutData
  }
  if (!refreshTransitory) return update
  const details = playlist || activity
  const modeName = mode?.displayProperties.name
  const names = [...new Set([playlist?.displayProperties.name || modeName, activity?.displayProperties.name].filter(Boolean))]
  const tags = [modeName, activityType?.displayProperties.name, place?.displayProperties.name]
    .filter(tag => tag && !names.includes(tag))
  return {
    ...update,
    activityMinted: minted,
    activity: current ? {
      orbit,
      name: orbit ? 'Orbit' : names.join(' · '),
      tags: [...new Set(tags)],
      // dungeons only have an icon on their mode
      icon: [details, mode].find(def => def?.displayProperties.hasIcon)?.displayProperties.icon,
      started: Date.parse(current.dateActivityStarted)
    } : null
  }
}

const timeAgo = (since, short) => {
  let count = Math.max(0, Math.round((bungieNow() - since) / 1000))
  let i = 0
  while (count >= TIME_UNITS[i][2]) count /= TIME_UNITS[i++][2]
  count = Math.floor(count)
  const [unit, letter] = TIME_UNITS[i]
  if (short) return `${count}${letter} ago`
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

const showActivityTimes = row => {
  const time = row?.querySelector('.ps-live-time')
  if (time) time.textContent = formatTime(Math.floor(Math.max(0, bungieNow() - row.dataset.started) / 1000))
  const updated = row?.querySelector('.ps-live-updated')
  if (updated) updated.textContent = 'Last updated ' + timeAgo(row.dataset.updated)
  const card = document.querySelector('.ps-loadout-card')
  const played = card?.querySelector('.ps-live-played')
  if (played) played.textContent = timeAgo(card.dataset.played, true)
}

const renderLoadout = () => {
  const card = document.querySelector('.ps-loadout-card')
  if (!card) return
  const loadout = live?.id === card.parentElement.dataset.id && live.loadout
  if (!loadout) return card.replaceChildren()
  const items = loadout.items
  const summary = [items.slice(0, 1), items.slice(1, 4), items.slice(4).filter(item => item?.tier === 6)]
    .map(group => group.filter(Boolean).map(itemIcon).join('')).filter(Boolean).join('<i class="ps-live-sep"></i>')
  const played = Date.parse(loadout.character.dateLastPlayed)
  card.dataset.played = played
  card.innerHTML = `
    <div class="ps-live-head">
      <span class="ps-label">Loadout</span>
      <span class="ps-live-played ps-sub" title="${escapeHtml(new Date(played).toLocaleString())}">${timeAgo(played, true)}</span>
      <span class="ps-live-full" title="View full">
        <svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></span>
    </div>
    <div class="ps-live-items">${summary}</div>`
}

const renderActivity = (row, a, members = []) => {
  if (!a && !members.length) return row.replaceChildren()
  row.dataset.started = a?.started
  row.dataset.updated = live.activityMinted
  const memberHtml = members.map(m => {
    const name = nameHtml(m.name, m.code)
    return `<div class="ps-live-member">${m.url ? `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener">${name}</a>` : `<span>${name}</span>`}${m.leader
      ? '<span class="ps-crown" title="Fireteam leader"><svg viewBox="0 0 24 24"><path d="M4 18h16M5 15 3 7l5 4 4-6 4 6 5-4-2 8z"/></svg></span>' : ''}</div>`
  }).join('')
  row.innerHTML = (a ? `
    <div class="card ps-live-card ps-live-activity">
      <div class="ps-live-head">
        <span class="ps-label">Activity</span>
        <span class="ps-live-tags">${a.tags.map(escapeHtml).join(' · ')}</span>
        <span class="ps-live-updated ps-sub"></span>
        <span class="ps-live-refresh${live.loading ? ' ps-spin' : ''}" title="Refresh">
          <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg></span>
      </div>
      <div class="ps-live-main">
        ${a.orbit ? '<svg class="ps-live-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>'
          : a.icon ? `<img class="ps-live-icon" src="${escapeHtml(BNET + a.icon)}" alt="">` : ''}
        <div>
          <div class="ps-live-name">${escapeHtml(a.name)}</div>
          ${a.orbit ? '' : '<div class="ps-live-clock"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span class="ps-live-time"></span></div>'}
        </div>
      </div>
    </div>` : '') + `
    <div class="card ps-live-card ps-live-fireteam">
      <div class="ps-live-head"><span class="ps-label">Fireteam</span></div>
      <div class="ps-live-members">${memberHtml}</div>
    </div>`
  showActivityTimes(row)
}

const refreshActivity = current => {
  current.loading = true
  document.querySelector('.ps-live-refresh')?.classList.add('ps-spin')
  let ok = false
  const since = current.force ? 0 : current.minted
  const loadoutSince = current.force ? 0 : current.loadoutMinted
  current.force = false
  loadActivity(current.type, current.id, since, loadoutSince).then(r => {
    ok = true
    if (live !== current || !Object.keys(r).length) return
    Object.assign(current, r)
    if ('loadout' in r) renderLoadout()
    const row = document.querySelector('.ps-live')
    if (row?.dataset.id === current.id) renderActivity(row, current.activity, current.members)
  }).catch(() => {}).finally(() => {
    current.loading = false
    if (live === current) document.querySelector('.ps-live-refresh')?.classList.remove('ps-spin')
    const now = bungieNow()
    const staleTransitory = (settings.showActivity || settings.showFireteam) && now - current.minted > REFRESH
    const staleLoadout = settings.showLoadout && now - current.loadoutMinted > REFRESH
    const stale = ok && (staleTransitory || staleLoadout) && current.retries++ < 3
    if (!stale) current.retries = 0
    current.fetched = current.force ? 0 : Date.now() - (stale ? REFRESH - 5000 : 0)
  })
}

const tickActivity = () => {
  if (document.hidden || !live) return
  const row = document.querySelector(`.ps-live[data-id="${live.id}"]`)
  if (!row && !document.querySelector(`.ps-side-row[data-id="${live.id}"]`)) return
  if (!live.loading && Date.now() - live.fetched >= REFRESH) refreshActivity(live)
  showActivityTimes(row)
}

const addActivity = () => {
  const [, platform, id] = location.pathname.match(PROFILE_PATH) || []
  const on = id && (settings.showLoadout || settings.showActivity || settings.showFireteam)
  if (on && !ticker) ticker = setInterval(tickActivity, 1000)
  if (!on && ticker) {
    clearInterval(ticker)
    ticker = null
  }
  const old = document.querySelector('.ps-live')
  if (old && old.dataset.id !== id) {
    old.remove()
    closeModal?.()
  }
  if (!id) return
  if (live?.id !== id) live = { id, type: MEMBERSHIP_TYPES[platform], minted: 0, loadoutMinted: 0, fetched: 0, retries: 0 }
  const header = document.querySelector('main .side-container > .row.no-margin')
  if (!header) return
  if (old?.dataset.id === id) {
    if (old.previousElementSibling !== header) header.after(old)
    return
  }
  setAccent()
  const row = Object.assign(document.createElement('div'), { className: 'ps-root ps-live' })
  row.dataset.id = id
  row.addEventListener('click', e => {
    if (e.target.closest('.ps-live-refresh') && !live.loading) refreshActivity(live)
  })
  header.after(row)
  renderActivity(row, live.activity, live.members)
}

async function bungie(url) {
  while (recent.length === 60 && Date.now() - recent[0] < 1000) {
    await new Promise(resolve => setTimeout(resolve, recent[0] + 1000 - Date.now()))
  }
  recent.push(Date.now())
  if (recent.length > 60) recent.shift()
  const res = await fetch(url, { headers: { 'X-API-Key': BUNGIE_KEY }, signal: AbortSignal.timeout(30000) })
  // date is hidden and cached replies skew the inferred server time older
  const expires = Date.parse(res.headers.get('expires'))
  const maxAge = res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]
  if (expires && maxAge && url.includes('cache_bust=')) {
    offsets.push(expires - maxAge * 1000 - Date.now())
    if (offsets.length > 10) offsets.shift()
    bungieOffset = Math.max(...offsets)
  }
  const json = await res.json()
  if (!json.Response) throw Object.assign(new Error(json.Message), { throttleSeconds: json.ThrottleSeconds })
  return json.Response
}

const bannerFor = async hash => {
  const item = await manifestDef('InventoryItem', hash)
  const path = item?.secondarySpecial || item?.secondaryIcon
  if (!path) return null
  const url = BNET + path
  new Image().src = url
  return { url, wide: !!item.secondarySpecial }
}

const showBanner = (head, banner) => {
  if (!banner) return
  if (banner.wide) {
    head.style.backgroundImage = `url("${banner.url}")`
    head.style.backgroundSize = 'cover'
  } else {
    head.style.backgroundImage = `linear-gradient(to right, transparent 280px, #2a2a2b 474px), url("${banner.url}")`
  }
}

async function render(instanceId, panel) {
  checkManifest()
  const pgcr = await bungie(`https://stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/${instanceId}/`)
  if (panel !== shownPanel) return
  if (!pgcr.entries?.length) throw new Error('No players in this activity')
  const duration = statValue(pgcr.entries[0].values, 'activityDurationSeconds')
  const hashes = [...new Set(pgcr.entries.flatMap(e => e.extended?.weapons || []).map(w => w.referenceId))]
  const weaponDefs = {}
  const lookups = Promise.all(hashes.map(hash => cachedDef(hash).then(def => {
    if (def) weaponDefs[hash] = [def.displayProperties.name, def.displayProperties.icon, SLOTS[def.inventory.bucketTypeHash]]
  })))

  const newStats = () => ({
    light: 0,
    classes: new Set(),
    kills: 0, deaths: 0, assists: 0, time: 0, score: 0,
    precision: 0, melee: 0, grenade: 0, super: 0,
    firstStart: Infinity,
    completed: false,
    weapons: new Map()
  })
  const addStats = (s, entry) => {
    const values = entry.values
    const extended = entry.extended?.values
    s.classes.add(entry.player.characterClass)
    s.light = Math.max(s.light, entry.player.lightLevel)
    s.kills += statValue(values, 'kills')
    s.deaths += statValue(values, 'deaths')
    s.assists += statValue(values, 'assists')
    s.time += statValue(values, 'timePlayedSeconds')
    s.score += statValue(values, 'score')
    s.precision += statValue(extended, 'precisionKills')
    s.melee += statValue(extended, 'weaponKillsMelee')
    s.grenade += statValue(extended, 'weaponKillsGrenade')
    s.super += statValue(extended, 'weaponKillsSuper')
    s.firstStart = Math.min(s.firstStart, statValue(values, 'startSeconds'))
    // bungie can also mark early leavers as completed
    s.completed ||= statValue(values, 'completed') === 1 && statValue(values, 'completionReason') === 0

    for (const weapon of entry.extended?.weapons || []) {
      const stats = s.weapons.get(weapon.referenceId) || { kills: 0, precision: 0 }
      stats.kills += statValue(weapon.values, 'uniqueWeaponKills')
      stats.precision += statValue(weapon.values, 'uniqueWeaponPrecisionKills')
      s.weapons.set(weapon.referenceId, stats)
    }
  }

  const players = new Map()
  for (const entry of pgcr.entries) {
    const user = entry.player.destinyUserInfo
    let p = players.get(user.membershipId)
    if (!p) {
      p = {
        name: user.bungieGlobalDisplayName || user.displayName,
        profileUrl: PLATFORMS[user.membershipType] && `/${PLATFORMS[user.membershipType]}/${user.membershipId}`,
        code: user.bungieGlobalDisplayNameCode,
        icon: user.iconPath,
        emblemHash: entry.player.emblemHash,
        characters: new Map(),
        ...newStats()
      }
      players.set(user.membershipId, p)
    }
    let c = p.characters.get(entry.characterId)
    if (!c) {
      c = newStats()
      p.characters.set(entry.characterId, c)
    }
    addStats(p, entry)
    addStats(c, entry)
  }
  const list = [...players.values()].sort((a, b) => b.kills - a.kills)

  for (const p of list) p.banner = bannerFor(p.emblemHash)

  const late = !await Promise.race([lookups.then(() => true), new Promise(resolve => setTimeout(resolve, 5000, false))])
  if (panel !== shownPanel) return

  for (const p of list) {
    const t = Math.min(p.time || 1, 32767)
    const killScore = 200 * (p.kills + 0.5 * p.assists) ** 0.95 / (Math.round(t / 10) * 10 || 1) + p.kills / 600
    const deathScore = (t / 6 / (p.deaths + 7)) ** 1.5 / 3
    p.mvpScoreParts = [
      ['Kills × deaths', 'kills + ½ assists per time, scaled by time between deaths', killScore * deathScore],
      ['Assists', 'assists compared to kills', p.assists / (p.kills || 1) * Math.min(300, p.kills) / 2],
      ['Time', '50 per hour played', 50 * t / 3600],
      ['Precision', '3 per 10% precision kills', 30 * p.precision / (p.kills || 1)],
      ['Super kills', '15 per super kill per minute', p.super / (t / 60) * 15],
      ['Start bonus', '20 if there from the start', p.firstStart < Math.max(30, p.time / 50) ? 20 : 0],
      ['In-game score', '0.5 per 1000 score', p.score / 2000]
    ]
    p.mvpScore = p.mvpScoreParts.reduce((sum, part) => sum + part[2], 0)
  }
  const mvp = list.length > 2 ? list.reduce((best, p) =>
    p.completed && (!best || p.mvpScore > best.mvpScore) ? p : best, null) : null
  const badge = p => p === mvp ? '<span class="ps-mvp">MVP</span>'
    : p.completed ? '' : '<span class="ps-mvp ps-dnf" title="Did not finish">DNF</span>'

  const total = key => list.reduce((sum, p) => sum + p[key], 0)
  const leaderBy = score => list.reduce((best, p) => (score(p) > score(best) ? p : best))
  const kd = p => p.kills / Math.max(1, p.deaths)
  const totalKills = total('kills')
  const bestKd = leaderBy(kd)

  const weaponList = rows => {
    rows = rows.map(row => {
      const [name = 'Unknown', icon, slot] = weaponDefs[row.hash] || []
      return { ...row, name, icon, slot: slot || 'Other' }
    })
    const slots = SLOT_ORDER.map(slot => {
      const slotRows = rows.filter(row => row.slot === slot).sort((a, b) => b.kills - a.kills)
      if (!slotRows.length) return ''
      const slotKills = slotRows.reduce((sum, row) => sum + row.kills, 0)
      const weapons = slotRows.map(row => {
        const share = percent(row.kills, slotKills)
        return `<div class="ps-weapon"><img src="${row.icon ? BNET + row.icon : MISSING_ICON}">
          <div class="ps-wmain">
            <div class="ps-wtop"><span class="ps-wname">${escapeHtml(row.name)}</span><span class="ps-wkills">${row.kills}<small>${share}</small></span></div>
            <div class="ps-bar"><i style="width:${share}"></i></div>
            <div class="ps-sub">${row.sub}</div>
          </div></div>`
      }).join('')
      return `<div class="ps-slot"><div class="ps-slot-head"><span>${slot}</span><span>${slotKills} kill${slotKills === 1 ? '' : 's'}</span></div>${weapons}</div>`
    }).join('')
    return slots || '<div class="ps-sub">No weapon kills</div>'
  }

  const playerRows = list.map((p, i) => `
    <div class="ps-grid ps-player" data-i="${i}">
      <div class="ps-who"><img src="${BNET + p.icon}"><div>
        <div class="ps-nameline"><span class="ps-name">${escapeHtml(p.name)}</span>${badge(p)}</div>
        <div class="ps-sub">${classNames(p)}</div>
      </div></div>
      <span>${p.kills}</span><span>${p.deaths}</span><span>${p.assists}</span><span>${kd(p).toFixed(2)}</span>
      <span>${percent(p.kills, totalKills)}</span>
      <div><div>${percent(p.precision, p.kills)}</div><div class="ps-sub">${p.precision} pk</div></div>
      <div><div>${formatTime(p.time)}</div><div class="ps-sub">${percent(p.time, duration)}</div></div>
      <span class="ps-chev">›</span>
      ${p.profileUrl ? `<a class="ps-open" href="${p.profileUrl}" aria-label="Open profile">
        <svg viewBox="0 0 24 24"><path d="M15 3h4v18h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>
      </a>` : ''}
    </div>`).join('')

  const tile = (label, value, leader, leaderValue) => `
    <div class="ps-tile">
      <div class="ps-label">${label}</div>
      <div class="ps-tile-value">${value}</div>
      <div class="ps-leader"><img src="${BNET + leader.icon}"><span class="ps-name">${escapeHtml(leader.name)}</span><span class="ps-num">${leaderValue}</span></div>
    </div>`
  const countTile = (label, key) => {
    const sum = total(key), leader = leaderBy(p => p[key])
    return tile(label, sum, leader, `${leader[key]} · ${percent(leader[key], sum)}`)
  }
  const tiles = [
    countTile('Kills', 'kills'),
    countTile('Deaths', 'deaths'),
    countTile('Assists', 'assists'),
    tile('K/D', (totalKills / Math.max(1, total('deaths'))).toFixed(2), bestKd, kd(bestKd).toFixed(2)),
    countTile('Precision Kills', 'precision'),
    countTile('Melee Kills', 'melee'),
    countTile('Grenade Kills', 'grenade'),
    countTile('Super Kills', 'super')
  ].join('')

  const teamWeapons = new Map()
  for (const p of list) {
    for (const [hash, stats] of p.weapons) {
      const weapon = teamWeapons.get(hash) || { kills: 0, users: [] }
      weapon.kills += stats.kills
      weapon.users.push({ player: p, kills: stats.kills })
      teamWeapons.set(hash, weapon)
    }
  }
  const teamWeaponRows = [...teamWeapons].map(([hash, weapon]) => {
    const users = weapon.users.sort((a, b) => b.kills - a.kills).map(user =>
      `<span class="ps-tip-row"><img src="${BNET + user.player.icon}"><span class="ps-name">${escapeHtml(user.player.name)}</span><b>${user.kills}</b></span>`
    ).join('')
    const count = `${weapon.users.length} player${weapon.users.length > 1 ? 's' : ''}`
    return { hash, kills: weapon.kills, sub: `<span class="ps-users">${count}<span class="ps-tip">${users}</span></span>` }
  })

  panel.innerHTML = `<div class="ps-body">
    <div class="ps-section">Fireteam</div>
    <div class="ps-table">
      <div class="ps-grid ps-ghead">
        <span>Player</span><span>Kills</span><span>Deaths</span><span>Assists</span><span>K/D</span>
        <span>Kill Share</span><span>Precision</span><span>Time</span><span></span>
      </div>
      ${playerRows}
    </div>
    <div class="ps-section">Summary</div>
    <div class="ps-tiles">${tiles}</div>
    <div class="ps-section">Weapons</div>
    <div class="ps-slots">${weaponList(teamWeaponRows)}</div>
    <details class="ps-json"><summary>API Response (JSON)</summary></details>
  </div>`
  if (late) lookups.then(() => { panel.querySelector('.ps-slots').innerHTML = weaponList(teamWeaponRows) })

  const details = panel.querySelector('.ps-json')
  let json
  details.addEventListener('toggle', () => {
    if (!details.open || json) return
    json = JSON.stringify(pgcr, null, 2)
    const jsonHtml = json.split('\n').map(line => {
      const html = line.replace(/("(?:[^"\\]|\\.)*")(:)?|-?\d[\d.eE+-]*|true|false|null/g, (token, string, colon) => {
        if (colon) return `<span class="ps-jk">${escapeHtml(string)}</span>:`
        if (string) return `<span class="ps-js">${escapeHtml(string)}</span>`
        return `<span class="${/^[tfn]/.test(token) ? 'ps-jl' : 'ps-jn'}">${token}</span>`
      })
      if (line === '    {') return `<div class="ps-json-entry"><div>${html}</div>`
      if (/^ {4}\},?$/.test(line)) return `<div>${html}</div></div>`
      return `<div>${html}</div>`
    }).join('')
    const jsonChips = pgcr.entries.map((e, i) => {
      const user = e.player.destinyUserInfo
      return `<span class="ps-json-chip" data-entry="${i}">${escapeHtml(user.bungieGlobalDisplayName || user.displayName)} · ${escapeHtml(e.player.characterClass)}</span>`
    }).join('')
    details.insertAdjacentHTML('beforeend', `
      <div class="ps-json-chips">${jsonChips}</div>
      <div class="ps-json-box">
        ${COPY_BUTTON}
        <pre>${jsonHtml}</pre>
      </div>`)
  })

  const openPlayer = p => {
    if (closeModal) return
    const statBox = (label, value, sub = '') => `
      <div class="ps-stat"><div class="ps-label">${label}</div><div class="ps-stat-value">${value}</div><div class="ps-sub">${sub}&nbsp;</div></div>`
    const scoreParts = p.mvpScoreParts.map(([name, how, points]) =>
      `<span class="ps-tip-row"><span class="ps-name">${name}<span class="ps-sub">${how}</span></span><b>${points.toFixed(1)}</b></span>`
    ).join('')
    const scoreLabel = `MVP Score<span class="ps-info">?<span class="ps-tip"><span class="ps-tip-head">How the MVP is picked</span>${scoreParts}</span></span>`
    const characters = [...p.characters.values()]
    const statsView = s => {
      const weaponRows = [...s.weapons].map(([hash, stats]) =>
        ({ hash, kills: stats.kills, sub: `${percent(stats.precision, stats.kills)} precision` }))
      return `<div class="ps-mstats">
          ${statBox('Time', formatTime(s.time), percent(s.time, duration))}
          ${statBox('Kills', s.kills, percent(s.kills, totalKills) + ' of team')}
          ${statBox('Deaths', s.deaths)}
          ${statBox('Assists', s.assists)}
          ${statBox('K/D', kd(s).toFixed(2))}
          ${statBox('Precision', percent(s.precision, s.kills), s.precision + ' precision kills')}
          ${statBox('Melee Kills', s.melee)}
          ${statBox('Grenade Kills', s.grenade)}
          ${statBox('Super Kills', s.super)}
          ${statBox(scoreLabel, p.mvpScore.toFixed(1))}
        </div>
        <div class="ps-section">Weapons</div>
        <div class="ps-slots">${weaponList(weaponRows)}</div>`
    }
    const tabs = characters.length < 2 ? '' : `<div class="ps-tabs">
        <span class="ps-tab ps-on" data-c="">All</span>
        ${characters.map((c, i) => `<span class="ps-tab" data-c="${i}">${classNames(c)}${
          c.completed
            ? '<i class="material-icons ps-done" title="Completed">check_circle</i>'
            : '<i class="material-icons ps-left" title="Did not complete">cancel</i>'}</span>`).join('')}
      </div>`

    const overlay = openModal({
      emblem: BNET + p.icon,
      name: p.name,
      code: p.code,
      sub: `${badge(p)}${classNames(p)} · ${p.light} Power`
    }, `
      <div class="ps-mbody">
        ${tabs}
        <div class="ps-mview">${statsView(p)}</div>
      </div>`)
    const showTab = () => {
      const tab = overlay.querySelector('.ps-tab.ps-on')
      overlay.querySelector('.ps-mview').innerHTML = statsView(tab?.dataset.c ? characters[tab.dataset.c] : p)
    }
    overlay.addEventListener('click', e => {
      const tab = e.target.closest('.ps-tab')
      if (tab && !tab.classList.contains('ps-on')) {
        overlay.querySelector('.ps-tab.ps-on').classList.remove('ps-on')
        tab.classList.add('ps-on')
        showTab()
      }
    })
    if (late) lookups.then(showTab)

    p.banner.then(banner => showBanner(overlay.querySelector('.ps-mhead'), banner))
  }

  panel.addEventListener('click', e => {
    const row = e.target.closest('.ps-player')
    if (row && !e.target.closest('.ps-open')) openPlayer(list[row.dataset.i])
    const copyButton = e.target.closest('.ps-copy')
    if (copyButton) copyText(copyButton, json)
    const chip = e.target.closest('.ps-json-chip')
    if (chip) {
      const pre = panel.querySelector('.ps-json pre')
      const entry = pre.querySelectorAll('.ps-json-entry')[chip.dataset.entry]
      panel.querySelectorAll('.ps-json .ps-on').forEach(el => el.classList.remove('ps-on'))
      chip.classList.add('ps-on')
      entry.classList.add('ps-on')
      pre.scrollTop += entry.getBoundingClientRect().top - pre.getBoundingClientRect().top
    }
  })
}

const onChange = () => {
  check()
  addProfileLinks()
  addActivity()
}
// image errors do not bubble
document.addEventListener('error', e => {
  const img = e.target
  if (img.tagName === 'IMG' && img.src !== MISSING_ICON && img.closest('.ps-root, .ps-links')) img.src = MISSING_ICON
}, true)
addEventListener('popstate', () => closeModal?.())
new MutationObserver(records => records.some(r => !r.target.closest?.('.ps-root')) && onChange()).observe(document, { childList: true, subtree: true })
onChange()
