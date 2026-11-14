// Targeted chat integration on a MOCK HTTP/WebSocket transport. Nothing connects to Supabase.
// Uses a prebuilt local app with ui-harness fake settings/no-env-files preload. No build here.
// node scripts/tests/chat-integration-ui.mjs
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { appEnv, checker, createBackend, launchBrowser, newContext, root, startApp } from './ui-harness.mjs'

const port=3009, out=`${root}/test-results/chat-integration`, results=[], errors=[]
const check=checker(results), only=process.env.CHAT_ONLY ? new RegExp(process.env.CHAT_ONLY) : null
const run=(name,fn)=>!only||only.test(name)?check(name,fn):Promise.resolve()
const user='00000000-0000-4000-8000-0000000000e1', member='00000000-0000-4000-8000-0000000000e2'
const other='00000000-0000-4000-8000-0000000000e3'
const message=(id,body,at,project='P1',author=member)=>({id,project_id:project,author_id:author,body,created_at:at,parent_message_id:null,edited_at:null,is_deleted_for_all:false})
const at=i=>new Date(Date.UTC(2026,10,14,0,i)).toISOString()
const seed=()=>({
 listings:['P1','P3'].map((id,i)=>({id,title:i?'Другой проект':'Робот',description:'Synthetic',roles_needed:[],skills:[],timezone:'Asia/Tomsk',created_by:user,created_at:at(-100),deadline_at:null,completed_at:null,project_kind:'engineering'})),
 applications:[{id:'A1',listing_id:'P1',user_id:member,status:'accepted',created_at:at(-90)}],
 profiles:[{user_id:user}],profiles_collaboration:[{user_id:user,display_name:'Иван'},{user_id:member,display_name:'Анна'}],profiles_public:[],
 tasks:[],project_events:[],project_activity:[],notifications:[],project_files:[],project_documents:[],contributions:[],project_reviews:[],
 project_messages:[...Array.from({length:60},(_,i)=>message(`M${String(i+1).padStart(3,'0')}`,`Текст ${i+1}`,at(i))),message('Q1','Текст другого проекта',at(1),'P3')],project_message_hidden:[],
})
const rpc={is_site_editor:false,project_file_storage_version:1,refresh_my_recommendations:{refreshed:true,sent:0}}
const reply=(route,data,status=200)=>route.fulfill({status,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(data)})
const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,50))}throw new Error('fixture timeout')}
const focus=page=>page.evaluate(()=>window.dispatchEvent(new Event('focus')))

// Fake Phoenix/Realtime protocol for the installed SDK. Never calls connectToServer(). All other
// sockets remain blocked by ui-harness. This tests callback/lifecycle handling, NOT Realtime/RLS.
async function realtime(context) {
 const joins=[]
 const send=(ws,array,join,ref,topic,event,payload)=>ws.send(JSON.stringify(array?[join,ref,topic,event,payload]:{join_ref:join,ref,topic,event,payload}))
 await context.routeWebSocket(/^wss:\/\/pilot-test\.supabase\.co\/realtime\//,ws=>{
   ws.onMessage(raw=>{
     const parsed=JSON.parse(String(raw)),array=Array.isArray(parsed)
     const [join,ref,topic,event,payload]=array?parsed:[parsed.join_ref,parsed.ref,parsed.topic,parsed.event,parsed.payload]
     if(event==='phx_join') {
       const filters=(payload.config?.postgres_changes||[]).map((f,i)=>({...f,id:i+1}))
       const entry={ws,array,join,topic,filters,active:true};joins.push(entry)
       send(ws,array,join,ref,topic,'phx_reply',{status:'ok',response:{postgres_changes:filters}})
     } else if(event==='phx_leave') {
       for(const item of joins)if(item.topic===topic)item.active=false
       send(ws,array,join,ref,topic,'phx_reply',{status:'ok',response:{}})
     } else if(event==='heartbeat') send(ws,array,join,ref,topic,'phx_reply',{status:'ok',response:{}})
   })
 })
 const emit=(project,event,row)=>{
   for(const j of joins.filter(j=>j.active&&j.topic.includes(`project-chat:${project}:`))) {
     const ids=j.filters.filter(f=>f.event===event&&f.table==='project_messages'&&f.filter===`project_id=eq.${project}`).map(f=>f.id)
     if(ids.length)send(j.ws,j.array,j.join,null,j.topic,'postgres_changes',{ids,data:{schema:'public',table:'project_messages',type:event,record:row,old_record:{},columns:[],commit_timestamp:new Date().toISOString(),errors:null}})
   }
 }
 return {joins,emit}
}
async function fixture(browser,base,tables=seed(),withRealtime=false) {
 const backend=createBackend(tables,{userId:user,rpc,strictQueries:true})
 const context=await newContext(browser,backend,{signed:true,reducedMotion:'reduce'})
 const rt=withRealtime===true?await realtime(context):null
 // Hold the synthetic handshake while testing only the explicit history button; no real socket.
 if(withRealtime==='silent')await context.routeWebSocket(/^wss:\/\/pilot-test\.supabase\.co\/realtime\//,ws=>ws.onMessage(()=>{}))
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`${base}/projects/P1`)
 const open=async()=>{
   await page.getByRole('button',{name:'Чат команды'}).click()
   const panel=page.getByRole('region',{name:'Чат проекта'})
   return {panel,log:panel.getByRole('log'),input:panel.getByRole('textbox',{name:'Сообщение команде'})}
 }
 return {tables,backend,context,page,open,rt}
}
const count=async(page,n)=>page.waitForFunction(n=>document.querySelectorAll('.project-chat [data-message-id]').length===n,n)
const switchAccount=page=>page.evaluate(id=>{
 const key='sb-pilot-test-auth-token', value={access_token:`eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600}))}.test`,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id,email:'synthetic@example.ru'}}
 localStorage.setItem(key,JSON.stringify(value));const channel=new BroadcastChannel(key);channel.postMessage({event:'SIGNED_IN',session:value});channel.close()
},other)
async function nextProject(f,base) {
 await f.page.getByRole('navigation',{name:'Рабочие разделы'}).getByRole('link',{name:'Рабочий центр'}).click()
 await f.page.waitForURL(`${base}/dashboard`)
 await f.page.locator('a[href="/projects/P3"]').first().click()
 await f.page.waitForURL(`${base}/projects/P3`)
 const chat=await f.open();await chat.log.getByText('Текст другого проекта').waitFor();return chat
}
let browser,server
try {
 mkdirSync(out,{recursive:true});browser=await launchBrowser();server=await startApp(port,appEnv(port))
 await run('125 arrivals: all loaded, stable order, no duplicates and the reading position retained',async()=>{
   const f=await fixture(browser,server.base),c=await f.open()
   await count(f.page,50)
   const anchor=c.log.locator('[data-message-id="M035"]');await anchor.scrollIntoViewIfNeeded()
   const before=await anchor.evaluate(el=>el.getBoundingClientRect().top)
   for(let i=1;i<=125;i++)f.tables.project_messages.push(message(`N${String(i).padStart(3,'0')}`,`Новое ${i}`,at(100+i)))
   await focus(f.page);await count(f.page,175)
   const ids=await c.log.locator('[data-message-id]').evaluateAll(els=>els.map(el=>el.dataset.messageId))
   assert.equal(new Set(ids).size,175);assert.equal(ids[50],'N001');assert.equal(ids.at(-1),'N125')
   assert.ok(Math.abs(await anchor.evaluate(el=>el.getBoundingClientRect().top)-before)<=2)
   await c.panel.getByRole('button',{name:'Новые сообщения (125)'}).waitFor()
   await f.context.close()
 })
 await run('170 timestamp ties: every older page reachable, one stable copy per UUID',async()=>{
   const tables=seed();tables.project_messages=Array.from({length:170},(_,i)=>message(`T${String(i+1).padStart(3,'0')}`,`Одинаковая дата ${i+1}`,at(0)))
   const f=await fixture(browser,server.base,tables,'silent'),c=await f.open();await count(f.page,50)
   for(const n of [100,150,170]){await c.log.getByRole('button',{name:'Показать предыдущие сообщения'}).click();await count(f.page,n)}
   const ids=await c.log.locator('[data-message-id]').evaluateAll(els=>els.map(el=>el.dataset.messageId))
   assert.deepEqual(ids,tables.project_messages.map(r=>r.id));assert.equal(await c.log.getByRole('button',{name:'Показать предыдущие сообщения'}).count(),0)
   await f.context.close()
 })
 await run('loaded old edit/delete/hide reconcile; visible reading anchor survives content changes above',async()=>{
   const f=await fixture(browser,server.base,seed(),true),c=await f.open();await count(f.page,50)
   await c.log.getByRole('button',{name:'Показать предыдущие сообщения'}).click();await count(f.page,60)
   const anchor=c.log.locator('[data-message-id="M040"]');await anchor.scrollIntoViewIfNeeded()
   const before=await anchor.evaluate(el=>el.getBoundingClientRect().top)
   const old=f.tables.project_messages.find(m=>m.id==='M001');old.body='Изменённое старое сообщение '+ 'длиннее '.repeat(80);old.edited_at=at(200)
   Object.assign(f.tables.project_messages.find(m=>m.id==='M003'),{body:'',is_deleted_for_all:true,edited_at:at(201)})
   f.tables.project_message_hidden.push({id:'H1',message_id:'M002',user_id:user})
   await until(()=>f.rt.joins.some(j=>j.topic.includes('project-chat:P1:')));f.rt.emit('P1','UPDATE',old)
   await c.log.locator('[data-message-id="M001"]').getByText(/Изменённое старое сообщение/).waitFor({state:'attached'})
   await c.log.locator('[data-message-id="M003"]').getByText('Сообщение удалено').waitFor({state:'attached'})
   await c.log.locator('[data-message-id="M002"]').waitFor({state:'detached'})
   assert.ok(Math.abs(await anchor.evaluate(el=>el.getBoundingClientRect().top)-before)<=2)
   // "For me" hidden state is still read after a missed WS event / disconnect.
   f.tables.project_message_hidden.push({id:'H2',message_id:'M004',user_id:user});await focus(f.page)
   await c.log.locator('[data-message-id="M004"]').waitFor({state:'detached'})
   await f.context.close()
 })
 await run('early and repeated Realtime invalidations survive initial read; payload alone is never rendered',async()=>{
   const f=await fixture(browser,server.base,seed(),true)
   let held,release
   const gate=new Promise(r=>release=r)
   await f.page.route('https://pilot-test.supabase.co/rest/v1/project_messages*',async route=>{
     if(route.request().method()==='GET'&&!held){held=true;const snapshot=structuredClone(f.tables.project_messages.filter(r=>r.project_id==='P1').slice(-50).reverse());await gate;return reply(route,snapshot)}
     return route.fallback()
   })
   const c=await f.open();await until(()=>held&&f.rt.joins.some(j=>j.topic.includes('project-chat:P1:')))
   const row=message('EARLY','Раннее событие',at(200));f.tables.project_messages.push(row)
   f.rt.emit('P1','INSERT',row);f.rt.emit('P1','INSERT',row);release()
   await c.log.getByText('Раннее событие').waitFor();await count(f.page,51)
   f.rt.emit('P1','INSERT',message('NOT_READ','Только в WS, нет разрешённой строки',at(201)))
   await f.page.waitForTimeout(350)
   assert.equal(await c.log.getByText('Раннее событие').count(),1);assert.equal(await c.log.getByText('Только в WS, нет разрешённой строки').count(),0)
   await f.context.close()
 })
 await run('Realtime before INSERT response and repeated event keep one optimistic/confirmed bubble',async()=>{
   const f=await fixture(browser,server.base,seed(),true),c=await f.open();await count(f.page,50)
   let saved,release;const gate=new Promise(r=>release=r)
   await f.page.route('https://pilot-test.supabase.co/rest/v1/project_messages*',async route=>{
     if(route.request().method()!=='POST')return route.fallback()
     saved={...route.request().postDataJSON(),created_at:at(300),edited_at:null,is_deleted_for_all:false};f.tables.project_messages.push(saved);await gate;return reply(route,saved)
   })
   await c.input.fill('Ранняя доставка');await c.input.press('Enter');await until(()=>saved&&f.rt.joins.some(j=>j.topic.includes('project-chat:P1:')))
   f.rt.emit('P1','INSERT',saved);f.rt.emit('P1','INSERT',saved)
   await f.page.waitForFunction(id=>document.querySelector(`[data-message-id="${id}"]`)?.getAttribute('data-status')===null,saved.id)
   release();await f.page.waitForTimeout(250)
   assert.equal(await c.log.locator(`[data-message-id="${saved.id}"]`).count(),1)
   await f.context.close()
 })
 await run('23505 without accessible UUID is a failed send, including explicit repeat; no blind retry',async()=>{
   const f=await fixture(browser,server.base),c=await f.open();await count(f.page,50);let posted=0
   await f.page.route('https://pilot-test.supabase.co/rest/v1/project_messages*',route=>{
     if(route.request().method()==='POST'){posted++;return reply(route,{code:'23505',message:'synthetic conflict'},409)}
     if(new URL(route.request().url()).searchParams.has('id'))return reply(route,[])
     return route.fallback()
   })
   await c.input.fill('Без подтверждения');await c.input.press('Enter')
   const failed=c.log.locator('[data-status="failed"]');await failed.waitFor()
   assert.equal(posted,1);await failed.getByRole('button',{name:'Повторить отправку'}).click();await failed.waitFor()
   assert.equal(posted,2);assert.equal(await c.log.getByText('Без подтверждения',{exact:true}).count(),1)
   await f.context.close()
 })
 await run('account switch during send discards late response, draft and previous session content',async()=>{
   const f=await fixture(browser,server.base),c=await f.open();await count(f.page,50)
   let started,release;const gate=new Promise(r=>release=r)
   await f.page.route('https://pilot-test.supabase.co/rest/v1/project_messages*',async route=>{
     if(route.request().method()!=='POST')return route.fallback()
     started=true;const row={...route.request().postDataJSON(),created_at:at(300)};await gate;return reply(route,row)
   })
   await c.input.fill('От старой сессии');await c.input.press('Enter');await until(()=>started)
   await c.input.fill('Ещё не отправленный текст');await switchAccount(f.page)
   await c.panel.getByText(/Аккаунт изменился/).waitFor();release();await f.page.waitForTimeout(250)
   assert.equal(await c.log.locator('[data-message-id]').count(),0);assert.equal(await c.input.inputValue(),'');assert.ok(await c.input.isDisabled())
   await f.context.close()
 })
 await run('SPA project switch during send discards late P1 response in P3',async()=>{
   const f=await fixture(browser,server.base),c=await f.open();await count(f.page,50)
   let started,release;const gate=new Promise(r=>release=r)
   await f.page.route('https://pilot-test.supabase.co/rest/v1/project_messages*',async route=>{
     if(route.request().method()!=='POST')return route.fallback()
     started=true;const row={...route.request().postDataJSON(),created_at:at(300)};await gate;return reply(route,row)
   })
   await c.input.fill('Сообщение первого проекта');await c.input.press('Enter');await until(()=>started)
   const next=await nextProject(f,server.base);release();await f.page.waitForTimeout(250)
   assert.deepEqual(await next.log.locator('[data-message-id]').evaluateAll(els=>els.map(el=>el.dataset.messageId)),['Q1'])
   await f.context.close()
 })
 await run('access removal: authorised refresh clears cached content, a WS payload cannot restore it',async()=>{
   const f=await fixture(browser,server.base,seed(),true),c=await f.open();await count(f.page,50)
   await f.page.route('https://pilot-test.supabase.co/rest/v1/project_messages*',route=>reply(route,[]))
   await until(()=>f.rt.joins.some(j=>j.topic.includes('project-chat:P1:')))
   f.rt.emit('P1','UPDATE',message('LEAK','Недоступное содержимое',at(200)))
   await count(f.page,0);assert.equal(await c.log.getByText('Недоступное содержимое').count(),0)
   await f.context.close()
 })
 await check('no browser runtime errors',async()=>assert.deepEqual(errors,[]))
 writeFileSync(`${out}/results.json`,JSON.stringify({results,errors,level:'mock HTTP and WS, not live Realtime'},null,2))
 console.log(`${results.length} PASS (mock transport)`)
} catch(error){console.error('FAIL',error.message);writeFileSync(`${out}/errors.json`,JSON.stringify({passed:results,errors,failure:error.message,stack:error.stack},null,2));process.exitCode=1}
finally {await browser?.close();server?.stop()}
