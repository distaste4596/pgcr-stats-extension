const BNET = 'https://www.bungie.net'
const MISSING_ICON = BNET + '/img/misc/missing_icon_d2.png'
const BUNGIE_KEY = '4e5d0cf99f7841a0aea660f88689309c'
const SLOTS = { 1498876634: 'Kinetic', 2465295065: 'Energy', 953998645: 'Power' }
const SLOT_ORDER = ['Kinetic', 'Energy', 'Power', 'Other']
const PLATFORMS = { 1: 'xb', 2: 'ps', 3: 'pc', 4: 'pc', 5: 'stadia', 6: 'epic' }
const MEMBERSHIP_TYPES = { xb: 1, ps: 2, pc: 3, stadia: 5, epic: 6 }

const statValue = (values, key) => values?.[key]?.basic.value || 0
const percent = (part, whole) => (whole ? 100 * part / whole : 0).toFixed(1) + '%'
const formatTime = seconds => `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const classNames = s => escapeHtml([...s.classes].join(' / '))
const copyText = (button, text) => navigator.clipboard.writeText(text).then(() => {
  button.classList.add('ps-copied')
  setTimeout(() => button.classList.remove('ps-copied'), 1200)
})
const pressButton = e => {
  if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches('[role=button]')) return
  e.preventDefault()
  e.target.click()
}

let shownId = null
let shownPanel = null
let closeModal = null
let linksObserver = null
const pendingWeapons = new Map()
const clans = new Map()
const banners = new Map()
const recent = []

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
  const nav = document.querySelector('nav')
  if (nav) root.style.setProperty('--ps-accent', getComputedStyle(nav).backgroundColor)

  const panel = document.createElement('div')
  panel.id = 'pgcr-stats'
  panel.className = 'card card-top-margin ps-root'
  panel.innerHTML = '<div class="ps-body ps-loading">Loading stats...</div>'
  panel.addEventListener('keydown', pressButton)
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
  const [, platform, id] = location.pathname.match(/^\/(xb|ps|pc|stadia|epic)\/(\d+)/) || []
  const old = document.querySelector('.ps-links-row')
  if (!id) {
    linksObserver?.disconnect()
    linksObserver = null
    old?.remove()
    return
  }
  if (old && old.dataset.id !== id) old.remove()
  const type = MEMBERSHIP_TYPES[platform]
  const header = document.querySelector('.player-info-memberships')
  const name = header?.querySelector('.player-info-display-name')
  const badge = header?.querySelector(':scope > a.left')
  let clan = header?.querySelector('.ps-clan')
  // wait for react to replace the previous profile header
  if (name && badge?.href.includes(id) && clan?.dataset.id !== id) {
    clan?.remove()
    // insert before fetching so redraws cannot start duplicate clan lookups
    clan = Object.assign(document.createElement('a'), { className: 'ps-clan', target: '_blank', rel: 'noopener' })
    clan.dataset.id = id
    name.after(clan)
    if (!clans.has(id)) {
      clans.set(id, bungie(`${BNET}/Platform/GroupV2/User/${type}/${id}/0/1/`).then(r => r.results[0]?.group).catch(() => {
        clans.delete(id)
        return null
      }))
    }
    clans.get(id).then(group => {
      if (!group) return
      const tag = cleanName(group.clanInfo?.clanCallsign || '')
      clan.href = `https://raidhub.io/clan/${group.groupId}`
      clan.textContent = cleanName(group.name) + (tag ? ` [${tag}]` : '')
    })
  }

  const ranks = document.querySelector('.card-length')?.parentElement
  if (!ranks || old?.previousElementSibling === ranks) return
  old?.remove()
  // build links before the slow profile header is ready
  const [otherName, otherSite] = location.hostname === 'raid.report'
    ? ['Dungeon Report', 'https://dungeon.report'] : ['Raid Report', 'https://raid.report']
  const links = [
    [otherName, `${otherSite}/${platform}/${id}`, `${otherSite}/favicon.ico`],
    ['PGCR Report', `https://pgcr.report/@${id}/${type}`, 'https://pgcr.report/pgcr-report.svg'],
    ['Bungie.net', `${BNET}/7/en/User/Profile/${type}/${id}`, `${BNET}/7/favicon.ico`]
  ].map(([label, url, icon]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}"><img src="${escapeHtml(icon)}" alt=""></a>`)
  const row = document.createElement('div')
  row.className = 'left ps-links-row'
  row.dataset.id = id
  row.innerHTML = `<div class="card ps-links-card"><div class="ps-links-title">Other Sites</div><div class="ps-links">${links.join('')}</div></div>`
  ranks.after(row)
  linksObserver?.disconnect()
  linksObserver = new ResizeObserver(() => {
    const speed = ranks.querySelector('.speed-rank-padding .rank-card')
    if (speed) row.firstChild.style.height = speed.offsetHeight + 'px'
  })
  linksObserver.observe(ranks)
}

async function bungie(url) {
  while (recent.length === 60 && Date.now() - recent[0] < 1000) {
    await new Promise(resolve => setTimeout(resolve, recent[0] + 1000 - Date.now()))
  }
  recent.push(Date.now())
  if (recent.length > 60) recent.shift()
  const json = await (await fetch(url, { headers: { 'X-API-Key': BUNGIE_KEY }, signal: AbortSignal.timeout(30000) })).json()
  if (!json.Response) throw new Error(json.Message)
  return json.Response
}
const itemDef = hash => bungie(`${BNET}/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`)

// separate keys keep concurrent tabs from overwriting each other
async function getWeapons(hashes) {
  const stored = await chrome.storage.local.get(hashes.map(hash => 'w' + hash))
  const defs = {}
  for (const hash of hashes) if (stored['w' + hash]) defs[hash] = stored['w' + hash]
  const missing = hashes.filter(hash => !defs[hash])
  if (!missing.length) return [defs, null]
  // fill defs in place so late results can update the rendered weapons
  const lookups = Promise.all(missing.map(hash => {
    if (!pendingWeapons.has(hash)) {
      pendingWeapons.set(hash, itemDef(hash).then(item => {
        // redacted weapons need another lookup after bungie reveals them
        if (item.redacted || !item.displayProperties.name) return null
        const def = [item.displayProperties.name, item.displayProperties.icon, SLOTS[item.inventory?.bucketTypeHash]]
        chrome.storage.local.set({ ['w' + hash]: def }).catch(() => {})
        return def
      }).catch(() => null).finally(() => pendingWeapons.delete(hash)))
    }
    return pendingWeapons.get(hash).then(def => { if (def) defs[hash] = def })
  }))
  return [defs, lookups]
}

async function render(instanceId, panel) {
  const pgcr = await bungie(`https://stats.bungie.net/Platform/Destiny2/Stats/PostGameCarnageReport/${instanceId}/`)
  if (panel !== shownPanel) return
  if (!pgcr.entries?.length) throw new Error('No players in this activity')
  const duration = statValue(pgcr.entries[0].values, 'activityDurationSeconds')
  const hashes = [...new Set(pgcr.entries.flatMap(e => e.extended?.weapons || []).map(w => w.referenceId))]
  const [weaponDefs, lookups] = await getWeapons(hashes).catch(() => [{}, null])

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

  for (const p of list) {
    const hash = p.emblemHash
    if (!banners.has(hash)) {
      banners.set(hash, itemDef(hash)
        .then(item => {
          const path = item.secondarySpecial || item.secondaryIcon
          if (!path) return null
          const url = BNET + path
          new Image().src = url
          return { url, wide: !!item.secondarySpecial }
        })
        .catch(() => {
          banners.delete(hash)
          return null
        }))
    }
    p.banner = banners.get(hash)
  }

  // show the panel after five seconds even if weapon names are still loading
  const late = lookups && !await Promise.race([lookups.then(() => true), new Promise(resolve => setTimeout(resolve, 5000, false))])
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
  const mvpBadge = p => (p === mvp ? '<span class="ps-mvp">MVP</span>' : '')

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
    <div class="ps-grid ps-player" data-i="${i}" role="button" tabindex="0">
      <div class="ps-who"><img src="${BNET + p.icon}"><div>
        <div class="ps-nameline"><span class="ps-name">${escapeHtml(p.name)}</span>${mvpBadge(p)}</div>
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

  const json = JSON.stringify(pgcr, null, 2)
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
    return `<span class="ps-json-chip" role="button" tabindex="0" data-entry="${i}">${escapeHtml(user.bungieGlobalDisplayName || user.displayName)} · ${escapeHtml(e.player.characterClass)}</span>`
  }).join('')
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
    <details class="ps-json"><summary>API Response (JSON)</summary>
    <div class="ps-json-chips">${jsonChips}</div>
    <div class="ps-json-box">
      <span class="ps-copy" role="button" tabindex="0" aria-label="Copy JSON">
        <svg class="ps-copyicon" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12"/><path d="M5 15H3V3h12v2"/></svg>
        <svg class="ps-check" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>
      </span>
      <pre>${jsonHtml}</pre>
    </div></details>
  </div>`
  if (late) lookups.then(() => { panel.querySelector('.ps-slots').innerHTML = weaponList(teamWeaponRows) })

  const openPlayer = p => {
    if (closeModal) return
    const code = p.code ? '#' + String(p.code).padStart(4, '0') : ''
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
        <span class="ps-tab ps-on" role="button" tabindex="0" data-c="">All</span>
        ${characters.map((c, i) => `<span class="ps-tab" role="button" tabindex="0" data-c="${i}">${classNames(c)}${
          c.completed
            ? '<i class="material-icons ps-done" title="Completed">check_circle</i>'
            : '<i class="material-icons ps-left" title="Did not complete">cancel</i>'}</span>`).join('')}
      </div>`

    const overlay = document.createElement('div')
    overlay.className = 'ps-root ps-overlay'
    overlay.innerHTML = `<div class="ps-modal" role="dialog" aria-modal="true">
      <div class="ps-mhead">
        <img class="ps-memblem" src="${BNET + p.icon}">
        <div>
          <div class="ps-mname">${escapeHtml(p.name)}<span class="ps-code">${code}</span>
            <span class="ps-copy" role="button" tabindex="0" aria-label="Copy name">
              <svg class="ps-copyicon" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12"/><path d="M5 15H3V3h12v2"/></svg>
              <svg class="ps-check" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>
            </span>
          </div>
          <div class="ps-msub">${mvpBadge(p)}${classNames(p)} · ${p.light} Power</div>
        </div>
        <span class="ps-close" role="button" tabindex="0" aria-label="Close">×</span>
      </div>
      <div class="ps-mbody">
        ${tabs}
        <div class="ps-mview">${statsView(p)}</div>
      </div>
    </div>`

    const opener = document.activeElement
    const overflow = document.body.style.overflow
    const close = () => {
      overlay.remove()
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', onKey)
      closeModal = null
      opener?.focus()
    }
    closeModal = close
    const onKey = e => {
      if (e.key === 'Escape') return close()
      if (e.key !== 'Tab') return
      const controls = [...overlay.querySelectorAll('[tabindex="0"]')]
      if (e.shiftKey) controls.reverse()
      if (document.activeElement !== controls.at(-1)) return
      e.preventDefault()
      controls[0].focus()
    }
    const showTab = () => {
      const tab = overlay.querySelector('.ps-tab.ps-on')
      overlay.querySelector('.ps-mview').innerHTML = statsView(tab?.dataset.c ? characters[tab.dataset.c] : p)
    }
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('.ps-close')) close()
      const tab = e.target.closest('.ps-tab')
      if (tab && !tab.classList.contains('ps-on')) {
        overlay.querySelector('.ps-tab.ps-on').classList.remove('ps-on')
        tab.classList.add('ps-on')
        showTab()
      }
      const copyButton = e.target.closest('.ps-copy')
      if (copyButton) copyText(copyButton, p.name + code)
    })
    overlay.addEventListener('keydown', pressButton)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    document.body.append(overlay)
    overlay.querySelector('.ps-close').focus()
    if (late) lookups.then(showTab)

    p.banner.then(banner => {
      if (!banner) return
      const head = overlay.querySelector('.ps-mhead')
      if (banner.wide) {
        head.style.backgroundImage = `url("${banner.url}")`
        head.style.backgroundSize = 'cover'
      } else {
        head.style.backgroundImage = `linear-gradient(to right, transparent 280px, #2a2a2b 474px), url("${banner.url}")`
      }
    })
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
}
// image errors do not bubble
document.addEventListener('error', e => {
  const img = e.target
  if (img.tagName === 'IMG' && img.src !== MISSING_ICON && img.closest('.ps-root, .ps-links')) img.src = MISSING_ICON
}, true)
// document_start can run before the html element exists
new MutationObserver(onChange).observe(document, { childList: true, subtree: true })
onChange()
