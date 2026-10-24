/** Read-only native storage profile. See docs/API_PERFORMANCE.md. */
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
// Use only a QA workspace the operator owns. No workspace or preference writes occur.
const sessionFile = process.env.CODEX_BENCH_SESSION_FILE;
const workspaceId = process.env.CODEX_BENCH_WORKSPACE_ID;
const reportFile = process.env.CODEX_BENCH_REPORT || '/tmp/codex-native-storage-profile.json';
if (!sessionFile || !workspaceId || !/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId)) throw new Error('Set CODEX_BENCH_SESSION_FILE and CODEX_BENCH_WORKSPACE_ID for an owned QA workspace.');
const sessionStat = await fs.lstat(sessionFile);
if (!sessionStat.isFile() || sessionStat.isSymbolicLink() || (sessionStat.mode & 0o077)) throw new Error('Use a regular mode-0600 session file.');
const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
if (typeof session.base !== 'string' || typeof session.cookie !== 'string' || /[\r\n]/.test(session.cookie)) throw new Error('Session file must contain base and cookie strings.');
const origin = new URL(session.base);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Use an HTTPS application origin without URL credentials.');
const base = origin.origin, cookie = session.cookie;
const request = async (route, method='GET', body) => {
 const response=await fetch(`${base}/api${route}`,{method,headers:{Cookie:cookie,'X-Codex-Workspace':'1','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`API ${route} returned ${response.status}`);
 return response.json();
};
const before=await request('/bootstrap');
if(!before.workspaces.some(item=>item.id===workspaceId))throw new Error('Owned QA workspace is unavailable.');
const terminal=await request(`/workspaces/${workspaceId}/terminals`,'POST',{});
const socket=new WebSocket(`${base.replace(/^http/,'ws')}/ws/terminal/${terminal.id}`,{headers:{Cookie:cookie,Origin:base}});
const marker=randomUUID(),begin=`\x1e${marker}:begin\x1f`,end=`\x1e${marker}:end\x1f`;
const program=String.raw`
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
const directory='/data/codex-workspace/state';
const entries=await fs.readdir(directory,{withFileTypes:true});
const existingName=entries.find(entry=>entry.isFile()&&/^workspace-(?:record|legacy-v)-[a-zA-Z0-9_-]+\.json$/.test(entry.name))?.name;
if(!existingName)throw new Error('No bounded non-credential workspace metadata record found.');
const existing=path.join(directory,existingName);
if((await fs.stat(existing)).size>256*1024)throw new Error('Selected metadata record exceeds probe limit.');
const absent=path.join(directory,'api-perf-absent-'+randomUUID()+'.json');
const measured={};
const started=performance.now();
async function measure(name,operation,count=20,gap=0){
 const values=[];let hits=0,misses=0,bytes=0;
 for(let i=0;i<count;i++){
  if(i&&gap)await new Promise(resolve=>setTimeout(resolve,gap));
  const start=performance.now();
  try { const result=await operation();hits++;if(Buffer.isBuffer(result))bytes+=result.length; }
  catch(error){if(error?.code==='ENOENT')misses++;else throw new Error('Filesystem probe failed: '+(error?.code||'unknown'));}
  values.push(performance.now()-start);
 }
 const sorted=[...values].sort((a,b)=>a-b);
 measured[name]={count,hits,misses,...(bytes?{bytesRead:bytes}:{}),firstMs:Number(values[0].toFixed(3)),p50Ms:Number(sorted[Math.ceil(count*.5)-1].toFixed(3)),p95Ms:Number(sorted[Math.ceil(count*.95)-1].toFixed(3)),maxMs:Number(sorted.at(-1).toFixed(3)),samplesMs:values.map(value=>Number(value.toFixed(3)))};
}
await measure('existingStat',()=>fs.stat(existing));
await measure('existingRead',()=>fs.readFile(existing));
await measure('directoryList',()=>fs.readdir(directory,{withFileTypes:true}));
await measure('sameMissingStatBurst',()=>fs.stat(absent));
await measure('sameMissingReadBurst',()=>fs.readFile(absent));
await measure('newMissingStat',()=>fs.stat(path.join(directory,'api-perf-absent-'+randomUUID()+'.json')),10);
await measure('newMissingRead',()=>fs.readFile(path.join(directory,'api-perf-absent-'+randomUUID()+'.json')),10);
await measure('sameMissingStat1100msApart',()=>fs.stat(absent),6,1100);
const remaining=11000-(performance.now()-started);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
await measure('existingStatAfter11seconds',()=>fs.stat(existing),5);
await measure('directoryListAfter11seconds',()=>fs.readdir(directory,{withFileTypes:true}),5);
const countPrefix=prefix=>entries.filter(entry=>entry.name.startsWith(prefix)&&entry.name.endsWith('.json')).length;
console.log(JSON.stringify({capturedAt:new Date().toISOString(),node:process.version,elapsedMs:Number((performance.now()-started).toFixed(3)),registryCounts:{entries:entries.length,current:countPrefix('workspace-record-'),legacyBase:countPrefix('workspace-legacy-')-countPrefix('workspace-legacy-v-'),legacyVersions:countPrefix('workspace-legacy-v-'),archived:countPrefix('workspace-archived-')},measurements:measured}));
`;
const quote=value=>`'${value.replace(/'/g,"'\\''")}'`;
let output='';
try{
 const result=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Native timing probe timed out')),45000);let sent=false;
  socket.on('error',error=>{clearTimeout(timeout);reject(error);});
  socket.on('message',bytes=>{
   const item=JSON.parse(bytes.toString());
   if(item.type==='ready'&&!sent){sent=true;socket.send(JSON.stringify({type:'input',data:`printf '\\036${marker}:begin\\037\\n'; node --input-type=module --eval ${quote(program)}; printf '\\036${marker}:end\\037\\n'\r`}));}
   if(item.type==='output'){
    output=(output+(item.data||'')).slice(-256*1024);
    if(output.includes(end)){
      clearTimeout(timeout);
      const body=output.slice(output.indexOf(begin)+begin.length,output.indexOf(end)).replace(/\r/g,'').trim();
      try{resolve(JSON.parse(body));}catch{reject(new Error('Probe did not return a timing report.'));}
    }
   }
   if(item.type==='error'){clearTimeout(timeout);reject(new Error('Terminal probe reported an error.'));}
  });
 });
 await fs.writeFile(reportFile,JSON.stringify(result,null,2)+'\n',{mode:0o600});
 for(const [name,value] of Object.entries(result.measurements))process.stdout.write(JSON.stringify({name,...value})+'\n');
 process.stdout.write(JSON.stringify({registryCounts:result.registryCounts,elapsedMs:result.elapsedMs})+'\n');
}finally{
 socket.terminate();await request(`/terminals/${terminal.id}`,'DELETE').catch(()=>undefined);
 const after=await request('/bootstrap');
 process.stdout.write(JSON.stringify({activeWorkspaceUnchanged:before.activeWorkspaceId===after.activeWorkspaceId,ownedQaWorkspacePresent:after.workspaces.some(item=>item.id===workspaceId)})+'\n');
}
