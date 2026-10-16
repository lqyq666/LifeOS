import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),JSZip=require('jszip')
export async function officeFixture(format:'docx'|'xlsx',extra:Record<string,string>={}){
  const zip=new JSZip()
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+ (format==='docx'?'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>':'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>')+'</Types>')
  zip.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${format==='docx'?'word/document.xml':'xl/workbook.xml'}"/></Relationships>`)
  if(format==='docx')zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SYNTHETIC 浙江2026文件，仅演示解析，不证明资格。</w:t></w:r></w:p></w:body></w:document>')
  else{
    zip.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="专业表" sheetId="1" r:id="rId1"/></sheets></workbook>')
    zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
    zip.file('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>代码</t></is></c></row><row r="3"><c r="B3" t="inlineStr"><is><t> 0012 </t></is></c><c r="C3"><v>0</v></c></row></sheetData></worksheet>')
  }
  for(const [name,value] of Object.entries(extra))zip.file(name,value)
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}) as Promise<Buffer>
}
