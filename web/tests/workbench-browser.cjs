const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'design/gravity/qa/workbench');
const wallet = { balance:'100', frozen:'0', totalRecharged:'100', totalSpent:'0' };
const user = { id:'workbench-test', username:'设计验收', role:'user', status:'active', displayName:'设计验收', preferences:{}, wallet, createdAt:new Date().toISOString() };
const site = { siteName:'无限画布', registrationEnabled:true, imageGenerationEnabled:true, videoGenerationEnabled:true, agentEnabled:false, openPlatformEnabled:true };
const models = ['image','video'].map(kind => ({ value:`qa::${kind}`, channelId:'qa', modelName:kind, displayName:kind==='image'?'Seedream 4.0':'Seedance 2.0', capability:kind, apiFormat:'openai', billingMode:kind==='image'?'per_image':'per_second', unitPrice:'0.1', extraReferencePrice:'0.2', minCharge:'0.1', specPrices:{}, features:{resolutions:['1K','2K','4K'], maxCount:15, supportsTransparent:true, aspectRatios:['auto','1:1','16:9','9:16','4:3','3:4'], videoResolutions:['480','720','1080'], minSeconds:4,maxSeconds:15} }));
const tasks = [];
const makeTask = (kind, n, status='succeeded') => ({ id:`${kind}-${n}`, capability:kind, modelName:kind, model:`qa::${kind}`, status, prompt:['银色巨鲸游弋于赤色沙漠上空，远处行者仰望，电影质感。','花间梦境，午后阳光与柔和胶片色彩。','云上居所，黄昏中的悬浮建筑。','冰与光，极地之境。'][n%4], quantity:kind==='video'?5:3,succeededCount:status==='succeeded'?3:0,estimatedCost:'0.30',actualCost:'0.30', outputFileIds:[],outputs:status==='succeeded'||status==='partial'?Array.from({length:3},(_,i)=>({id:`${kind}-${n}-${i}`,storageKey:kind==='video'?'test-video':['image','panther','clouds'][i],mimeType:kind==='image'?'image/webp':'video/mp4',bytes:1000,width:1920,height:1080,durationMs:5000})):[],outputText:'',error:status==='failed'?'上游服务繁忙，请编辑后重试':'',params:{count:kind==='image'?3:1,size:'16:9',quality:'2K',seconds:5,resolution:'720',references:[]},createdAt:new Date(Date.now()-n*60000).toISOString(),finishedAt:null});
for(const kind of ['image','video'])for(let i=0;i<27;i++)tasks.push(makeTask(kind,i,i===1?'running':i===2?'pending':i===3?'failed':'succeeded'));
const submitted=[];
const idempotent=new Map();
let finish=false; let videoBuffer;
const api=async route=>{
 const req=route.request(), url=new URL(req.url()), p=url.pathname;
 if(p.includes('/api/files/test-video'))return route.fulfill({contentType:'video/mp4',body:videoBuffer});
 if(p.startsWith('/api/files/'))return route.fulfill({contentType:'image/webp',body:await fs.readFile(path.join(root,'web/public/brand/gravity',`${decodeURIComponent(p.split('/').pop())}-640.webp`))});
 if(req.method()==='POST'&&p==='/api/generations'){
  const input=req.postDataJSON(),key=req.headers()['idempotency-key'];submitted.push({input,key});
  if(idempotent.has(key))return route.fulfill({json:idempotent.get(key)});
  const task={...makeTask(input.capability,100+submitted.length,'running'),prompt:input.prompt,params:{...input},createdAt:new Date().toISOString()};
  idempotent.set(key,task); tasks.unshift(task);return route.fulfill({json:task});
 }
 let data;
 if(p==='/api/auth/bootstrap')data={user,site};
 else if(p==='/api/models')data={models};
 else if(p==='/api/wallet')data=wallet;
 else if(p==='/api/generations'){
  const filtered=tasks.filter(t=>t.capability===url.searchParams.get('capability')&&(url.searchParams.get('status')!=='active'||['pending','running'].includes(t.status)));
  const page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('pageSize')||20);
  data={items:filtered.slice((page-1)*size,page*size),total:filtered.length,page,pageSize:size};
 }else if(p.startsWith('/api/generations/')){
  data=tasks.find(t=>t.id===p.split('/').pop());
  if(finish&&data&&data.id.includes('10')){data.status='succeeded';data.outputs=makeTask(data.capability,0).outputs;}
 }else if(p==='/api/auth/preferences')data={preferences:req.postDataJSON()};
 else if(p==='/api/visitors/beacon')data={ok:true};
 else data={items:[],total:0,page:1,pageSize:20};
 return route.fulfill({json:data??{}});
};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN',reducedMotion:'reduce'});
 await context.route(url=>url.pathname.startsWith('/api/'),api);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  // MDN's CC0 video is used only as a mocked result fixture, never sent to the app server.
  const videoResponse=await fetch('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
  assert.ok(videoResponse.ok);videoBuffer=Buffer.from(await videoResponse.arrayBuffer());
  for(const kind of ['image','video']){
   await page.goto(`http://127.0.0.1:3000/${kind}`);
   await page.getByRole('button',{name:'任务记录',exact:true}).waitFor();
   await page.locator('article').first().waitFor();
   if(kind==='video'){await page.locator('article video').first().evaluate(video=>{video.muted=true;return video.play();});await page.waitForFunction(()=>document.querySelector('article video')?.readyState>=2);await page.locator('article video').first().evaluate(video=>video.pause());}
   for(const [width,height] of [[1440,900],[1920,1080],[1024,768],[390,844]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(150);
    const geometry=await page.getByRole('region',{name:'生成结果工作区'}).evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight,bottom:el.getBoundingClientRect().bottom,viewport:innerHeight,wide:document.documentElement.scrollWidth>innerWidth}));
    assert.equal(geometry.wide,false,`${kind} horizontal overflow ${width}`);
    assert.ok(geometry.scroll<=geometry.client+1,`${kind} right scroll ${width}: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.bottom<=geometry.viewport,`${kind} bottom ${width}`);
    assert.equal(await page.locator('article img').evaluateAll(imgs=>imgs.every(img=>getComputedStyle(img).objectFit==='contain')),true);
    await page.screenshot({path:path.join(output,`${kind}-${width}.png`)});
   }
  }
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:3000/image');
  await page.locator('article').first().waitFor();
  await page.getByRole('switch',{name:'启用图片批量任务'}).click();
  await page.locator('#image-prompt').fill('并发任务一，长图构图。\n\n并发任务二，横图构图。\n\n并发任务三，广角摄影。');
  await page.getByRole('button',{name:/批量生成图片/}).click();
  await page.waitForFunction(()=>!document.querySelector('main .ant-btn-loading'));
  await page.waitForTimeout(300);
  assert.equal(submitted.length,3);assert.equal(new Set(submitted.map(x=>x.key)).size,3);
  assert.deepEqual(submitted.map(x=>x.input.prompt),['并发任务一，长图构图。','并发任务二，横图构图。','并发任务三，广角摄影。']);
  await page.getByRole('switch',{name:'启用图片批量任务'}).click();
  await page.locator('#image-prompt').fill('持续提交的第四个任务');
  await page.getByRole('button',{name:/^生成图片/}).click();await page.waitForTimeout(200);
  assert.equal(submitted.length,4);
  await page.screenshot({path:path.join(output,'image-concurrent.png')});
  finish=true;
  await page.reload();await page.waitForTimeout(2000);
  assert.equal(submitted.length,4,'reload must not resubmit generation');
  await page.getByRole('button',{name:'任务记录',exact:true}).click();
  await page.getByRole('dialog',{name:'任务记录'}).waitFor();
  await page.getByRole('dialog',{name:'任务记录'}).locator('button').filter({hasText:'持续提交的第四个任务'}).click();
  await page.getByRole('dialog',{name:'任务详情'}).waitFor();
  assert.equal(await page.getByRole('button',{name:/查看结果 \d/}).count(),3);
  await page.getByRole('button',{name:'查看结果 2',exact:true}).click();
  await page.screenshot({path:path.join(output,'image-detail.png')});
  await page.getByRole('dialog',{name:'任务详情'}).locator('.ant-modal-close').click();
  await page.getByRole('dialog',{name:'任务记录'}).locator('.ant-drawer-close').click();
  await page.locator('button[aria-label*="亮色"]').click();
  await page.waitForFunction(()=>!document.documentElement.classList.contains("dark")); await page.waitForTimeout(500); await page.screenshot({path:path.join(output,'image-light.png')});
  await page.goto('http://127.0.0.1:3000/video');
  await page.locator('article').first().waitFor();
  await page.getByText('Seedance 2.0',{exact:true}).waitFor();
  await page.getByRole('switch',{name:'启用视频批量任务'}).click();


  await page.locator('#video-prompt').fill(['第一个视频，缓慢推进。','第二个视频，平移镜头。'].join('\n\n'));
  await page.getByRole('button',{name:/批量生成视频/}).click();
  await page.waitForTimeout(300);
  assert.equal(submitted.filter(x=>x.input.capability==='video').length,2);
  assert.ok(submitted.filter(x=>x.input.capability==='video').every(x=>x.input.seconds===5&&x.input.count===1));
  await page.screenshot({path:path.join(output,'video-light-concurrent.png')});
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({ok:true,submissions:submitted.length,errors,screenshots:output},null,2));
 }catch(error){await page.screenshot({path:path.join(output,"failure.png")}); console.error({videoBytes:videoBuffer?.length,media:await page.locator("video").evaluateAll(videos=>videos.map(v=>({ready:v.readyState,network:v.networkState,error:v.error?.message,src:v.currentSrc}))),errors,body:(await page.locator("body").innerText()).slice(-4000),submitted}); throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});







