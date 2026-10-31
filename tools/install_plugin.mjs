// 把示例插件（tools/plugin_example）装到 Scripting 的脚本目录（../FuelNote 示例插件），开发服务器才能同步到手机。
// 第一次需要在手机上新建一个同名的空脚本「FuelNote 示例插件」，再在开发服务器页面里选它（和 FuelNote Check 一样）。
// 只写有变化的文件，先写到脚本目录外的临时文件夹再改名。`npm run check:install` 也会装一次，FuelNote Check 才找得到它。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, "plugin_example")
const to = join(here, "..", "..", "FuelNote 示例插件")
const tmp = join(to, "..", ".install-tmp")

export function installExamplePlugin() {
  mkdirSync(to, { recursive: true })
  mkdirSync(tmp, { recursive: true })
  const names = readdirSync(from)
  let changed = 0
  for (const name of names) {
    const content = readFileSync(join(from, name))
    const target = join(to, name)
    if (existsSync(target) && readFileSync(target).equals(content)) continue
    const staged = join(tmp, `plugin__${name}`)
    writeFileSync(staged, content)
    renameSync(staged, target)
    changed++
  }
  return { to, changed, total: names.length }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = installExamplePlugin()
  console.log(`已更新 ${r.to}：${r.changed} 个文件有变化（共 ${r.total} 个）`)
}
