// 搜索门店（2.1 设计第 10 节，画布 StSearch；2.2 起用系统地图，插件化设计 6.1 节）：选择门店顶部的搜索和门店详情的「重新定位」共用。
// 按输入的文字搜，以手机现在的位置为区域（取不到时用最近用过的油站）；页面一打开就开始取位置。
import { Button, EnvironmentValuesReader, HStack, List, ProgressView, Section, Spacer, Text, useEffect, useState, VStack } from "scripting"
import { AppData, searchStores, Store, StorePoi, storeOfPlace, warmSearchCenter } from "../common/model"
import { errorMessage } from "./components"

export type StoreSearch = { results: StorePoi[] | null; busy: boolean; error: string | null }

/** 停止输入 0.4 秒后查一次；query 为空时不查 */
export function useStoreSearch(getData: () => AppData, query: string): StoreSearch {
  const [state, setState] = useState<{ q: string; results: StorePoi[] | null; error: string | null }>({ q: "", results: null, error: null })
  useEffect(() => { void warmSearchCenter() }, [])
  useEffect(() => {
    const q = query.trim()
    if (!q) return
    let alive = true
    const timer = setTimeout(() => {
      searchStores(getData(), q)
        .then(results => { if (alive) setState({ q, results, error: null }) })
        .catch(e => { if (alive) setState({ q, results: [], error: errorMessage(e) }) })
    }, 400)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])
  const q = query.trim()
  const done = !!q && state.q === q
  return { results: done ? state.results : null, busy: !!q && !done, error: done ? state.error : null }
}

/** 地图上的一个地点：名称，第二行写距离和类别（附近）或区和地址（搜索）；已经是我的门店的写明 */
export function PoiRow({ poi, mine, detail, onPick }: { poi: StorePoi; mine: Store | null; detail: string; onPick: () => void }) {
  return <Button action={onPick}>
    <HStack foregroundStyle="label">
      <VStack alignment="leading" spacing={2}>
        <Text lineLimit={1}>{poi.name}</Text>
        {detail ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{detail}</Text> : null}
        {mine ? <Text font="caption" foregroundStyle="accentColor">已是我的门店</Text> : null}
      </VStack>
      <Spacer />
    </HStack>
  </Button>
}

export const searchDetail = (poi: StorePoi) => [poi.district, poi.address].filter(Boolean).join(" · ")

/** 地图上的地点没有 id：按位置和名称区分 */
export const poiKey = (p: StorePoi) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}|${p.name}`

/** 搜索结果一组 */
export function StoreResults({ search, stores, onPick }: { search: StoreSearch; stores: Store[]; onPick: (poi: StorePoi) => void }) {
  const list = search.results ?? []
  return <Section key="results" header={<HStack><Text>搜索结果</Text><Spacer /><Text>{search.results ? `${list.length} 个` : ""}</Text></HStack>}
    footer={<Text>选中的地点存进我的门店，名称取地图上的名称（去掉括号里的分店名），在门店详情里可以改短。</Text>}>
    {search.busy ? <HStack><ProgressView /><Text foregroundStyle="secondaryLabel">正在搜索…</Text></HStack> : null}
    {search.error ? <Text foregroundStyle="systemRed">{search.error}</Text> : null}
    {search.results && !list.length && !search.error ? <Text foregroundStyle="secondaryLabel">没有找到</Text> : null}
    {list.map(p => <PoiRow key={poiKey(p)} poi={p} mine={storeOfPlace(stores, p)} detail={searchDetail(p)} onPick={() => onPick(p)} />)}
  </Section>
}

/** 推入的搜索页（门店详情的「重新定位」）：搜索框里先填好店名，选中一个地点后返回 */
export function StoreSearchPage({ getData, initial, title, onPick }: { getData: () => AppData; initial: string; title: string; onPick: (poi: StorePoi) => void }) {
  return <EnvironmentValuesReader keys={["dismiss"]}>{env =>
    <SearchList getData={getData} initial={initial} title={title} onPick={p => { onPick(p); env.dismiss() }} />
  }</EnvironmentValuesReader>
}

function SearchList({ getData, initial, title, onPick }: { getData: () => AppData; initial: string; title: string; onPick: (poi: StorePoi) => void }) {
  const [q, setQ] = useState(initial)
  const search = useStoreSearch(getData, q)
  return <List navigationTitle={title} searchable={{ value: q, onChanged: setQ, prompt: "搜索地点" }}>
    {q.trim() ? <StoreResults search={search} stores={getData().ledger.stores} onPick={onPick} /> : <Text foregroundStyle="secondaryLabel">在上面输入店名搜索地点。</Text>}
  </List>
}
