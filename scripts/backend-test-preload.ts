import { config } from '../server/config.ts'

const raw=process.env.LIFEOS_ISOLATED_TEST_DATABASE_URL
if(!raw)throw new Error('Isolated backend-test database URL is required.')
const target=new URL(raw)
const database=decodeURIComponent(target.pathname.slice(1))
if(!/^lifeos_dialogue_(?:test|live)_[a-z0-9_]+$/.test(database))throw new Error('Backend tests require a disposable dialogue-test database.')
config.databaseUrl=target.href
