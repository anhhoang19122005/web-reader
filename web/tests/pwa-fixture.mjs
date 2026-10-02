// Disposable backend for production PWA checks. No MongoDB, secrets or real books.
import http from 'node:http';
const text = Array.from({ length:80 },(_,i)=>(`Đoạn ${i}. Một câu chuyện thử khi mất mạng. `).repeat(8)+'\n\n').join('');
const chapters = [{ id:'first',chapterNumber:1,title:'Chương offline' }];
const book = { id:'pwa-test',title:'Sách thử offline',author:'Test',hasCover:false,chapterCount:1,progressPercent:0,lastReadAt:null,chapters };
let prefs = null;
const writes = [];
http.createServer(async (request,response)=>{
  let raw=''; for await (const part of request) raw+=part;
  const body=raw ? JSON.parse(raw) : null;
  const path=request.url.split('?')[0];
  const json=(value,status=200)=>{ response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify(value)); };
  if(path==='/api/health') return json({status:'UP'});
  if(path==='/api/test/stats') return json({writes});
  if(path==='/api/reader/preferences') { if(request.method==='PATCH') prefs={...prefs,...body}; return json({preferences:prefs,updatedAt:null}); }
  if(path==='/api/books') return json([book]);
  if(path==='/api/books/pwa-test') return json(book);
  if(path==='/api/books/pwa-test/chapters/first') return json({...chapters[0],plainText:text,contentHtml:''});
  if(path==='/api/reader/progress/pwa-test') { if(request.method==='PUT') writes.push(body); return json({bookId:book.id,chapterId:'first',characterPosition:0}); }
  if(path==='/api/reader/bookmarks/pwa-test') return json([]);
  if(path==='/api/tts/voices') return json([{id:'test',provider:'edge',name:'Giọng thử',language:'vi'}]);
  if(path==='/api/tts/chunks/first') return json([{chunkIndex:0,text:'Thử',startCharacter:0,endCharacter:3}]);
  return json({message:'Fixture only: unknown request'},404);
}).listen(8099,'127.0.0.1',()=>process.stdout.write('PWA fixture ready on 8099\n'));
