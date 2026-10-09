// 学生路径主题词库：预置 16 类发展方向的关键词，直接决定主题标题和分类。
// 模型可以补充语义，但词库命中时优先用词库的标题——让 3 个主题节点
// 稳定、可预期，不因模型每轮的措辞不同而漂移。

export type PathTheme = {
  title: string
  kind: 'pursuit' | 'exploration'
  words: string[]  // 命中任一词即归类
  description: string
}

export const PATH_THEMES: PathTheme[] = [
  { title: '考研', kind: 'pursuit', words: ['考研', '政治', '英语一', '专业课', '真题', '复习', '数学一', '本校', '考上研究生'], description: '备考研究生' },
  { title: '保研', kind: 'pursuit', words: ['保研', '推免', '绩点', 'rank', '综合测评', '科研训练'], description: '保送研究生' },
  { title: '就业', kind: 'pursuit', words: ['就业', '实习', '简历', '面试', 'offer', '秋招', '春招', '求职', '笔试', '产品经理', '运营', '工程师', '设计师', '互联网', '工作'], description: '求职就业准备' },
  { title: '考公', kind: 'exploration', words: ['考公', '公务员', '行测', '申论', '编制', '国考', '省考'], description: '公务员备考' },
  { title: '留学', kind: 'pursuit', words: ['留学', '雅思', '托福', 'GRE', '文书', '套磁', '申请'], description: '出国留学' },
  { title: '创业', kind: 'exploration', words: ['创业', '需求验证', '访谈', '商业计划', '路演', '种子用户', '摆摊'], description: '创业探索' },
  { title: '自由职业', kind: 'exploration', words: ['自由职业', '接单', '甲方', '客户', '稿费', '尾款', '外包'], description: '自由职业接单' },
  { title: '独立开发', kind: 'exploration', words: ['独立开发', '小程序', 'App', '上线', 'SaaS', '工具站'], description: '独立产品开发' },
  { title: '科研', kind: 'pursuit', words: ['科研', '文献', '综述', '实验室', '论文', '课题', '导师'], description: '科研探索' },
  { title: '竞赛', kind: 'pursuit', words: ['竞赛', '建模', '美赛', '国赛', '队伍', '选拔赛', 'ACM', '挑战杯'], description: '竞赛与团队' },
  { title: '自媒体', kind: 'exploration', words: ['自媒体', '公众号', '视频', 'Vlog', '涨粉', '投稿', '账号', '剪辑'], description: '内容创作' },
  { title: '兼职', kind: 'pursuit', words: ['兼职', '家教', '小时工', '补贴', '生活费'], description: '兼职收入' },
  { title: '公益', kind: 'exploration', words: ['公益', '支教', '志愿', '社区服务'], description: '公益与社会服务' },
  { title: '生活平衡', kind: 'pursuit', words: ['熬夜', '休息', '作息', '平衡', '不再'], description: '生活与休息的平衡' },
  { title: '跨专业', kind: 'exploration', words: ['转专业', '跨专业', '转行', '数据分析', '编程', '转码'], description: '跨专业转型' },
]

// 从用户陈述中直接匹配路径主题——命中返回标准化标题，未命中返回 null
export function matchPathTheme(text: string): { title: string; kind: 'pursuit' | 'exploration' } | null {
  for (const path of PATH_THEMES) {
    if (path.words.some(word => text.includes(word))) {
      return { title: path.title, kind: path.kind }
    }
  }
  return null
}
