// Local operator command; no management web endpoint, passwords never passed as CLI arguments.
import { readFileSync } from 'node:fs'
import { betterAuth } from 'better-auth'
import { authOptions } from '../server/auth.ts'
import { pool } from '../server/db.ts'
const file=process.env.LIFEOS_NEW_USER_FILE
if(!file)throw new Error('Provide LIFEOS_NEW_USER_FILE pointing to a private JSON file with email, name, password')
try{
  const input=JSON.parse(readFileSync(file,'utf8'))
  if(typeof input.email!=='string'||typeof input.name!=='string'||typeof input.password!=='string'||input.password.length<12)throw new Error('Invalid account input')
  const operator=betterAuth({...authOptions,emailAndPassword:{...authOptions.emailAndPassword,disableSignUp:false}})
  await operator.api.signUpEmail({body:{email:input.email,name:input.name,password:input.password}})
  console.log('ACCOUNT_CREATED')
}finally{await pool.end()}
