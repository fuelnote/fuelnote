// 分层（CLAUDE.md 的分层规则，2.0）：纯逻辑层不导入应用层和页面，app/ 不导入页面，common/model.ts 只做转发；源码之间没有循环导入
// （scripting-cli 的打包器遇到循环时，先用到的那一边会拿到 undefined，到手机上才报错）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const ROOT = join(__dirname, "..")
const DIRS = ["app", "common", "platform", "pages", "providers", "sync", "stations", "readers"]
const ENTRIES = ["index.tsx", "widget.tsx", "intent.tsx"]

function walk(dir: string, out: string[]): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n)) out.push(p)
  }
  return out
}

const rel = (p: string) => relative(ROOT, p).split("\\").join("/")

/** 每个源文件导入的源文件（不算 import type，打包后不存在） */
function importGraph(): Map<string, string[]> {
  const files = [...DIRS.flatMap(d => walk(join(ROOT, d), [])), ...ENTRIES.map(f => join(ROOT, f))]
  const graph = new Map<string, string[]>()
  for (const f of files) {
    const text = readFileSync(f, "utf8")
    const deps: string[] = []
    for (const m of text.matchAll(/^(import|export)\b[^"]*?from\s+"(\.[^"]+)"/gms)) {
      if (/^import\s+type\b/.test(m[0])) continue
      const base = resolve(dirname(f), m[2])
      const hit = [".ts", ".tsx"].map(e => base + e).find(p => existsSync(p))
      if (hit) deps.push(rel(hit))
    }
    graph.set(rel(f), deps)
  }
  return graph
}

test("纯逻辑层（common/、sync/ 等）不导入 app/ 和 pages/；app/ 不导入 pages/", () => {
  const graph = importGraph()
  const bad: string[] = []
  for (const [f, deps] of graph) {
    if (f === "common/model.ts" || f.startsWith("pages/") || f.startsWith("tools/") || ENTRIES.includes(f)) continue
    for (const d of deps) {
      if (d.startsWith("pages/")) bad.push(`${f} → ${d}`)
      else if (d.startsWith("app/") && !f.startsWith("app/")) bad.push(`${f} → ${d}`)
    }
  }
  assert.deepEqual(bad, [])
})

test("common/model.ts 只转发，不写逻辑", () => {
  const text = readFileSync(join(ROOT, "common/model.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/).map(l => l.replace(/\/\/.*$/, "").trim()).filter(Boolean).join("\n")
  // 去掉 export { … } from "…" 和 export type { … } from "…"（可以跨行）、export * from "…"
  const rest = text.replace(/export\s+(type\s+)?\{[^}]*\}\s*from\s*"[^"]+"/g, "").replace(/export\s+\*\s+from\s+"[^"]+"/g, "").trim()
  assert.equal(rest, "")
})

test("源码之间没有循环导入", () => {
  const graph = importGraph()
  assert.ok(graph.size > 100 && [...graph.values()].flat().length > 300, "确实读到了导入关系")
  assert.ok(graph.get("pages/app.tsx")?.includes("common/model.ts"))
  const cycles: string[] = []
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (n: string) => {
    state.set(n, 1)
    stack.push(n)
    for (const d of graph.get(n) ?? []) {
      if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d].join(" → "))
      else if (!state.get(d)) visit(d)
    }
    stack.pop()
    state.set(n, 2)
  }
  for (const n of graph.keys()) if (!state.get(n)) visit(n)
  assert.deepEqual(cycles, [])
})

test("沃尔沃的代码只在 providers/ 里，别处经过 providers/registry.ts 用；common/ 的代码里没有沃尔沃的规则（插件化设计 D19，2.3.0-beta.2）", () => {
  const graph = importGraph()
  const bad = [...graph].flatMap(([f, deps]) => deps.filter(d => d.startsWith("providers/volvo_") && !f.startsWith("providers/")).map(d => `${f} → ${d}`))
  assert.deepEqual(bad, [])
  const mentions = readdirSync(join(ROOT, "common")).filter(n => n.endsWith(".ts")).filter(n => {
    const code = readFileSync(join(ROOT, "common", n), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map(l => l.replace(/\/\/.*$/, "")).join("\n")
    return /沃尔沃|volvo/i.test(code)
  })
  assert.deepEqual(mentions, [])
})
