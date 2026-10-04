import {pool} from '../server/db.ts'
import {setProviderBudget,providerBudgetView} from '../server/provider-spend.ts'
const [operation,id,amount]=process.argv.slice(2)
try{
 if(!id)throw new Error('BUDGET_ID_REQUIRED')
 if(operation==='set')await setProviderBudget(id,Number(amount))
 else if(operation==='pause')await pool.query('UPDATE lifeos_provider_budgets SET enabled=false,revision=revision+1,updated_at=now() WHERE id=$1',[id])
 else if(operation!=='show')throw new Error('USAGE_SET_PAUSE_SHOW')
 console.log(JSON.stringify(await providerBudgetView(id)))
}catch{console.error('PROVIDER_BUDGET_OPERATION_FAILED');process.exitCode=1}
finally{await pool.end()}
