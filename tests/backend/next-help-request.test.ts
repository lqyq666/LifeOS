import test from 'node:test'
import assert from 'node:assert/strict'
import {responseRequestScope} from '../../server/user-command-spans.ts'

test('asking what to do next requests actual help, without turning quoted or past questions into instructions',()=>{
 for(const text of ['接着上次方向变化，我今天先做什么？请使用我最新选择，别继续催考研资料，也别把岗位探索说成已经投递。','接着上次报名表的反馈，我下一次先处理什么，为什么？','下一步怎么开始？','我现在具体先做哪一步？','我接下来该做什么？','我下一步该怎么做？','我该先做哪一步？'])assert.equal(responseRequestScope(text).actionRequested,true,text)
 for(const text of ['室友问我今天先做什么。','“我今天先做什么？”','我昨天先做了什么？','如果我今天先做什么会更好？','我不知道他先做什么。','我今天先做什么？不过现在只想被倾听。'])assert.equal(responseRequestScope(text).actionRequested,false,text)
 for(const text of ['我现在具体先做哪一步？','我该先做哪一步？','我下一步该怎么做？','我现在具体先做什么？','我接下来该做什么？','我下一次先处理什么？'])assert.equal(responseRequestScope(text).actionLimit,1,text)
 assert.equal(responseRequestScope('我该先做哪一步？不过现在只想被倾听。').actionLimit,undefined)
})
