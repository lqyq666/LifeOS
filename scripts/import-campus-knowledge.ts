import {config} from '../server/config.ts'
import {pool} from '../server/db.ts'
import {campusReferenceCards} from '../server/campus-reference-data.ts'
import {importKnowledge} from '../server/campus-knowledge.ts'
if(!/^lifeos_dialogue_(?:test|live)_/.test(new URL(config.databaseUrl).pathname.slice(1)))throw new Error('This development importer requires an isolated Campus database.')
try{console.log(JSON.stringify(await importKnowledge(campusReferenceCards)))}finally{await pool.end()}
