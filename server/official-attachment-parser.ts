import {createHash} from 'node:crypto'
import {fromBuffer,type Entry} from 'yauzl'
import mammoth from 'mammoth'
import readExcelFile from 'read-excel-file/node'
import {load} from 'cheerio'

export type AttachmentExtraction={status:'parsed'|'partial'|'unsupported'|'rejected';hash:string;format:'docx'|'xlsx'|'unknown';text:string;cells?:{sheet:string;address:string;value:string}[];warnings:string[];errorCode?:string}
class UnsafeAttachment extends Error{constructor(public code:string){super(code)}}
const reject=(code:string):never=>{throw new UnsafeAttachment(code)}
// No ZIP paths are written. All decompressed bytes are counted before the
// mature Office readers run; malformed, encrypted or active content is refused.
async function inspectZip(bytes:Buffer){
  return new Promise<Map<string,Buffer>>((resolve,rejectPromise)=>{
    fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
      if(error||!zip){rejectPromise(new UnsafeAttachment('ATTACHMENT_ZIP_INVALID'));return}
      const entries=new Map<string,Buffer>();let count=0,total=0,settled=false
      const fail=(code:string)=>{if(settled)return;settled=true;zip.close();rejectPromise(new UnsafeAttachment(code))}
      zip.on('error',()=>fail('ATTACHMENT_ZIP_INVALID'))
      zip.on('end',()=>{if(!settled){settled=true;zip.close();resolve(entries)}})
      zip.on('entry',(entry:Entry)=>{
        if(++count>256||entry.uncompressedSize>4*1024*1024||(total+=entry.uncompressedSize)>12*1024*1024){fail('ATTACHMENT_ZIP_LIMIT');return}
        const name=entry.fileName
        if(entries.has(name)||name.startsWith('/')||name.split('/').some(part=>part==='..')||name.includes('\\')||entry.generalPurposeBitFlag&1){fail('ATTACHMENT_ZIP_UNSAFE');return}
        if(/(?:vbaproject|macros|embeddings|activex|externallinks)(?:[/.]|$)/i.test(name)){fail('ATTACHMENT_ACTIVE_CONTENT');return}
        if(name.endsWith('/')){entries.set(name,Buffer.alloc(0));zip.readEntry();return}
        zip.openReadStream(entry,(readError,stream)=>{
          if(readError||!stream){fail('ATTACHMENT_ZIP_INVALID');return}
          const chunks:Buffer[]=[];let size=0
          stream.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>entry.uncompressedSize||size>4*1024*1024){stream.destroy();fail('ATTACHMENT_ZIP_LIMIT');return}chunks.push(chunk)})
          stream.on('error',()=>fail('ATTACHMENT_ZIP_INVALID'))
          stream.on('end',()=>{if(settled)return;entries.set(name,Buffer.concat(chunks));zip.readEntry()})
        })
      });zip.readEntry()
    })
  })
}
function xml(bytes:Buffer){
  // Unsupported encodings are rejected rather than allowing an encoding trick
  // to hide an entity declaration from the preflight inspection.
  if(bytes.includes(0)||/<!\s*(?:DOCTYPE|ENTITY)/i.test(bytes.toString('utf8')))reject('ATTACHMENT_XML_UNSAFE')
  return load(bytes.toString('utf8'),{xmlMode:true})
}
function column(value:string){return [...value].reduce((number,letter)=>number*26+letter.charCodeAt(0)-64,0)}
function columnName(value:number){let name='';for(;value;value=Math.floor((value-1)/26))name=String.fromCharCode(65+(value-1)%26)+name;return name}
export async function parseAttachmentBytes(bytes:Buffer,expected:'docx'|'xlsx'|'unknown'):Promise<AttachmentExtraction>{
  const hash=createHash('sha256').update(bytes).digest('hex')
  const base={hash,format:expected,text:'',warnings:[] as string[]}
  if(bytes.length>2*1024*1024)return {...base,status:'rejected',errorCode:'ATTACHMENT_INPUT_LIMIT'}
  if(expected==='unknown'||bytes.subarray(0,4).toString('hex')!=='504b0304')return {...base,status:'unsupported',errorCode:'ATTACHMENT_FORMAT_UNSUPPORTED'}
  try{
    const entries=await inspectZip(bytes);let cells=0,hasFormula=false
    for(const [name,buffer] of entries){
      if(!/\.(?:xml|rels)$/i.test(name))continue
      const $=xml(buffer)
      const select=(local:string)=>$('*').filter((_i,node)=>'name' in node&&node.name.split(':').at(-1)===local)
      if(name.endsWith('.rels'))select('Relationship').each((_i,node)=>{
        const element=$(node)
        if(element.attr('TargetMode')==='External'&&!/\/hyperlink$/.test(element.attr('Type')??''))reject('ATTACHMENT_EXTERNAL_RESOURCE')
        if(element.attr('TargetMode')==='External')base.warnings.push('外部超链接仅作为原文，不读取目标')
      })
      if(/macroEnabled|vbaProject|oleObject|activeX/i.test(buffer.toString('utf8')))reject('ATTACHMENT_ACTIVE_CONTENT')
      if(select('instrText').toArray().some(node=>/INCLUDETEXT|INCLUDEPICTURE|DDEAUTO|DDE\s/i.test($(node).text())))reject('ATTACHMENT_EXTERNAL_RESOURCE')
      if(/^xl\/worksheets\//.test(name)){
        select('row').each((_i,node)=>{const r=Number($(node).attr('r'));if(!Number.isInteger(r)||r<1||r>5000)reject('ATTACHMENT_GRID_LIMIT')})
        select('c').each((_i,node)=>{const match=/^([A-Z]{1,3})(\d{1,7})$/.exec($(node).attr('r')??'');if(!match||column(match[1])>50||Number(match[2])>5000||++cells>25000)reject('ATTACHMENT_GRID_LIMIT')})
        select('dimension').each((_i,node)=>{for(const address of ($(node).attr('ref')??'').split(':')){const match=/^([A-Z]{1,3})(\d{1,7})$/.exec(address);if(!match||column(match[1])>50||Number(match[2])>5000)reject('ATTACHMENT_GRID_LIMIT')}})
        if(select('f').length||select('c').toArray().some(node=>$(node).attr('t')==='str'))hasFormula=true
      }
    }
    if(expected==='docx'){
      if(!entries.has('word/document.xml')||entries.has('xl/workbook.xml'))reject('ATTACHMENT_FORMAT_MISMATCH')
      const result=await mammoth.extractRawText({buffer:bytes})
      base.text=result.value.trim();base.warnings.push('只提取段落文字，自动编号、表格布局与图像未还原；空白登记表不是个人填写结果')
      if(result.messages.length)base.warnings.push('文档读取器存在警告，未认证排版或完整性')
    }else{
      if(!entries.has('xl/workbook.xml')||entries.has('word/document.xml'))reject('ATTACHMENT_FORMAT_MISMATCH')
      if(hasFormula)return {...base,status:'unsupported',errorCode:'ATTACHMENT_FORMULA_UNSUPPORTED',warnings:['不执行公式，也不把缓存值当成已核实计算结果']}
      const sheets=await readExcelFile(bytes,{trim:false})
      if(sheets.length>20)reject('ATTACHMENT_GRID_LIMIT')
      base.warnings.push('单元格原值保留坐标；显示格式未还原，合并单元格未自动填充，不自动推断专业资格')
      const positions:NonNullable<AttachmentExtraction['cells']>=[]
      for(const sheet of sheets)for(const [r,row] of sheet.data.entries())for(const [c,value] of row.entries()){
        if(value===null||value===undefined)continue
        positions.push({sheet:sheet.sheet,address:columnName(c+1)+(r+1),value:value instanceof Date?value.toISOString():String(value)})
      }
      base.text=positions.map(cell=>`${cell.sheet}!${cell.address}: ${cell.value}`).join('\n')
      if(base.text.length>200000)reject('ATTACHMENT_TEXT_LIMIT')
      return {...base,status:positions.length?'parsed':'partial',cells:positions,warnings:[...new Set(base.warnings)]}
    }
    if(base.text.length>200000)reject('ATTACHMENT_TEXT_LIMIT')
    return {...base,status:base.text?'parsed':'partial',warnings:[...new Set(base.warnings)]}
  }catch(error){return {...base,text:'',status:'rejected',errorCode:error instanceof UnsafeAttachment?error.code:'ATTACHMENT_PARSE_FAILED'}}
}
