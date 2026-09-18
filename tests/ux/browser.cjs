const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
 const page=await context.newPage();
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await page.route('**/api/**',route=>route.fulfill({status:200,body:'{}',contentType:'application/json'}));
 await page.addInitScript(()=>{
  window.MediaSource=undefined; window.ManagedMediaSource=undefined;
  const p=HTMLMediaElement.prototype;
  Object.defineProperty(p,'src',{get(){return this.dataset.mockSrc || ''},set(v){this.dataset.mockSrc=v}});
  Object.defineProperty(p,'paused',{get(){return this._paused ?? false}});
  Object.defineProperty(p,'duration',{get(){return 3600}});
  Object.defineProperty(p,'currentTime',{get(){return this._time||0},set(v){this._time=v;window.seekWrites=(window.seekWrites||[]).concat(v)}});
  Object.defineProperty(p,'seekable',{get(){return {length:1,start:()=>0,end:()=>120}}});
  p.canPlayType=()=> 'probably';
  p.load=function(){if(this.dataset.mockSrc) setTimeout(()=>this.dispatchEvent(new Event('loadedmetadata')),20)};
  p.play=function(){this._paused=false;this.dispatchEvent(new Event('playing'));return Promise.resolve()};
  p.pause=function(){this._paused=true;this.dispatchEvent(new Event('pause'))};
 });
 await page.goto('http://127.0.0.1:4173/tests/ux/index.html');
 await page.waitForSelector('video'); await page.waitForTimeout(500);
 await page.waitForTimeout(3200);
 assert(await page.locator('.player-bottom').evaluate(el=>el.inert),'controls hide');
 await page.touchscreen.tap(190,350);
 assert(!(await page.locator('.player-bottom').evaluate(el=>el.inert)),'tap reveals');
 await page.touchscreen.tap(340,350); await page.touchscreen.tap(340,350);
 assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),10,'double tap seeks 10');
 await page.touchscreen.tap(40,350); await page.touchscreen.tap(40,350);
 assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),0,'left double tap');
 const slider=page.getByRole('slider'); let box=await slider.boundingBox();
 const sources=[]; page.on('console',m=>{if(m.text().startsWith('Instant HLS source switch:'))sources.push(m.text())});
 await page.mouse.move(box.x+box.width*.1,box.y+22); await page.mouse.down();
 await page.mouse.move(box.x+box.width*.7,box.y+22,{steps:10});
 await page.waitForTimeout(250);
 assert.equal(sources.length,0,'drag previews without restarting');
 assert.match(await slider.getAttribute('aria-valuetext'),/42:/);
 await page.mouse.up();await page.waitForTimeout(300);
 assert.equal(sources.length,1,'release restarts once');
 assert.match(await page.locator('video').getAttribute('data-mock-src'),/start=25\d\d/);
 const cdp=await context.newCDPSession(page);
 box=await slider.boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.2,y:box.y+22}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*.8,y:box.y+22}]});
 assert.equal(sources.length,1);
 assert(Math.abs(Number(await slider.getAttribute('aria-valuenow'))-2880)<5,'touch preview follows drag');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await page.waitForTimeout(200);assert.equal(sources.length,1,'cancel does not commit');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.2,y:box.y+22}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*.7,y:box.y+22}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(200);assert.equal(sources.length,1,'touch release within generated window stays local');
 await slider.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(200);
 assert.equal(sources.length,1,'keyboard seek within generated window stays local');
 const before=await page.evaluate(()=>document.querySelector('video').currentTime);
 await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 assert.equal(await page.evaluate(()=>document.querySelector('video').currentTime),before+30,'rapid skips accumulate');
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 await page.waitForTimeout(3200);assert(!(await page.locator('.player-bottom').evaluate(el=>el.inert)),'paused controls stay visible');
 await slider.focus(); await page.keyboard.press('Home'); await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>document.querySelector('video').paused),true,'far seek preserves pause');
 await page.keyboard.press('Escape');assert.equal(await page.locator('video').count(),0);
 console.log('PASS player hide/reveal, left/right touch seek, preview/commit, far-seek generation, keyboard');
 for(const size of [{width:390,height:844},{width:844,height:390},{width:820,height:1180},{width:1440,height:900}]){
  await page.setViewportSize(size);
  for(const mode of ['details','series','settings','header']){
   await page.goto('http://127.0.0.1:4173/tests/ux/index.html?mode='+mode);await page.waitForTimeout(250);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${mode} horizontal overflow ${size.width}`);
   if (mode==='header' && size.width===390 && process.env.UX_SCREENSHOT) await page.screenshot({path:process.env.UX_SCREENSHOT});
   if(mode!=='header'){
    const dialog=page.getByRole('dialog');const b=await dialog.boundingBox();
    assert(b.y>=0 && b.y+b.height<=size.height+1,`${mode} height ${size.width}`);
    for(let i=0;i<25;i++) await page.keyboard.press('Tab');
    assert(await dialog.evaluate(el=>el.contains(document.activeElement)),'focus remains in dialog');
    await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
   }
  }
 }
 await page.goto('http://127.0.0.1:4173/tests/ux/index.html?mode=closed');
 await page.locator('#opener').click();await page.waitForTimeout(300);
 await page.mouse.click(2,2); assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'opener');
 console.log('PASS phone portrait/landscape, tablet, desktop bounds; Escape, outside dismiss and focus return');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
