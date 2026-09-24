const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'design/gravity/qa');
const stamp = '2026-01-01T00:00:00.000Z';
const media = key => ({url:`/brand/gravity/${key}-2560.webp`,mediumUrl:`/brand/gravity/${key}-1280.webp`,thumbUrl:`/brand/gravity/${key}-640.webp`});
const entries = ['image','video','canvas'].map((kind,i)=>({kind,title:['图片生成','视频生成','无限画布'][i],description:['用 AI 生成惊艳的图像','让画面动起来','在无边界中自由创作'][i],visible:true,media:media(kind)}));
const works = ['architecture','ice','clouds','panther'].map((key,i)=>({id:`00000000-0000-4000-8000-00000000000${i}`,kind:'image',title:['天地之间','冰与光','云上居所','丛林之眼'][i],category:i===1?'人像':i===3?'自然':'建筑',prompt:'测试公开提示词：光影中的创作灵感',media:media(key),poster:null,sortOrder:i}));
const config = {hero:{title:'让想象，\n成为作品。',subtitle:'图像、视频与无限画布，一站式 AI 创作。',visible:true,media:media('hero')},entries};
const adminConfig={hero:{...config.hero,media:{source:'brand',key:'hero'}},entries:entries.map(e=>({...e,media:{source:'brand',key:e.kind}}))};
const adminWorks=works.map((w,i)=>({...w,media:{source:'brand',key:['architecture','ice','clouds','panther'][i]},published:true}));
const wallet={balance:'100',frozen:'0',totalRecharged:'100',totalSpent:'0'};
const user={id:'qa-user',username:'设计验收',role:'admin',status:'active',displayName:'设计验收',preferences:{},wallet,createdAt:stamp};
const site={siteName:'无限画布',registrationEnabled:true,rechargeNotice:'',imageGenerationEnabled:true,videoGenerationEnabled:true,agentEnabled:true,openPlatformEnabled:true};
const models=['image','video'].map(kind=>({value:`qa::${kind}`,channelId:'qa',modelName:`qa-${kind}`,displayName:kind==='image'?'图片测试模型':'视频测试模型',capability:kind,apiFormat:'openai',billingMode:kind==='image'?'per_image':'per_second',unitPrice:'0.1',extraReferencePrice:'0',minCharge:'0',specPrices:{}}));
const project={id:'qa-project',title:'灵感手记',version:1,nodeCount:0,coverFileId:null,createdAt:stamp,updatedAt:stamp,data:{nodes:[],connections:[],chatSessions:[],viewport:{x:0,y:0,k:1}}};
const assets=works.map((w,i)=>({id:`asset-${i}`,kind:'image',title:w.title,content:'',fileId:null,coverFileId:null,tags:[w.category],source:'验收示例',note:'',metadata:{storageKey:['architecture','ice','clouds','panther'][i],width:1024,height:1280,mimeType:'image/webp',bytes:12345},createdAt:stamp,updatedAt:stamp}));
const pageData=items=>({items,total:items.length,page:1,pageSize:20});
let signedIn=true;
let homepageMode='content';
let submitted=[];
let unknown=[];
const api=async route=>{
 const req=route.request(), url=new URL(req.url()), p=url.pathname;
 if(req.method()!=='GET') {
   submitted.push(p);
   if(p==='/api/auth/login'){signedIn=true;return route.fulfill({json:{user}});}
   if(p==='/api/auth/preferences')return route.fulfill({json:{preferences:{}}});
   if(p==='/api/visitors/beacon')return route.fulfill({json:{ok:true}});
   return route.fulfill({status:403,json:{message:'验收禁止业务写入'}});
 }
 let data;
 if(p==='/api/auth/bootstrap')data={site,user:signedIn?user:null};
 else if(p==='/api/homepage'){
   if(homepageMode==='error')return route.fulfill({status:503,json:{message:'测试不可用'}});
   data=homepageMode==='empty'?{config:null,works:[]}:{config,works};
 }
 else if(p.startsWith('/api/homepage/works/'))data=works.find(w=>p.endsWith(w.id));
 else if(p==='/api/admin/homepage')data={initialized:true,config:adminConfig,works:adminWorks};
 else if(p==='/api/models')data={models};
 else if(p==='/api/assets')data=pageData(assets);
 else if(p==='/api/projects')data=pageData([project]);
 else if(p==='/api/projects/qa-project')data=project;
 else if(p.startsWith('/api/files/'))return route.fulfill({contentType:'image/webp',body:await fs.readFile(path.join(root,'web/public/brand/gravity',`${decodeURIComponent(p.split('/').pop())}-640.webp`))});
 else if(p==='/api/wallet')data=wallet;
 else if(p==='/api/reseller/status')data={status:'none',canUseConsole:true,multiplier:'1',surcharge:'0',tierName:null,profile:null};
 else if(p==='/api/reseller/models')data={models:[],multiplier:'1'};
 else if(p==='/api/reseller/tokens/options')data={items:[]};
 else if(p==='/api/reseller/profile')data={status:'none',wallet,multiplier:'1',surcharge:'0',lifetime:{billedAmount:'0',requests:0,inputTokens:0,outputTokens:0}};
 else if(p==='/api/reseller/realtime')data={qps:0,rpm:0,tpm:0,tasks:0};
 else if(p==='/api/reseller/overview')data={today:{requests:0,totalTokens:0,billedAmount:'0'},yesterday:{requests:0,totalTokens:0,billedAmount:'0'},tokens:{total:0,active:0,activeToday:0,activeYesterday:0},throughput:{qps:0,rpm:0,tpm:0,tasks:0},distribution:[],recent:[]};
 else if(p==='/api/card-shop/catalog')data={available:false,items:[],methods:[]};
 else if(p==='/api/wallet/recharge-catalog')data={available:false,packages:[],methods:[],allowCustomAmount:false,notice:'验收模式不进行付款'};
 else if(p.startsWith('/api/announcements')||p.startsWith('/api/wallet/')||p==='/api/generations'||p==='/api/tasks'||p==='/api/reseller/tokens'||p==='/api/reseller/logs')data=pageData([]);
 else {unknown.push(p);data={};}
 return route.fulfill({json:data??{},headers:{'Cache-Control':'no-store'}});
};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',reducedMotion:'reduce'});
 await context.route(url => url.pathname.startsWith('/api/'),api);
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const results=[];
 let delayHomepageAssets=false;
 await context.route(url=>url.pathname.startsWith('/brand/gravity/'),async route=>{
  if(delayHomepageAssets) await new Promise(resolve=>setTimeout(resolve,700));
  await route.continue();
 });
 async function visit(url,name,width=1440){
   await page.setViewportSize({width,height:1000});
   await page.goto(`http://127.0.0.1:3000${url}`,{waitUntil:'networkidle'});
   if(url==='/canvas/qa-project')await page.getByRole('button',{name:'灵感手记',exact:true}).waitFor();
   assert.equal(await page.locator('vite-error-overlay').count(),0,`Vite overlay at ${url}`);
   await page.screenshot({path:path.join(output,`${name}-${width}.png`),animations:'disabled'});
   const state=await page.evaluate(()=>({gravity:document.documentElement.classList.contains('gravity'),wide:document.documentElement.scrollWidth>innerWidth,body:document.body.innerText.slice(0,180)}));
   results.push({url,width,...state});
   assert.ok(state.body,`Empty route at ${url}`);
   assert.equal(state.wide,false,`Horizontal overflow at ${url} ${width}`);
 }
 try {
   delayHomepageAssets=true;
   await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
   await page.waitForTimeout(150);
   assert.equal(await page.locator('main h1').count(),0,'Homepage text must wait until its images decode');
   await page.locator('main h1').waitFor();
   delayHomepageAssets=false;
   await visit('/image','image-history');
   assert.equal(await page.getByRole('button',{name:'收起导航'}).count(),0,'The fixed sidebar has no collapse control');
   assert.equal(await page.locator('aside').first().evaluate(el=>Math.round(el.getBoundingClientRect().width)),216);
   await page.getByRole('button',{name:'生成记录'}).click();
   await page.getByRole('button',{name:'关闭生成记录'}).waitFor();
   assert.ok(await page.locator('.ant-drawer-content-wrapper').last().evaluate(el=>el.getBoundingClientRect().width<=420));
   await page.getByRole('button',{name:'关闭生成记录'}).click();
   await visit('/video','video-history');
   await page.getByRole('button',{name:'生成记录'}).click();
   await page.getByRole('button',{name:'关闭生成记录'}).waitFor();
   assert.ok(await page.locator('.ant-drawer-content-wrapper').last().evaluate(el=>el.getBoundingClientRect().width<=420));
   await page.getByRole('button',{name:'关闭生成记录'}).click();
   for(const width of [1920,1440,768,390])for(const [url,name] of [['/','home'],['/image','image'],['/video','video'],['/assets','assets'],['/canvas','projects'],['/canvas/qa-project','canvas'],['/open/console','console']])await visit(url,name,width);
   for(const [url,name] of [['/open','open'],['/open/docs','docs'],['/open/console/tokens','tokens'],['/open/console/logs','logs'],['/open/console/models','models'],['/open/console/profile','profile'],['/open/console/docs','console-docs'],['/cards','cards'],['/cards/orders','orders'],['/admin/homepage','admin-homepage']])await visit(url,name);
   assert.equal(await page.locator('html').getAttribute('class').then(v=>v.includes('gravity')),false);
   await page.getByRole('tab',{name:'精选作品',exact:true}).click();
   await page.getByRole('button',{name:'新增作品',exact:true}).click();
   await page.getByRole('dialog').waitFor();
   await page.screenshot({path:path.join(output,'admin-work-editor.png'),animations:'disabled'});
   assert.equal(await page.getByRole('dialog').getByLabel('分类',{exact:true}).inputValue(),'影像');
   await visit('/','home-back');
   assert.equal(await page.locator('html').getAttribute('class').then(v=>v.includes('gravity')),true);
   await page.getByRole('button',{name:'预览天地之间'}).click();
   await page.getByRole('button',{name:/创作同款/}).click();
   await page.waitForURL('**/image');
   assert.equal(await page.locator('textarea').first().inputValue(),works[0].prompt);
   await page.getByRole('button',{name:/^充\s*值$/}).click();
   await page.getByRole('dialog').waitFor();
   await page.screenshot({path:path.join(output,'wallet.png'),animations:'disabled'});
   for(const label of ['余额流水','使用记录','充值订单','账号安全']) {
     await page.getByRole('button',{name:label,exact:true}).click();
     await page.screenshot({path:path.join(output,`account-${label}.png`),animations:'disabled'});
     await page.getByRole('dialog').last().locator('.ant-drawer-close').click();
   }
   await page.getByRole('dialog').getByRole('button',{name:'充值',exact:true}).click();
   await page.getByRole('dialog',{name:'充值',exact:true}).waitFor();
   await page.screenshot({path:path.join(output,'recharge.png'),animations:'disabled'});
   await page.getByRole('button',{name:'兑换',exact:true}).click();
   await page.screenshot({path:path.join(output,'redeem.png'),animations:'disabled'});
   signedIn=false;await visit('/','guest');
   await page.getByRole('button',{name:'预览天地之间'}).click();
   await page.getByRole('button',{name:/创作同款/}).click();
   await page.getByRole('dialog',{name:'无限画布'}).waitFor();
   await page.screenshot({path:path.join(output,'login.png'),animations:'disabled'});
   homepageMode='empty';await visit('/','empty');
   assert.equal(await page.locator('img[src*="hero"]').count(),0);
   homepageMode='error';await visit('/','error');
   await page.getByRole('button',{name:/^重\s*试$/}).waitFor();
   assert.equal(submitted.filter(p=>!['/api/visitors/beacon','/api/auth/login','/api/auth/preferences'].includes(p)).length,0);
 } finally {
   await fs.writeFile(path.join(output,'results.json'),JSON.stringify({mode:'isolated browser, mocked API; no live business writes',results,errors,unknown:[...new Set(unknown)],submitted},null,2));
   console.log(JSON.stringify({screens:results.length,errors,unknown:[...new Set(unknown)],submitted}));
   await browser.close();
 }
 assert.deepEqual(errors,[]);
})().catch(e=>{console.error(e);process.exitCode=1;});
