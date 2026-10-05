import {readFileSync} from 'node:fs'
import {config} from '../server/config.ts'
import {pool} from '../server/db.ts'
import {syncOfficialSource,officialSourceRegistry,approveOfficialKnowledge} from '../server/official-sources.ts'
if(!/^lifeos_dialogue_(?:test|live)_/.test(new URL(config.databaseUrl).pathname.slice(1)))throw new Error('Official source maintenance currently requires an isolated local database; no production access.')
const args=process.argv.slice(2)
try{
  if(args.includes('--fetch'))for(const entry of officialSourceRegistry)console.log(JSON.stringify(await syncOfficialSource(entry)))
  else if(args.includes('--approve')){
    const path=args[args.indexOf('--approve')+1],review=JSON.parse(readFileSync(path,'utf8'))
    console.log(JSON.stringify(await approveOfficialKnowledge(review.sourceId,review.expectedRevision,review.cards)))
  }else throw new Error('Choose --fetch (public pages only, no model) or --approve <maintenance-reviewed JSON>')
}finally{await pool.end()}
