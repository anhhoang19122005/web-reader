// Requires production web on :3000 connected ONLY to pwa-fixture.mjs on :8099.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const assert = (value,message)=>{if(!value) throw new Error(message);};
  await page.goto('http://localhost:3000/reader/pwa-test/first');
  await page.getByRole('button',{name:'Đọc',exact:true}).waitFor();
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  await page.waitForFunction(async()=>{
    const cache=await caches.open('gac-sach-content-v1'); return !!(await cache.match('/api/books/pwa-test/chapters/first'));
  });
  const manifest = await page.evaluate(async()=>await (await fetch('/manifest.webmanifest')).json());
  assert(manifest.display==='standalone' && manifest.icons.length===2,'Manifest must be installable');
  await page.goto('http://localhost:3000/offline');
  await page.getByRole('button',{name:'Sách thử offline · Chương offline',exact:true}).waitFor();
  await page.context().setOffline(true);
  await page.goto('http://localhost:3000/reader/pwa-test/first');
  await page.getByRole('heading',{name:'Chương offline',exact:true}).waitFor();
  assert((await page.locator('.reader-text').textContent()).includes('Đoạn 79.'),'Offline reload must display cached chapter content');
  assert(await page.locator('audio').count()===0,'Offline must not create speech audio');
  await page.evaluate(()=>{ window.dispatchEvent(new WheelEvent('wheel',{deltaY:1400})); window.scrollTo(0,1400); });
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gac-sach-offline-progress')||'{}')['pwa-test']?.characterPosition>0);
  await page.context().setOffline(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('gac-sach-offline-progress')||'{}')).length===0);
  const stats = await page.evaluate(async()=>await(await fetch('/api/test/stats')).json());
  assert(stats.writes.length===1 && stats.writes[0].characterPosition>0,'Reconnecting must send the queued progress once');
  await page.screenshot({path:'.reader-deploy/pwa-offline-reader.png',animations:'disabled'});
  return 'PASS: real service worker, manifest, cached chapter, offline reload, silent reading, queued progress and reconnect';
}
