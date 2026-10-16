import { config } from '../server/config.ts'
const port=Number(process.env.LIFEOS_SERVICE_TEST_PORT)
if(!/^lifeos_dialogue_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname.slice(1))||!Number.isInteger(port)||port<1024||port>65535||[8790,55432].includes(port))throw new Error('ISOLATED_SERVICE_TEST_REQUIRED')
config.port=port;config.host='127.0.0.1';config.origin='http://127.0.0.1:'+port
