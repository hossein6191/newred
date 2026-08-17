#!/usr/bin/env python3
"""Patch the bundled index.html in place.

The page ships as one self-contained file: its source lives inside a JSON
string in a <script type="__bundler/template"> tag. This edits that string and
writes it back, leaving every other byte of the bundle untouched.
"""
import json
import re
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
html = open(PATH, encoding='utf-8').read()

m = re.search(r'(<script type="__bundler/template">)(.*?)(</script>)', html, re.S)
if not m:
    sys.exit('template script not found')

template = json.loads(m.group(2).strip())
original = template


def sub(old, new, label):
    global template
    if old not in template:
        sys.exit(f'ANCHOR MISSING: {label}')
    if template.count(old) != 1:
        sys.exit(f'ANCHOR AMBIGUOUS ({template.count(old)}x): {label}')
    template = template.replace(old, new)
    print(f'  ok  {label}')


# ---------------------------------------------------------------- constants

sub(
    "const GW = 'https://oracle-gateway-1.a.redstone.finance/v2/data-packages/latest/redstone-primary-prod';",
    "const GW_PATH = '/v2/data-packages/latest/redstone-primary-prod';\n"
    "const GWS = [\n"
    "  'https://oracle-gateway-1.a.redstone.finance' + GW_PATH,\n"
    "  'https://oracle-gateway-2.a.redstone.finance' + GW_PATH,\n"
    "  'https://oracle-gateway-1.a.redstone.vip' + GW_PATH\n"
    "];\n"
    "const GW_TIMEOUT_MS = 5000;\n"
    "const RETRY_MS = 3000;\n"
    "const SPREAD_KEY = 'pop.spread.v2';\n"
    "const SPREAD_KEEP_H = 24*7;",
    'gateway list',
)

# ------------------------------------------------------------------ helpers

sub(
    "function median(xs){const s=[...xs].sort((a,b)=>a-b);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;}",
    "function median(xs){const s=[...xs].sort((a,b)=>a-b);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;}\n"
    "\n"
    "/* Try the gateways in turn, giving each a deadline, and take the first that\n"
    "   answers. Asking only one meant a single slow or unreachable host lost the\n"
    "   whole fifteen-second round, and the next success then jumped the price by\n"
    "   half a minute.\n"
    "\n"
    "   In turn rather than all at once on purpose: each response is a few hundred\n"
    "   kilobytes covering every feed, and the first gateway normally answers in\n"
    "   well under a second. Racing all three would treble the load on RedStone\n"
    "   every fifteen seconds to save a delay that almost never happens. */\n"
    "async function fetchFromGateways(urls, timeoutMs){\n"
    "  let last = null;\n"
    "  for(const url of urls){\n"
    "    const ctrl = new AbortController();\n"
    "    const timer = setTimeout(() => { try { ctrl.abort(); } catch(e){} }, timeoutMs);\n"
    "    try {\n"
    "      const r = await fetch(url, {headers:{accept:'application/json'}, signal: ctrl.signal});\n"
    "      if(!r.ok) throw new Error('HTTP ' + r.status);\n"
    "      return await r.json();\n"
    "    } catch(e){\n"
    "      last = e;\n"
    "    } finally {\n"
    "      clearTimeout(timer);\n"
    "    }\n"
    "  }\n"
    "  throw last || new Error('no gateway answered');\n"
    "}\n"
    "\n"
    "/* Low, high and movement across a window of the hourly series. Both ranges\n"
    "   read the same series the chart draws, so the numbers cannot disagree. */\n"
    "function rangeStats(series, hours){\n"
    "  if(!Array.isArray(series) || series.length < 2) return null;\n"
    "  const cutoff = series[series.length-1].t - hours*3600*1000;\n"
    "  const win = series.filter(p => p.t >= cutoff);\n"
    "  const pts = win.length > 1 ? win : series;\n"
    "  const vs = pts.map(p => p.v);\n"
    "  const lo = Math.min(...vs), hi = Math.max(...vs);\n"
    "  const first = pts[0].v, last = pts[pts.length-1].v;\n"
    "  return {\n"
    "    lo, hi, points: pts.length,\n"
    "    changePct: first ? ((last-first)/first)*100 : 0,\n"
    "    widthPct: lo ? ((hi-lo)/lo)*100 : 0\n"
    "  };\n"
    "}",
    'gateway fallback + rangeStats helpers',
)

# ------------------------------------------------------- spread memory + poll

sub(
    "  /* ---------- live poll: automatic, every 15s ---------- */\n"
    "  async poll(){\n"
    "    let body = null;\n"
    "    try {\n"
    "      const r = await fetch(GW, {headers:{accept:'application/json'}});\n"
    "      if(!r.ok) throw new Error(r.status);\n"
    "      body = await r.json();\n"
    "    } catch(e){\n"
    "      const s = document.getElementById('pop-status');\n"
    "      if(s) s.textContent = 'REDSTONE\\u2011PRIMARY\\u2011PROD · GATEWAY UNREACHABLE';\n"
    "      this.nextAt = Date.now() + POLL_MS;\n"
    "      return;\n"
    "    }\n"
    "    if(!this.alive) return;\n"
    "    this.nextAt = Date.now() + POLL_MS;",
    "  /* ---------- how far apart the nodes have been, kept across reloads ----\n"
    "     Bucketed by hour so the same window the chart uses can be applied to it.\n"
    "     Keeping every fifteen-second sample would be forty thousand numbers a\n"
    "     week per feed; one bucket an hour is a hundred and sixty-eight. */\n"
    "  loadSpreadMemory(){\n"
    "    try {\n"
    "      const raw = localStorage.getItem(SPREAD_KEY);\n"
    "      this.spreadMem = raw ? JSON.parse(raw) : {};\n"
    "    } catch(e){ this.spreadMem = {}; }\n"
    "    if(!this.spreadMem || typeof this.spreadMem !== 'object') this.spreadMem = {};\n"
    "    this.pruneSpread();\n"
    "  }\n"
    "  pruneSpread(){\n"
    "    const oldest = Math.floor(Date.now()/3600000) - SPREAD_KEEP_H;\n"
    "    for(const sym of Object.keys(this.spreadMem)){\n"
    "      const b = this.spreadMem[sym];\n"
    "      if(!b || typeof b !== 'object'){ delete this.spreadMem[sym]; continue; }\n"
    "      for(const h of Object.keys(b)) if(Number(h) < oldest) delete b[h];\n"
    "      if(!Object.keys(b).length) delete this.spreadMem[sym];\n"
    "    }\n"
    "  }\n"
    "  noteSpread(sym, bps){\n"
    "    if(!Number.isFinite(bps)) return;\n"
    "    const hour = Math.floor(Date.now()/3600000);\n"
    "    const buckets = this.spreadMem[sym] || (this.spreadMem[sym] = {});\n"
    "    const b = buckets[hour] || (buckets[hour] = {max:0, n:0});\n"
    "    b.max = Math.max(b.max, bps);\n"
    "    b.n += 1;\n"
    "    clearTimeout(this._spreadSave);\n"
    "    this._spreadSave = setTimeout(() => {\n"
    "      this.pruneSpread();\n"
    "      try { localStorage.setItem(SPREAD_KEY, JSON.stringify(this.spreadMem)); } catch(e){}\n"
    "    }, 1200);\n"
    "  }\n"
    "  /* What the nodes did inside the window the tabs select, and how much of\n"
    "     that window was actually watched — the two are rarely the same. */\n"
    "  spreadOver(sym, hours){\n"
    "    const buckets = this.spreadMem && this.spreadMem[sym];\n"
    "    if(!buckets) return null;\n"
    "    const now = Math.floor(Date.now()/3600000);\n"
    "    const from = now - hours + 1;\n"
    "    let max = 0, n = 0, first = null;\n"
    "    for(const key of Object.keys(buckets)){\n"
    "      const h = Number(key);\n"
    "      if(h < from || h > now) continue;\n"
    "      const b = buckets[key];\n"
    "      max = Math.max(max, b.max);\n"
    "      n += b.n;\n"
    "      if(first === null || h < first) first = h;\n"
    "    }\n"
    "    if(!n) return null;\n"
    "    return {max, n, sinceMs: (now - first + 1) * 3600000};\n"
    "  }\n"
    "\n"
    "  /* ---------- live poll: automatic, every 15s ---------- */\n"
    "  async poll(){\n"
    "    let body = null;\n"
    "    try {\n"
    "      body = await fetchFromGateways(GWS, GW_TIMEOUT_MS);\n"
    "    } catch(e){\n"
    "      if(!this.alive) return;\n"
    "      this.misses = (this.misses || 0) + 1;\n"
    "      const st = document.getElementById('pop-status');\n"
    "      if(st){\n"
    "        const age = this.lastOk ? Math.round((Date.now()-this.lastOk)/1000) : null;\n"
    "        st.textContent = age !== null\n"
    "          ? 'REDSTONE\\u2011PRIMARY\\u2011PROD · NO GATEWAY REPLIED · SHOWING ' + age + 's-OLD PACKAGE'\n"
    "          : 'REDSTONE\\u2011PRIMARY\\u2011PROD · NO GATEWAY REPLIED';\n"
    "      }\n"
    "      /* Try again in a few seconds rather than losing the whole round. */\n"
    "      this.nextAt = Date.now() + RETRY_MS;\n"
    "      clearTimeout(this.retryT);\n"
    "      this.retryT = setTimeout(() => { if(this.alive) this.poll(); }, RETRY_MS);\n"
    "      return;\n"
    "    }\n"
    "    if(!this.alive) return;\n"
    "    clearTimeout(this.retryT);\n"
    "    this.misses = 0;\n"
    "    this.lastOk = Date.now();\n"
    "    this.nextAt = Date.now() + POLL_MS;",
    'poll: race, retry, staleness',
)

sub(
    "    const prev = this.live;\n"
    "    const out = {};\n"
    "    for(const sym of FEEDS){\n"
    "      const d = this.packRows(sym);\n"
    "      if(d) out[sym] = d;\n"
    "    }",
    "    const prev = this.live;\n"
    "    const out = {};\n"
    "    for(const sym of FEEDS){\n"
    "      const d = this.packRows(sym);\n"
    "      if(d){ out[sym] = d; this.noteSpread(sym, d.spreadBps); }\n"
    "    }\n"
    "    if(FEEDS.indexOf(this.selected) < 0){\n"
    "      const sel = this.packRows(this.selected);\n"
    "      if(sel) this.noteSpread(this.selected, sel.spreadBps);\n"
    "    }",
    'record spread every round',
)

# ------------------------------------------------------------ boot additions

sub(
    "    this.loadRegistry();\n"
    "    this.probeHosts();",
    "    this.loadSpreadMemory();\n"
    "    this.loadRegistry();\n"
    "    this.probeHosts();",
    'boot: load spread memory',
)

# -------------------------------------------------------------- stats paint

sub(
    "  setLabels(){\n"
    "    const span = this.range === '24H' ? '24 HOURS' : '7 DAYS';\n"
    "    const lab = document.getElementById('pop-3d-label');\n"
    "    if(lab) lab.textContent = this.selected + ' / USD · ' + span + ' + THIS SESSION';\n"
    "    const note = document.getElementById('pop-chart-note');\n"
    "    if(note) note.textContent = (this.range === '24H' ? '24\\u2011HOUR' : '7\\u2011DAY') + ' HOURLY LINE · UNSIGNED DASHBOARD API';\n"
    "  }",
    "  setLabels(){\n"
    "    const span = this.range === '24H' ? '24 HOURS' : '7 DAYS';\n"
    "    const lab = document.getElementById('pop-3d-label');\n"
    "    if(lab) lab.textContent = this.selected + ' / USD · ' + span + ' + THIS SESSION';\n"
    "    const note = document.getElementById('pop-chart-note');\n"
    "    if(note) note.textContent = (this.range === '24H' ? '24\\u2011HOUR' : '7\\u2011DAY') + ' HOURLY LINE · UNSIGNED DASHBOARD API';\n"
    "    this.paintStats();\n"
    "  }\n"
    "\n"
    "  /* The market's own movement, next to the nodes' disagreement about it.\n"
    "     They are different scales on purpose: one is percent, one is basis\n"
    "     points, and confusing the two is the mistake this panel prevents. */\n"
    "  paintStats(){\n"
    "    const sym = this.selected;\n"
    "    const hours = this.range === '24H' ? 24 : 24*7;\n"
    "    const tag = this.range === '24H' ? '24H' : '7D';\n"
    "    /* The label carries the window, so the strip cannot be read as some\n"
    "       other period than the chart under it. */\n"
    "    const rl = document.getElementById('pop-stat-range-label');\n"
    "    if(rl) rl.textContent = tag + ' RANGE';\n"
    "    const st = rangeStats(this.hist[sym], hours);\n"
    "    const set = (id, text, colour) => {\n"
    "      const el = document.getElementById(id);\n"
    "      if(!el) return;\n"
    "      el.textContent = text;\n"
    "      if(colour) el.style.color = colour;\n"
    "    };\n"
    "\n"
    "    if(st){\n"
    "      set('pop-stat-range', fmt(st.lo) + ' – ' + fmt(st.hi));\n"
    "      set('pop-stat-width', st.widthPct.toFixed(2) + '%');\n"
    "      set('pop-stat-change',\n"
    "        (st.changePct >= 0 ? '+' : '') + st.changePct.toFixed(2) + '%',\n"
    "        st.changePct >= 0 ? '#FFCFC5' : '#E41939');\n"
    "    } else {\n"
    "      set('pop-stat-range', '—');\n"
    "      set('pop-stat-width', '—');\n"
    "      set('pop-stat-change', '—', '#FFE3E3');\n"
    "    }\n"
    "\n"
    "    /* The widest gap goes under the live spread rather than in the strip.\n"
    "       It cannot follow the tabs honestly: the range is fetched for the whole\n"
    "       window, while the gap only exists for the hours this browser watched,\n"
    "       so pinning it to 24H or 7D produced two labels and one number. */\n"
    "    const sp = this.spreadOver(sym, SPREAD_KEEP_H);\n"
    "    const gapEl = document.getElementById('pop-hero-gap');\n"
    "    if(gapEl){\n"
    "      if(sp && sp.n > 1){\n"
    "        const span = sp.sinceMs >= 48*3600000\n"
    "          ? Math.round(sp.sinceMs/86400000) + 'd'\n"
    "          : sp.sinceMs >= 3600000\n"
    "            ? Math.round(sp.sinceMs/3600000) + 'h'\n"
    "            : Math.max(1, Math.round(sp.sinceMs/60000)) + 'm';\n"
    "        gapEl.textContent = 'WIDEST ' + sp.max.toFixed(2) + ' bps · ' + sp.n + ' READINGS OVER ' + span;\n"
    "      } else {\n"
    "        gapEl.textContent = 'WIDEST — · WATCHING';\n"
    "      }\n"
    "    }\n"
    "  }",
    'setLabels + paintStats',
)

sub(
    "    this.live = out;\n"
    "    this.paint(prev);\n"
    "    this.paintSigners();",
    "    this.live = out;\n"
    "    this.paint(prev);\n"
    "    this.paintSigners();\n"
    "    this.paintStats();",
    'poll: repaint stats',
)

sub(
    "    if(!this.alive) return;\n"
    "    this.drawAllSparks();\n"
    "    this.chartT0 = this.chartT0 || performance.now();\n"
    "    this.drawBig();\n"
    "    this.build3d();\n"
    "  }",
    "    if(!this.alive) return;\n"
    "    this.drawAllSparks();\n"
    "    this.paintStats();\n"
    "    this.chartT0 = this.chartT0 || performance.now();\n"
    "    this.drawBig();\n"
    "    this.build3d();\n"
    "  }",
    'loadHistory: repaint stats',
)

# ------------------------------------------------- card 7d delta (never set)

sub(
    "        const sp = card.querySelector('[data-spread]');\n"
    "        if(sp) sp.textContent = 'spread ' + d.spreadBps.toFixed(2) + ' bps';",
    "        const sp = card.querySelector('[data-spread]');\n"
    "        if(sp) sp.textContent = 'spread ' + d.spreadBps.toFixed(2) + ' bps';\n"
    "        /* This slot shipped reading \"7d —\" because nothing ever filled it. */\n"
    "        const dl = card.querySelector('[data-delta]');\n"
    "        if(dl){\n"
    "          const week = rangeStats(this.hist[sym], 24*7);\n"
    "          if(week){\n"
    "            dl.textContent = '7d ' + (week.changePct >= 0 ? '+' : '') + week.changePct.toFixed(2) + '%';\n"
    "            dl.style.color = week.changePct >= 0 ? '#FFCFC5' : '#E41939';\n"
    "          }\n"
    "        }",
    'cards: fill the 7d delta',
)

# ------------------------------------------------------------------ markup

# Three cells, not five. The node gap belongs beside the live price, not here:
# it is measured by watching, while these three are fetched for the whole
# window, and a row that mixes the two reads as broken when they disagree.
#
# minmax(0,...) rather than a pixel minimum — a grid track will not shrink below
# its content otherwise, which is what pushed this strip outside its own panel.
STATS_HTML = (
    '<div id="pop-stats" style="display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr);'
    'gap:1px;background:#4C0912;margin:0 clamp(16px,2vw,26px) 16px;border:1px solid #4C0912">'
    '<div style="background:#290004;padding:11px 13px;min-width:0">'
    '<div id="pop-stat-range-label" style="font-family:\'Roboto Mono\',monospace;font-size:9px;letter-spacing:0.12em;color:#D1707F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">RANGE</div>'
    '<div id="pop-stat-range" style="font-family:\'Roboto Mono\',monospace;font-size:clamp(10px,1.05vw,12px);color:#FFE3E3;margin-top:6px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div>'
    '</div>'
    '<div style="background:#290004;padding:11px 13px;min-width:0">'
    '<div style="font-family:\'Roboto Mono\',monospace;font-size:9px;letter-spacing:0.12em;color:#D1707F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">HIGH TO LOW</div>'
    '<div id="pop-stat-width" style="font-family:\'Roboto Mono\',monospace;font-size:clamp(10px,1.05vw,12px);color:#FFE3E3;margin-top:6px;font-variant-numeric:tabular-nums">—</div>'
    '</div>'
    '<div style="background:#290004;padding:11px 13px;min-width:0">'
    '<div style="font-family:\'Roboto Mono\',monospace;font-size:9px;letter-spacing:0.12em;color:#D1707F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">CHANGE</div>'
    '<div id="pop-stat-change" style="font-family:\'Roboto Mono\',monospace;font-size:clamp(10px,1.05vw,12px);color:#FFE3E3;margin-top:6px;font-variant-numeric:tabular-nums">—</div>'
    '</div>'
    '</div>'
)

sub(
    '<canvas id="pop-bigchart"',
    STATS_HTML + '<canvas id="pop-bigchart"',
    'stats strip markup',
)

# The widest gap seen, directly under the live spread it is the running maximum of.
sub(
    '<div id="pop-hero-spread" style="font-family:\'Roboto Mono\',monospace;font-size:clamp(22px,2.4vw,30px);font-weight:500;color:#EBB3B9;font-variant-numeric:tabular-nums">—</div>',
    '<div id="pop-hero-spread" style="font-family:\'Roboto Mono\',monospace;font-size:clamp(22px,2.4vw,30px);font-weight:500;color:#EBB3B9;font-variant-numeric:tabular-nums">—</div>'
    '<div id="pop-hero-gap" style="font-family:\'Roboto Mono\',monospace;font-size:9.5px;letter-spacing:0.08em;color:#D1707F;margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">WIDEST — · WATCHING</div>',
    'widest-gap line under live spread',
)

# --------------------------------------------------- registry: source + cache

sub(
    "const REGISTRY = 'https://raw.githubusercontent.com/redstone-finance/redstone-oracles-monorepo/main/packages/sdk/src/registry/initial-state.json';",
    "/* Read from the published SDK package over a CDN, not from a raw GitHub file.\n"
    "   raw.githubusercontent.com rate-limits anonymous traffic, and a 429 here used\n"
    "   to label every one of the five nodes 'not in registry' — the page accusing\n"
    "   honest signers because it could not read the list it checks them against. */\n"
    "const REGISTRY = 'https://cdn.jsdelivr.net/npm/@redstone-finance/sdk/dist/src/registry/initial-state.json';\n"
    "const REGISTRY_KEY = 'pop.registry.v1';",
    'registry source',
)

sub(
    "  ['raw.githubusercontent.com', REGISTRY, 'Node registry · the names beside each signer'],",
    "  ['cdn.jsdelivr.net · sdk', REGISTRY, 'Node registry · the names beside each signer'],",
    'hosts table row',
)

sub(
    "  async loadRegistry(){\n"
    "    try {\n"
    "      const r = await fetch(REGISTRY);\n"
    "      const j = await r.json();\n"
    "      const map = {};\n"
    "      for(const n of Object.values(j.nodes || {})){\n"
    "        if(n.dataServiceId !== 'redstone-primary-prod') continue;\n"
    "        map[String(n.evmAddress).toLowerCase()] = String(n.name || '').replace('redstone-primary-prod-','') || 'unnamed';\n"
    "      }\n"
    "      this.nodeNames = map;\n"
    "      if(this.alive) this.paintSigners();\n"
    "    } catch(e){ /* addresses still show, just without their names */ }\n"
    "  }",
    "  async loadRegistry(){\n"
    "    const use = (map) => {\n"
    "      if(!map || !Object.keys(map).length) return false;\n"
    "      this.nodeNames = map;\n"
    "      if(this.alive) this.paintSigners();\n"
    "      return true;\n"
    "    };\n"
    "    /* Show the cached names first. The list changes a few times a year, so a\n"
    "       slow or refusing CDN should never blank out names already known. */\n"
    "    try { use(JSON.parse(localStorage.getItem(REGISTRY_KEY) || 'null')); } catch(e){}\n"
    "    try {\n"
    "      const r = await fetch(REGISTRY);\n"
    "      if(!r.ok) throw new Error('HTTP ' + r.status);\n"
    "      const j = await r.json();\n"
    "      const map = {};\n"
    "      for(const n of Object.values(j.nodes || {})){\n"
    "        if(n.dataServiceId !== 'redstone-primary-prod') continue;\n"
    "        map[String(n.evmAddress).toLowerCase()] = String(n.name || '').replace('redstone-primary-prod-','') || 'unnamed';\n"
    "      }\n"
    "      if(use(map)){\n"
    "        try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(map)); } catch(e){}\n"
    "      }\n"
    "    } catch(e){ /* whatever was cached stays on screen */ }\n"
    "  }",
    'loadRegistry: cache + fail soft',
)

sub(
    "  nameFor(addr){\n"
    "    const n = this.nodeNames && this.nodeNames[String(addr).toLowerCase()];\n"
    "    return n ? n + ' \\u2713' : 'not in registry';\n"
    "  }",
    "  nameFor(addr){\n"
    "    /* Not knowing a name and knowing the name is wrong are different claims.\n"
    "       Only say a signer is missing from the registry once the registry has\n"
    "       actually been read. */\n"
    "    if(!this.nodeNames) return 'registry unavailable';\n"
    "    const n = this.nodeNames[String(addr).toLowerCase()];\n"
    "    return n ? n + ' \\u2713' : 'not in registry';\n"
    "  }",
    'nameFor: no false accusation',
)

# ------------------------------------------------------------------- write

print(f'\ntemplate grew {len(original)} -> {len(template)} chars')

# The template holds its own </script> tags, so every "</" is escaped the way
# the bundler escapes it. Miss this and the tag closes early and the page dies.
encoded = json.dumps(template).replace('</', '<\\u002F')
assert '</script>' not in encoded, 'unescaped </script> would truncate the tag'

html = html[:m.start(2)] + encoded + html[m.end(2):]
open(PATH, 'w', encoding='utf-8').write(html)
print(f'wrote {PATH} ({len(html)} bytes)')
