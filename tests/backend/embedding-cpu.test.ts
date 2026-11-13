import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'

test('offline encoder thread count obeys CPU quota and affinity while retaining the four-thread ceiling',()=>{
 const code=`import sys,os
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path('server').resolve()))
from embedding_cpu import inference_threads
cases=[('100000 100000',8,16,1),('150000 100000',8,16,1),('250000 100000',8,16,2),('max 100000',8,16,4),('max 100000',2,16,2),('bad',8,16,4),('100000 0',8,16,4),('0 100000',8,16,1),('max 100000',8,None,1)]
for quota,affinity,cores,expected in cases:
 with patch.object(Path,'read_text',return_value=quota),patch.object(os,'cpu_count',return_value=cores),patch.object(os,'sched_getaffinity',return_value=set(range(affinity)),create=True):
  assert inference_threads()==expected,(quota,affinity,cores,inference_threads(),expected)
with patch.object(Path,'read_text',side_effect=FileNotFoundError),patch.object(os,'cpu_count',return_value=8),patch.object(os,'sched_getaffinity',return_value={0},create=True):
 assert inference_threads()==1
print('PASS_10_CPU_CAPACITY_CASES_NO_MODEL_OR_DATABASE_CALLS')`
 const result=spawnSync(process.env.LIFEOS_EMBEDDING_PYTHON||'python',['-c',code],{encoding:'utf8',timeout:20000})
 assert.equal(result.status,0,result.stderr||String(result.error))
 assert.match(result.stdout,/PASS_10_CPU_CAPACITY_CASES/)
})
