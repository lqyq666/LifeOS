import test from 'node:test'
import assert from 'node:assert/strict'
import { openingQuestionDraft } from '../server/reply-draft.ts'

test('progressive JSON decoding waits for a complete question and handles split escapes',()=>{
  const raw=JSON.stringify({reply:'你想先处理哪一步？然后我们再看。',event:{}})
  for(let i=0;i<raw.indexOf('？')+1;i++)assert.equal(openingQuestionDraft(raw.slice(0,i)),null)
  assert.equal(openingQuestionDraft(raw),'你想先处理哪一步？')
  assert.equal(openingQuestionDraft('{"reply":"你想先处理哪一步\\uFF1'),null)
  assert.equal(openingQuestionDraft('{"reply":"你想先处理哪一步\\uFF1F'),'你想先处理哪一步？')
})

test('quoted noun phrases and neutral confirmation syntax do not expose quoted questions or unvalidated status',()=>{
  for(const question of ['先确认一下具体是哪件事：你说的“上次的行动”是什么？','那当时你是通过什么方式发给他的？','我想再确认一个时间点：是在考试前还是考试后？','能具体说说“没有使用”是指什么吗？']){
    const raw=JSON.stringify({reply:question})
    assert.equal(openingQuestionDraft(raw),question)
    assert.equal(openingQuestionDraft(raw.slice(0,raw.lastIndexOf('？'))),null)
  }
  for(const reply of ['示例“你想说什么？”不是实际问句。','你说的“哪个人？”','你说的『哪个人？』','你说的‘哪个人？’','你说的`哪个人？`','那你已经为你保存的材料是什么？','先确认一下：你有焦虑症吗？','先确认一下：<a>材料</a>是哪份？'])assert.equal(openingQuestionDraft(JSON.stringify({reply})),null)
})
test('claims, reasoning, nested JSON, cited content and material do not become preliminary replies',()=>{
  for(const raw of [
    '{"thinking":"你想先处理哪一步？","reply":"你想先处理哪一步？"}',
    '{"event":{"reply":"你想先处理哪一步？"}}',
    '{"reply":"你有焦虑症。你想先处理哪一步？"}',
    '{"reply":"已保存。你想先处理哪一步？"}',
    '{"reply":"你想因为性格问题去治疗吗？"}',
    '{"reply":"你想按照[资料]处理吗？"}',
    '{"reply":"可以说说https://example.invalid吗？"}',
    '{"reply":"你上次做了什么导致他拒绝你？"}',
    '{"reply":"你当时有没有[研究支持]？"}',
    '{"reply":"你这次是怎么已发送材料的？"}',
    '{"reply":"你当时已经发了资料，所以他拒绝了你？"}',
  ])assert.equal(openingQuestionDraft(raw),null,raw)
})

test('neutral retrospective interrogatives can stream without making factual claims',()=>{
  for(const question of ['你上次具体做了什么？','你当时是怎么交付的？','你这次有没有约定时间？','能简单说一下你当时做了什么、针对的是哪件事吗？','你整理的是给谁看的、什么用途的材料？']){
    const raw=JSON.stringify({reply:question+'随后核对其他环节。'})
    assert.equal(openingQuestionDraft(raw),question)
    assert.equal(openingQuestionDraft(raw.slice(0,raw.indexOf('？'))),null)
  }
})

test('a neutral completed question after a factual preamble is an exact fragment, never the unvalidated preamble',()=>{
  const question='能具体说说这次行动是什么吗？'
  const reply='你提到做了上次的行动，但对方没有使用。'+question+'比如是发了什么内容？'
  assert.equal(openingQuestionDraft(JSON.stringify({reply})),question)
  const encoded=JSON.stringify({reply})
  assert.equal(openingQuestionDraft(encoded.slice(0,encoded.indexOf('？'))),null)
  assert.ok(reply.includes(openingQuestionDraft(encoded)!))
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'已保存。'+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'你有焦虑症。'+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'依据[研究]。'+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'对方因为性格拒绝你。'+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'示例“你想说什么？”还没有真实问句。'})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'长的自然承接。'.repeat(1000)+question})),question)
  const confirm='想确认一下：这份就是你交付的材料吗？'
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'你提到整理了资料。'+confirm})),confirm)
  for(const claim of ['已为你保存。','已经替你发送。','已帮你起草。'])assert.equal(openingQuestionDraft(JSON.stringify({reply:claim+confirm})),null)
})

test('an unrendered ordinary causal preamble cannot delay a separate neutral question or expose its assertion',()=>{
  const question='那这位同学当时有没有提出具体需要？'
  const raw=JSON.stringify({reply:'他明确说手机打不开，所以没看。'+question})
  assert.equal(openingQuestionDraft(raw),question)
  assert.equal(openingQuestionDraft(raw.slice(0,raw.indexOf('？'))),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'没有引用资料。那当时有没有约定反馈？'})),'那当时有没有约定反馈？')
  for(const preamble of ['已为你保存。','你有焦虑症。','因为你性格有问题。','依据[来源]。'])assert.equal(openingQuestionDraft(JSON.stringify({reply:preamble+question})),null)
  assert.equal(openingQuestionDraft(JSON.stringify({reply:'那这位同学是因为你不认真所以拒绝你吗？'})),null)
})

