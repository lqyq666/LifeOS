const liveFiles=['live-01-university.test.ts','live-02-memory.test.ts','live-03-internship.test.ts','live-04-experience.test.ts','live-05-pattern.test.ts','live-reliability.test.ts','official-source-public.test.ts','official-attachment-public.test.ts','campus-comparison-real-review.test.ts']
// Existing user edits remain historical source, never active business gates.
const retiredFiles=['campus-grounding-contract.test.ts','campus-reference-context.test.ts','campus-reliability.test.ts','campus-repair.test.ts']
const browserFiles=['action-coach-browser.test.ts']
export function selectBackendTests(available:string[],args:string[]){
  if(args.includes('--engine-workload'))throw new Error('The retired V1.1 workload is not a V1.3 acceptance suite.')
  const targeted=[...new Set(args.filter(arg=>arg.startsWith('--file=')).map(arg=>arg.slice(7)))]
  for(const file of targeted){
    if(!/^[a-z0-9-]+\.test\.ts$/.test(file)||!available.includes(file))throw new Error('Invalid or missing targeted test filename')
    if(retiredFiles.includes(file))throw new Error('This user-edited V1.2 test is preserved as historical source; use the V1.3 regression suites.')
  }
  const files=targeted.length?targeted:available.filter(file=>file.endsWith('.test.ts')&&!retiredFiles.includes(file)&&(args.includes('--browser-only')?browserFiles.includes(file):![...browserFiles,...liveFiles].includes(file))).sort()
  if(!files.length)throw new Error('No backend test files were found.')
  return files
}
