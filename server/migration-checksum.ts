import {createHash} from 'node:crypto'
export const migrationHash=(sql:string)=>createHash('sha256').update(sql).digest('hex')
// Git archives use LF; the first Windows release used CRLF. Permit only that
// exact byte-equivalence and retain the original recorded checksum untouched.
export function migrationChecksumMatches(sql:string,recorded:string){
 const lf=sql.replace(/\r\n/g,'\n')
 return [sql,lf,lf.replace(/\n/g,'\r\n')].some(value=>migrationHash(value)===recorded)
}
