// No app JS or API requests execute. Tests the head bootstrap before hydration.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  await page.addInitScript(()=>localStorage.setItem('gac-sach-preferences',JSON.stringify({state:{theme:'forest'},version:0})));
  await page.route('**/_next/static/**/*.js',(route)=>route.abort());
  await page.goto('http://localhost:3000/library',{waitUntil:'domcontentloaded'});
  const theme = await page.evaluate(()=>({theme:document.documentElement.dataset.theme,color:getComputedStyle(document.body).backgroundColor}));
  if(theme.theme!=='forest' || theme.color!=='rgb(24, 37, 30)') throw new Error(`Wrong pre-hydration theme: ${JSON.stringify(theme)}`);
  return 'PASS: saved forest background applied with application JavaScript blocked';
}
