import test from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ReplyMarkdown} from '../src/features/conversation/ReplyMarkdown.tsx'
const render=(text:string)=>renderToStaticMarkup(createElement(ReplyMarkdown,{text}))

test('separators render as rules rather than stray markdown text',()=>{
 const html=render('已有依据。\n\n---\n\n仍未知。')
 assert.ok(html.includes('<hr class="qa-md-rule"/>'));assert.ok(!html.includes('---'))
})

test('inline emphasis never swallows neighbouring Chinese text',()=>{
 const html=render('目前仅有本人画像作为测试数据，**真实效果仍未知**。读取背景并给出建议。**记录原话反馈**，不假设完成。')
 assert.ok(html.includes('目前仅有本人画像作为测试数据，<strong>真实效果仍未知</strong>。读取背景并给出建议。<strong>记录原话反馈</strong>，不假设完成。'),html)
 assert.ok(render('先说明 *仍未知*，再核验。').includes('<em class="qa-md-em">仍未知</em>'))
})

test('single line bold section headings preserve paragraph breaks',()=>{
 const html=render('**已有依据**\n做过原型。\n\n**仍待验证**\n真实需求未知。')
 assert.ok(html.includes('class="qa-md-lead"><strong>已有依据</strong></p><p>做过原型。</p>'),html)
})

test('summary side rail preserves line breaks and selective emphasis',()=>{
 const html=render('先看目前的判断。\n\n> **更接近的方向**\n> 先体验实际岗位，考研保留为选项。\n\n再按真实反馈调整。')
 assert.ok(html.includes('<blockquote class="qa-md-quote"><strong>更接近的方向</strong>\n先体验实际岗位，考研保留为选项。</blockquote>'))
 assert.ok(html.includes('<p>再按真实反馈调整。</p>'))
})
test('legacy inline paths become distinct ordered items with all suggestions preserved',()=>{
 const html=render('推荐三条路径：1. 用AI制作作品集；2. 为社团剪辑视频；3. 搭建问答机器人。')
 assert.equal((html.match(/<li /g)??[]).length,3)
 for(const text of ['推荐三条路径：','用AI制作作品集','为社团剪辑视频','搭建问答机器人'])assert.ok(html.includes(text))
})
test('ordinary prose, decimals, versions, code and incomplete enumerations stay literal',()=>{
 for(const text of ['先用1.5小时验证。版本1.2.3。','只需一句倾听。','推荐：1.5小时；2.5小时','代码：`1. foo;2. bar`','链接 https://example.com/1. foo 2. bar'])assert.ok(!render(text).includes('<ol'))
})
test('existing markdown lists and paragraph separation continue to render',()=>{
 const html=render('**方向**\n\n1. 第一项\n2. 第二项\n\n后续步骤。')
 assert.equal((html.match(/<li /g)??[]).length,2);assert.ok(html.includes('<p>后续步骤。</p>'))
})

test('ordered reply numbers keep the original labels rather than being renumbered',()=>{
 const html=render('5. 先核对已有条件\n7. 再保留未知\n\n完成后再决定。')
 assert.ok(html.includes('qa-md-num">5</span>'))
 assert.ok(html.includes('qa-md-num">7</span>'))
 assert.ok(!html.includes('qa-md-num">1</span>'))
})
