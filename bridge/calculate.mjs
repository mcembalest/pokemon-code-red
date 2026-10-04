import { Worker } from 'node:worker_threads';
const input=process.argv[2];
const worker=new Worker(new URL('./node-worker.mjs',import.meta.url));
const timer=setTimeout(()=>{worker.terminate();process.exitCode=1},3000);
worker.on('message',data=>{clearTimeout(timer);worker.terminate();if(!data.ok){console.error(data.error);process.exitCode=1}else console.log(JSON.parse(data.json).total)});
worker.on('error',()=>{clearTimeout(timer);worker.terminate();process.exitCode=1});
worker.postMessage({id:1,source:process.argv[3]==='error'?'while(true){}':'return {total:input.stats.reduce((a,b)=>a+b,0)};',input});
