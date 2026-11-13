import {readFile,writeFile} from 'node:fs/promises'
import {feedbackLoopStats,type LoopObservation} from './feedback-loop-operations.ts'
import {pool} from './db.ts'

// Operator-only CLI. This opens no HTTP endpoint and dispatches no model call.
// node --import tsx server/feedback-loop-report.ts observation.json [report.json]
try{
 const [input,output]=process.argv.slice(2)
 if(!input)throw new Error('Usage: feedback-loop-report.ts observation.json [report.json]')
 const observation=JSON.parse(await readFile(input,'utf8')) as LoopObservation
 const report=JSON.stringify(await feedbackLoopStats(observation),null,2)+'\n'
 if(output)await writeFile(output,report,{flag:'wx'})
 else process.stdout.write(report)
}catch(error){console.error(error instanceof Error?error.message:'LOOP_REPORT_FAILED');process.exitCode=1}
finally{await pool.end()}
