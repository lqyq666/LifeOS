// 星图三个浏览主题的归类词库。强词（weight 2）是直接证据——做了作品、
// 自己拿主意、收到反馈；弱词（1）只是语境线索，两个以上才够归类。所有
// 匹配都落在原文片段上，归类结果永远标记"可调整"。词库只服务确定性兜底，
// 模型通道的语义归类仍按其自己的判断，二者都不替用户做最终认定。
export type LexiconEntry = { word: string; weight: 1 | 2 }
export type CategoryLexicon = {
  valueId: 'value-creation' | 'value-autonomy' | 'value-growth'
  label: string
  definition: string
  entries: LexiconEntry[]
}
const w2 = (word: string): LexiconEntry => ({ word, weight: 2 })
const w1 = (word: string): LexiconEntry => ({ word, weight: 1 })

export const CATEGORY_LEXICON: CategoryLexicon[] = [
  {
    valueId: 'value-creation', label: '创造', definition: '把想法变成具体、有用的作品或解决方案。',
    entries: [w2('做了'), w2('做出'), w2('做出来'), w2('写完'), w2('写了'), w2('制作'), w2('设计'), w2('排版'), w2('剪辑'), w2('录制'), w2('开发'), w2('搭建'), w2('画了'), w2('拍了'), w2('整理出'), w2('作品'), w2('海报'), w2('推文'), w2('视频'), w2('文章'), w2('代码'), w2('方案'), w2('课件'), w2('一套'), w1('成品'), w1('交付物'), w1('PPT'), w1('小程序'), w1('公众号'), w1('弄出来'), w1('搞出来')],
  },
  {
    valueId: 'value-autonomy', label: '自主', definition: '依据自己的目标与判断作选择，并承担选择的结果。',
    entries: [w2('主动'), w2('自己决定'), w2('自己安排'), w2('自己联系'), w2('自己找'), w2('自己报'), w2('我决定'), w2('我选择'), w2('我约了'), w2('我联系'), w2('牵头'), w2('张罗'), w1('拒绝了'), w1('没答应'), w1('自己拿'), w1('自己来'), w1('发起'), w1('组织了'), w1('报名')],
  },
  {
    valueId: 'value-growth', label: '成长', definition: '通过行动、反馈与反思，更新能力和理解。',
    entries: [w2('反馈'), w2('评价'), w2('学到'), w2('改进'), w2('反思'), w2('教训'), w2('意识到'), w2('明白了'), w2('理解了'), w2('收获'), w1('建议'), w1('下次'), w1('晚了'), w1('迟了'), w1('按时'), w1('提前'), w1('效果'), w1('调整'), w1('修改')],
  },
]

export type LexiconMatch = { valueId: CategoryLexicon['valueId']; label: string; word: string; strong: boolean; matched: string[] }

// One strong word qualifies a category on its own; weak words need two.
export function classifyWithLexicon(text: string): LexiconMatch[] {
  const matches: LexiconMatch[] = []
  for (const category of CATEGORY_LEXICON) {
    const matched = category.entries.filter(entry => text.includes(entry.word))
    const strong = matched.filter(entry => entry.weight === 2)
    const weak = matched.filter(entry => entry.weight === 1)
    if (!strong.length && weak.length < 2) continue
    matches.push({ valueId: category.valueId, label: category.label, word: (strong[0] ?? weak[0])!.word, strong: strong.length > 0, matched: matched.map(entry => entry.word) })
  }
  return matches
}
