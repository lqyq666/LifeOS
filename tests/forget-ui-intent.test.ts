import test from 'node:test'
import assert from 'node:assert/strict'
import {detectForgetIntentClauses} from '../server/forget-intent.ts'

test('removing a product UI feature does not authorize deleting a saved personal goal',()=>{
 for(const text of ['补充LifeOS的产品取舍：我要求删除对比分析面板，让回复分点说明。','请删掉这个功能','移除对比分析按钮'])assert.deepEqual(detectForgetIntentClauses(text),[],text)
 assert.equal(detectForgetIntentClauses('请删除关于这个面板的经历记录。')[0]?.kind,'forget')
 assert.equal(detectForgetIntentClauses('删除这条目标记录。')[0]?.kind,'forget')
})
