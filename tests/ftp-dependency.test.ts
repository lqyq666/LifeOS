import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
const require=createRequire(import.meta.url)
const {getUri}=require('get-uri')
const ftpRequire=createRequire(require.resolve('get-uri'))

test('patched FTP dependency rejects adversarial directory listings without blocking the test process',()=>{
  const entry=ftpRequire.resolve('basic-ftp')
  const code=`const {parseList}=require(${JSON.stringify(entry)});for(const n of [1000,10000,100000]){try{parseList('-rw-r--r-- 1 '+'word '.repeat(n)+'!')}catch{}}console.log('bounded')`
  const result=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:3000,windowsHide:true})
  assert.equal(result.status,0,result.error?.message??result.stderr);assert.equal(result.stdout.trim(),'bounded')
})

test('get-uri keeps MDTM fallback LIST, passive download and cache compatibility with patched basic-ftp',async()=>{
  const commands:string[]=[],sockets=new Set<net.Socket>(),servers:net.Server[]=[]
  let bounce=false
  const listen=(server:net.Server)=>new Promise<number>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve((server.address() as net.AddressInfo).port))})
  const control=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{})
    socket.write('220 Synthetic local FTP\r\n')
    let pending='',data:net.Socket|undefined,dataReady:Promise<net.Socket>|undefined
    socket.on('data',chunk=>{
      pending+=chunk.toString()
      while(pending.includes('\r\n')){
        const split=pending.indexOf('\r\n'),line=pending.slice(0,split);pending=pending.slice(split+2)
        commands.push(line.split(' ')[0])
        void (async()=>{
          const command=line.split(' ')[0]
          if(command==='USER')socket.write('331 Anonymous only\r\n')
          else if(command==='PASS')socket.write('230 Logged in\r\n')
          else if(command==='FEAT')socket.write('211 No features\r\n')
          else if(command==='MDTM')socket.write('500 MDTM unsupported\r\n')
          else if(command==='EPSV'){
            if(bounce){socket.write('500 EPSV unsupported\r\n');return}
            const server=net.createServer(s=>{data=s;sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{})})
            servers.push(server)
            dataReady=new Promise(resolve=>server.once('connection',resolve))
            const port=await listen(server);socket.write(`229 Entering Extended Passive Mode (|||${port}|)\r\n`)
          }else if(command==='PASV')socket.write('227 Entering Passive Mode (8,8,8,8,7,138)\r\n')
          else if(command==='LIST'||command==='RETR'){
            socket.write('150 Data follows\r\n')
            data=data??await dataReady!
            const stream=data;data=undefined;dataReady=undefined
            stream.once('close',()=>socket.write('226 Complete\r\n'))
            stream.end(command==='LIST'?'type=file;size=13;modify=20260101000000; policy.txt\r\n':'synthetic PAC')
          }else if(command==='QUIT')socket.end('221 Goodbye\r\n')
          else socket.write('200 OK\r\n')
        })().catch(()=>socket.destroy())
      }
    })
  })
  servers.push(control)
  try{
    const port=await listen(control),url=`ftp://127.0.0.1:${port}/policy.txt`
    const stream=await getUri(url,{timeout:2000}),parts:Buffer[]=[]
    for await(const part of stream)parts.push(Buffer.from(part))
    assert.equal(Buffer.concat(parts).toString(),'synthetic PAC')
    assert.ok(commands.includes('MDTM'));assert.ok(commands.includes('LIST'));assert.ok(commands.includes('RETR'))
    await assert.rejects(getUri(url,{cache:stream,timeout:2000}),{code:'ENOTMODIFIED'})
    bounce=true
    await assert.rejects(getUri(url,{timeout:2000}),/PASV returned another host/,'patched default refuses a server-controlled separate transfer host before connecting')
  }finally{
    for(const socket of sockets)socket.destroy()
    await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))))
  }
})

