// Deterministic defect gate for the four independent single-turn sets.
// It is keyed on the prompt class, not on the version, so candidate and
// baseline are judged by the same rule. A pass here only means "this known
// defect shape is absent"; it is not an overall quality verdict.
const rules = {
  'zero-time': (output) => {
    // A "问自己" checklist is not a question to the user.
    const selfCheck = /(?:问自己|自问|逐段问|问一问自己)/.test(output)
    const asksInfo = /(?:我需要知道|你方便|列一下|告诉我|哪几门)/.test(output) ||
      /有没有[^。！？\n]{0,20}[？?]/.test(output)
    const asks = (/[？?]/.test(output) && !selfCheck) || asksInfo
    const task = /(?:只完成|需要完成|先完成|必须完成|这周.{0,8}完成|本周.{0,8}完成)/.test(output)
    return !asks && !task
  },
  receipt: (output) =>
    !/已读/.test(output) &&
    !/不代表他看过/.test(output),
  access: (output, vars) => {
    // Audio/video access is solved by transcoding or a compatible player; a
    // form needs a fillable/editable route, not a PDF/screenshot. Keep the
    // three alternatives distinct.
    const userText = vars?.userText ?? ''
    const audioVideo = /(?:音频|视频|录音|放不出来|播放)/.test(userText)
    const fillable = /(?:报名表|申请表|申请书|表格|表单|填写|填表)/.test(userText)
    const hasAlternative = fillable
      ? /(?:可编辑|在线填写|在线编辑|Word|word|Excel|excel|xlsx|权限|编辑)|(?:电脑|平板)[^。！？\n]{0,16}(?:填|编辑)/.test(output)
      : audioVideo
        ? /(?:转码|转成|转换|MP3|mp3|AAC|aac|WAV|wav|MP4|mp4|换播放器|播放器)/.test(output)
        : /(?:PDF|pdf|截图|图片|Word|word|导出|换(?:个|一种)?格式)/.test(output)
    const rewrite = /(?:重新制作|重做)/.test(output) &&
      !/(?:不|别|无需|不用|不想|不要)(?:再)?(?:重新制作|重做)/.test(output)
    return hasAlternative && !rewrite
  },
  clickable: (output) => {
    if (!/(?:可点击|Figma|figma|墨刀|交互原型|原型工具)/.test(output)) return false
    if (/先画一张.{0,8}草图/.test(output)) return false
    const numbered = [...output.matchAll(/(?:^|[。；;：:\n])\s*(\d+)\.\s+\S/g)].map(m => Number(m[1]))
    if (numbered.length && numbered[0] !== 1) return false
    return /(?:假设|验证)/.test(output) && /(?:停止|观察|记录|标准|2 位|2个|3个)/.test(output)
  },
  'two-factor': (output) => {
    // A tail disclaimer does not cancel a causal assertion in an earlier
    // sentence. Only a softener in the same sentence makes that sentence safe.
    const strong = /(?:是主因|才是关键|是主要推动|是主要作用|是关键变量|起作用|说明.{0,10}是.{0,10}(?:环境|同伴|作息|跑步|咖啡|番茄钟|导师|课题))/
    const softened = /(?:更可能|可能是|或许|不一定|不能证明|不证明因果)/
    return !output.split(/(?<=[。！？!?；;\n])/).some(sentence => strong.test(sentence) && !softened.test(sentence))
  },
  'single-lead': (output) => {
    const expands = /(?:再找|再问|观察更多|找更多|问更多|看更多).{0,10}(?:同学|人|学生|受访者|用户)/.test(output)
    const negated = /(?:不是|不|别|无需|不用)(?:再|去)?(?:找|问|观察|看)更多|不扩大样本|不增加样本/.test(output)
    return !(expands && !negated)
  },
  'one-question': (output) => /[？?]/.test(output),
  refusal: (output) => /(?:不聊|不谈|不建议|不给建议)/.test(output),
  correction: (output) => /(?:更正|已按|按.*(?:算|记录|处理)|收到)/.test(output),
  status: (output, vars) => {
    const receiptOnly = /(?:回复|说|确认).{0,8}(?:收到了|收到|已收到)/.test(vars?.userText ?? '') &&
      !/已读/.test(vars?.userText ?? '')
    if (!receiptOnly) return true
    // "是否已读仍未知" is an unknown, not a read claim. "内容评价仍未知"
    // does not make a read statement unknown, so keep the check local.
    const readClaim = /(?:已读|确认读到|确认阅读|读到了|读到|看过|看了|阅读过|已阅读|阅读了|已经阅读|已看|查看了)/
    const uncertainRead = /(?:是否|未读|尚未读|已读[^。！？]{0,6}(?:未知|与否|状态未知)|读到[^。！？]{0,6}(?:未知|与否))/
    return !output.split(/(?<=[。！？!?；;\n])/).some(sentence =>
      readClaim.test(sentence) && !uncertainRead.test(sentence)
    )
  },
  'unsupported-preference': (output) =>
    !/你(?:明确|已经)?不想(?:找客户|获客|接单|收款)/.test(output),
  'unsupported-zero-time': (output) =>
    !/(?:本周|这周|今天|现在|目前).{0,6}(?:无|没有|零)\s*(?:可用)?时间|零时间/.test(output),
  quantity: (output, vars) => {
    const match = /(?:只|仅)?(?:想|愿意|要|会)?(?:看|了解|找|问|联系|访谈|比较)?\s*一(?:个|位|名|条|份)\s*([^，。；\n的]{1,12})/.exec(String(vars?.userText ?? ''))
    if (!match) return true
    const object = match[1].trim()
    if (object.length < 2) return true
    const escaped = object.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const count = new RegExp(`(?:[2-9]|[两三四五六七八九十]|几|多)\\s*(?:个|位|名|条|份)[^。！？\\n]{0,12}${escaped}`)
    return !count.test(output)
  },
  default: () => true,
};

export default function defectGate(output, context) {
  const vars = context?.vars ?? {}
  const category = vars.category ?? 'default'
  const rule = rules[category] ?? rules.default
  const pass = Boolean(rule(String(output ?? ''), vars))
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? `defect-gate: ${category} passed` : `defect-gate: ${category} failed`,
  }
}
