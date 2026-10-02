// Minimal DOM for node tests (no jsdom/linkedom in this repo). Parses the
// small, well-formed fixture HTML and supports what lib/extract.js touches:
// querySelector(All) with tag / #id / .class / [attr] / [attr="v"] /
// [attr*="v" i] / [attr^=] / [attr$=] compounds, descendant combinators and
// comma lists; closest, contains, children, parentElement, textContent,
// innerText, getAttribute. Not a general-purpose DOM.
"use strict"

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])
const RAW = new Set(["script", "style"])

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
}

class Text {
  constructor(text) {
    this.nodeType = 3
    this.data = text
    this.parentElement = null
  }
  get textContent() {
    return this.data
  }
}

class Element {
  constructor(tag, attrs) {
    this.nodeType = 1
    this.tagName = tag.toUpperCase()
    this.attrs = attrs
    this.childNodes = []
    this.parentElement = null
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1)
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join("")
  }
  get innerText() {
    return this.textContent
  }
  getAttribute(name) {
    const v = this.attrs[name.toLowerCase()]
    return v === undefined ? null : v
  }
  hasAttribute(name) {
    return name.toLowerCase() in this.attrs
  }
  contains(other) {
    for (let n = other; n; n = n.parentElement) if (n === this) return true
    return false
  }
  descendants() {
    const out = []
    const walk = (el) => {
      for (const c of el.children) {
        out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }
  querySelectorAll(sel) {
    const groups = parseSelector(sel)
    return this.descendants().filter((el) => groups.some((g) => matchComplex(el, g)))
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null
  }
  matches(sel) {
    return parseSelector(sel).some((g) => matchComplex(this, g))
  }
  closest(sel) {
    for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n
    return null
  }
}

function parseAttrs(src) {
  const attrs = {}
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m
  while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "")
  return attrs
}

function parseHTML(html) {
  const root = new Element("#root", {})
  const stack = [root]
  const top = () => stack[stack.length - 1]
  const append = (node) => {
    node.parentElement = top().nodeType === 1 && top().tagName !== "#ROOT" ? top() : null
    top().childNodes.push(node)
  }
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</gi
  let m
  while ((m = re.exec(html))) {
    const tok = m[0]
    if (tok.startsWith("<!")) continue
    if (m[1]) {
      const tag = m[1].toUpperCase()
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    if (m[2]) {
      const tag = m[2].toLowerCase()
      const el = new Element(tag, parseAttrs(m[3] || ""))
      append(el)
      if (RAW.has(tag)) {
        const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex)
        const stop = end === -1 ? html.length : end
        const t = new Text(html.slice(re.lastIndex, stop))
        t.parentElement = el
        el.childNodes.push(t)
        re.lastIndex = stop
        continue
      }
      if (!VOID.has(tag) && !m[4]) stack.push(el)
      continue
    }
    append(new Text(decode(tok)))
  }
  // parentElement of top-level elements stays null; give them the root for walking.
  return root
}

// ── Selectors ────────────────────────────────────────────────────────────────

function splitTop(s, sep) {
  const out = []
  let depth = 0
  let quote = null
  let cur = ""
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === "[") depth++
    else if (ch === "]") depth--
    if (!quote && depth === 0 && sep.test(ch)) {
      if (cur.trim()) out.push(cur.trim())
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function parseCompound(src) {
  const c = { tag: null, id: null, classes: [], attrs: [] }
  const re = /^([a-zA-Z*][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([^\s~|^$*=\]]+)\s*(?:([*^$]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*(i)?)?\s*\]/g
  let m
  let pos = 0
  while ((m = re.exec(src))) {
    if (m.index !== pos) throw new Error(`Unsupported selector: ${src}`)
    pos = re.lastIndex
    if (m[1]) c.tag = m[1] === "*" ? null : m[1].toUpperCase()
    else if (m[2]) c.id = m[2]
    else if (m[3]) c.classes.push(m[3])
    else c.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] ?? m[7] ?? m[8] ?? "", ci: !!m[9] })
  }
  if (pos !== src.length) throw new Error(`Unsupported selector: ${src}`)
  return c
}

function parseSelector(sel) {
  return splitTop(sel, /,/).map((g) => splitTop(g, /\s/).map(parseCompound))
}

function matchCompound(el, c) {
  if (c.tag && el.tagName !== c.tag) return false
  if (c.id && el.getAttribute("id") !== c.id) return false
  const cls = (el.getAttribute("class") || "").split(/\s+/)
  for (const k of c.classes) if (!cls.includes(k)) return false
  for (const a of c.attrs) {
    let v = el.getAttribute(a.name)
    if (v === null) return false
    if (!a.op) continue
    let want = a.value
    if (a.ci) {
      v = v.toLowerCase()
      want = want.toLowerCase()
    }
    if (a.op === "=" && v !== want) return false
    if (a.op === "*=" && !v.includes(want)) return false
    if (a.op === "^=" && !v.startsWith(want)) return false
    if (a.op === "$=" && !v.endsWith(want)) return false
  }
  return true
}

function matchComplex(el, parts) {
  if (!matchCompound(el, parts[parts.length - 1])) return false
  let i = parts.length - 2
  let n = el.parentElement
  while (i >= 0 && n) {
    if (matchCompound(n, parts[i])) i--
    n = n.parentElement
  }
  return i < 0
}

/** Parse a full HTML document into a document-like object. */
function makeDocument(html, url) {
  const root = parseHTML(html)
  const htmlEl = root.children.find((c) => c.tagName === "HTML") || root
  const find = (tag) => (htmlEl.tagName === tag ? htmlEl : htmlEl.descendants().find((e) => e.tagName === tag) || null)
  const body = find("BODY")
  const titleEl = find("TITLE")
  return {
    body,
    documentElement: htmlEl,
    title: titleEl ? titleEl.textContent.trim() : "",
    location: { href: url },
    defaultView: null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
  }
}

module.exports = { makeDocument, parseHTML }
