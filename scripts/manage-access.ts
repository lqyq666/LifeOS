import {config} from '../server/config.ts'
import {pool} from '../server/db.ts'
import {grantEntitlement,entitlementView} from '../server/entitlements.ts'

// Run inside the trusted application container/local operator shell. Database
// credentials remain in its environment; password input is stdin, never argv.
const operation=process.argv[2]
config.entitlementsEnabled=true
try{
  if(operation==='create'){
    let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>4096)throw new Error('INPUT_TOO_LARGE')}
    const input=JSON.parse(text)
    if(typeof input.email!=='string'||typeof input.password!=='string'||input.password.length<6||!Number.isInteger(input.limit)||input.limit<1||input.limit>1000000||!Number.isFinite(Date.parse(input.expiresAt))||Date.parse(input.expiresAt)<=Date.now())throw new Error('INVALID_ACCOUNT_INPUT')
    // This process alone may create a manual account; public signup stays closed.
    config.signupEnabled=true
    const {auth}=await import('../server/auth.ts')
    const result=await auth.api.signUpEmail({body:{email:input.email,name:input.name||'邀请用户',password:input.password}})
    await grantEntitlement(result.user.id,input.limit,input.expiresAt)
    console.log(JSON.stringify({userId:result.user.id,access:await entitlementView(result.user.id)}))
  }else{
    const user=process.argv[3]
    if(!user)throw new Error('USER_ID_REQUIRED')
    if(operation==='grant')await grantEntitlement(user,Number(process.argv[4]),process.argv[5])
    else if(operation==='revoke'){
      const result=await pool.query('UPDATE lifeos_entitlements SET enabled=false,revision=revision+1,updated_at=now() WHERE user_id=$1',[user])
      if(!result.rowCount)throw new Error('ENTITLEMENT_NOT_FOUND')
    }else if(operation!=='show')throw new Error('USAGE_CREATE_GRANT_REVOKE_SHOW')
    console.log(JSON.stringify({userId:user,access:await entitlementView(user)}))
  }
}catch(error){
  // Authentication/SQL errors may contain private inputs. Never echo them.
  console.error('ACCESS_OPERATION_FAILED');process.exitCode=1
}finally{await pool.end()}
