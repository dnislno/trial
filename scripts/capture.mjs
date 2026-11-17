import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname, join, sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const root=resolve('source'), output=resolve('render/assets');
await mkdir(output,{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.mp4':'video/mp4','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{try{
 const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const sites=[
 {id:'butik',file:'butik.html',type:'collection'},
 {id:'restoran',file:'restoran.html',type:'menu',selector:'#hidangan'},
 {id:'perusahaan',file:'perusahaan.html',type:'services',selector:'#layanan'},
 {id:'digital',file:'digital.html',type:'video'}
];
let browser,activeEncoder;
const report=[];
try{
 browser=await chromium.launch({headless:true});
 for(const site of sites){
  const context=await browser.newContext({viewport:{width:390,height:693},deviceScaleFactor:2,reducedMotion:'reduce'});
  const page=await context.newPage();
  await page.goto(`${base}/${site.file}`,{waitUntil:'load',timeout:60000});
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('body').waitFor({state:'visible'});
  if(site.type==='video'){
   await page.locator('video').waitFor({state:'visible'});
   await page.evaluate(async()=>{const v=document.querySelector('video');v.muted=true;await v.play();await new Promise((ok,bad)=>{if(v.readyState>=2)return ok();v.addEventListener('loadeddata',ok,{once:true});setTimeout(()=>bad(Error('Video DIGITAL tidak termuat')),20000);});v.pause();});
  }
  await page.addStyleTag({content:'html{scroll-behavior:auto!important}*{caret-color:transparent!important}'});
  const encoder=spawn('ffmpeg',['-v','error','-y','-f','image2pipe','-framerate','24','-vcodec','png','-i','pipe:0','-vf','scale=720:1280:flags=lanczos','-an','-c:v','libx264','-crf','16','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart',join(output,`${site.id}.mp4`)],{stdio:['pipe','inherit','inherit']});
  activeEncoder=encoder;
  const finished=new Promise((ok,bad)=>{encoder.once('error',bad);encoder.once('close',c=>c===0?ok():bad(Error(`FFmpeg exited ${c}`)));});
  let target=site.selector?await page.locator(site.selector).evaluate(el=>Math.max(0,el.getBoundingClientRect().top+scrollY-76)):0;
  for(let f=0;f<96;f++){
   const t=f/24;
   if(site.type==='collection'&&f===29){
    await page.getByText('Semua koleksi',{exact:true}).first().click();
    await page.locator('#collection-results').waitFor({state:'visible'});
   }
   if(site.selector){const p=Math.max(0,Math.min(1,(t-.65)/1.45));const eased=p*p*(3-2*p);await page.evaluate(y=>window.scrollTo(0,y),target*eased);}
   if(site.type==='collection'&&f>35){const p=Math.min(1,(f-35)/42);await page.evaluate(y=>{const el=document.querySelector('#page-dialog');if(el)el.scrollTop=y;},p*250);}
   if(site.type==='menu'&&f===70){await page.locator('[data-category="minuman"]').click();}
   if(site.type==='video')await page.evaluate(async(time)=>{const v=document.querySelector('video');const duration=Number.isFinite(v.duration)?v.duration:10;const next=Math.min(duration-.1,time+.1);if(Math.abs(v.currentTime-next)<.001)return;await new Promise((ok,bad)=>{const timeout=setTimeout(()=>bad(Error('DIGITAL video seek timeout')),10000);v.addEventListener('seeked',()=>{clearTimeout(timeout);ok();},{once:true});v.currentTime=next;});},t);
   const png=await page.screenshot({type:'png',animations:'disabled'});
   if(f===12||f===70)await writeFile(join(output,`${site.id}-review-${f}.png`),png);
   if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
  }
  encoder.stdin.end();await finished;activeEncoder=undefined;
  report.push({site:site.id,frames:96,fps:24,duration:4,source:site.file,title:await page.title(),status:'captured'});
  await context.close();
 }
 await writeFile(join(output,'capture-report.json'),JSON.stringify(report,null,2));
}finally{activeEncoder?.stdin.destroy();activeEncoder?.kill();await browser?.close();server.close();}
