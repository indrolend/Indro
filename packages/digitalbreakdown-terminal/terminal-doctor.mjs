import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const WebSocket=require('ws');
const checks=[];
const add=(name,status,detail)=>checks.push({name,status,detail});
const run=(cmd,args,options={})=>spawnSync(cmd,args,{
  cwd:root,encoding:'utf8',timeout:15000,...options
});
const git=(...args)=>run('git',['-C',root,...args]);
const timeout=(ms)=>new Promise((_,reject)=>
  setTimeout(()=>reject(Error('TIMEOUT')),ms));

async function probeSocket(url,ms=4000){
  return Promise.race([
    new Promise((resolve,reject)=>{
      const ws=new WebSocket(url,{handshakeTimeout:ms});
      ws.once('open',()=>{ws.close();resolve(true)});
      ws.once('error',reject);
    }),
    timeout(ms)
  ]);
}

async function checkGit(){
  const branch=git('branch','--show-current');
  const state=git('status','--porcelain');
  if(branch.status!==0||state.status!==0){
    add('GIT','FAIL','Unable to inspect repository');
    return;
  }
  const count=state.stdout.split(/\r?\n/).filter(Boolean).length;
  add('GIT','PASS',`${branch.stdout.trim()} | ${count} changes preserved`);
}

async function checkServer(){
  const ps=run('powershell.exe',['-NoProfile','-Command',
    "$x=Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue;"+
    "foreach($p in $x){$o=Get-CimInstance Win32_Process -Filter \"ProcessId=$($p.OwningProcess)\";"+
    "Write-Output \"$($p.OwningProcess)|$($o.Name)|$($o.CommandLine)\"}"
  ]);
  const lines=ps.stdout.trim().split(/\r?\n/).filter(Boolean);
  if(ps.status!==0){add('PORT','UNKNOWN','Process inspection failed');return}
  if(!lines.length){add('PORT','FAIL','No listener on 8765');return}
  const owned=lines.some(x=>/node\.exe/i.test(x)&&/server\.cjs/i.test(x));
  add('PORT',owned?'PASS':'WARN',lines.join(' | ').slice(0,300));
}

async function checkHTTP(){
  try{
    const response=await Promise.race([
      fetch('http://127.0.0.1:8765/'),
      timeout(4000)
    ]);
    add('HTTP',response.status===200?'PASS':'FAIL',`HTTP ${response.status}`);
  }catch(e){add('HTTP','FAIL',e.message)}
}

async function checkTerminal(){
  try{
    await probeSocket('ws://127.0.0.1:8765/terminal');
    add('WEBSOCKET','PASS','Handshake accepted');
  }catch(e){
    add('WEBSOCKET','UNKNOWN',`Handshake not established: ${e.message}`);
  }
}

async function checkCDP(){
  try{
    const response=await Promise.race([
      fetch('http://127.0.0.1:9222/json/list'),
      timeout(3000)
    ]);
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const targets=await response.json();
    const pages=targets.filter(t=>
      t.type==='page'&&t.url==='http://127.0.0.1:8765/');
    add('CDP',pages.length===1?'PASS':'WARN',
      `INDRO pages=${pages.length}`);
  }catch(e){
    add('CDP','WARN',`Unavailable: ${e.message}`);
  }
}

function checkTests(){
  const result=run(process.execPath,['--test'],{timeout:120000});
  const output=(result.stdout||'')+'\n'+(result.stderr||'');
  const match=output.match(/(?:^|\n)\s*[ℹ]?\s*pass\s+(\d+)/);
  add('TESTS',result.status===0?'PASS':'FAIL',
    `exit=${result.status} passed=${match?.[1]??'unknown'}`);
}

await checkGit();
await checkServer();
await checkHTTP();
await checkTerminal();
await checkCDP();
checkTests();

const receipt={
  schema:'indro.terminal.doctor.v0',
  timestamp:new Date().toISOString(),
  checks
};
const destination=join(process.env.TEMP||root,'indro-terminal-doctor.json');
writeFileSync(destination,JSON.stringify(receipt,null,2));

for(const c of checks)
  console.log(`${c.name.padEnd(12)} ${c.status.padEnd(7)} ${c.detail}`);
console.log(`RECEIPT=${destination}`);
console.log(`RESULT=${checks.some(c=>c.status==='FAIL')?'FAIL':
  checks.some(c=>c.status==='WARN'||c.status==='UNKNOWN')?'PARTIAL':'PASS'}`);
