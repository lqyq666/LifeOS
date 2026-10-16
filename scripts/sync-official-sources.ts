import {readFileSync} from 'node:fs'
import {config} from '../server/config.ts'
import {pool} from '../server/db.ts'
import {syncOfficialSource,officialSourceRegistry,approveOfficialKnowledge} from '../server/official-sources.ts'
import {syncOfficialAttachment} from '../server/official-attachments.ts'
if(!/^lifeos_dialogue_(?:test|live)_/.test(new URL(config.databaseUrl).pathname.slice(1)))throw new Error('Official source maintenance currently requires an isolated local database; no production access.')
const args=process.argv.slice(2)
try{
  if(args.includes('--fetch'))for(const entry of officialSourceRegistry)console.log(JSON.stringify(await syncOfficialSource(entry)))
  else if(args.includes('--attachments')){
    const sourceId=args[args.indexOf('--attachments')+1]
    const row=(await pool.query('SELECT id,revision,payload FROM official_sources WHERE id=$1',[sourceId])).rows[0]
    if(!row)throw new Error('Source snapshot required')
    for(const attachment of row.payload.extraction?.attachments??[])console.log(JSON.stringify(await syncOfficialAttachment(row.id,row.revision,attachment.url)))
  }
  else if(args.includes('--approve')){
    const path=args[args.indexOf('--approve')+1],review=JSON.parse(readFileSync(path,'utf8'))
    console.log(JSON.stringify(await approveOfficialKnowledge(review.sourceId,review.expectedRevision,review.cards)))
  }else throw new Error('Choose --fetch, --attachments <current source ID>, or --approve <maintenance-reviewed JSON> (no model)')
}finally{await pool.end()}
