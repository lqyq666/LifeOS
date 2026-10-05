import {parentPort,workerData} from 'node:worker_threads'
import {parseAttachmentBytes} from './official-attachment-parser.ts'
if(!parentPort)throw new Error('Attachment parsing requires an isolated worker')
parentPort.postMessage(await parseAttachmentBytes(Buffer.from(workerData.bytes),workerData.format))
