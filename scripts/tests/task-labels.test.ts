import test from 'node:test'
import assert from 'node:assert/strict'
import { activityBody, boardStatusLabel } from '../../src/lib/taskLabels'

test('status history is formatted from metadata; unknown codes remain safe text',()=>{
  assert.equal(activityBody({type:'task_status_changed',body:'Статус: todo → doing.',metadata:{old_status:'todo',new_status:'doing'}}),'Статус: Нужно сделать → В работе.')
  assert.equal(boardStatusLabel('review'),'review')
  assert.equal(boardStatusLabel('__proto__'),'__proto__')
  assert.equal(activityBody({type:'task_completed',body:'legacy',metadata:{old_status:'review',new_status:'done'}}),'Статус: review → Готово.')
})
test('legacy text, user content and malformed metadata are never rewritten',()=>{
  for(const metadata of [null,[],{},'oops',{old_status:{},new_status:'done'}])
    assert.equal(activityBody({type:'task_status_changed',body:'Пользователь написал: todo',metadata}),'Пользователь написал: todo')
})
test('schedule history formats exact instants in viewer zone and distinguishes empty/unknown',()=>{
  const text=activityBody({type:'task_schedule_changed',body:null,metadata:{old_start_at:null,new_start_at:'2026-11-12T02:30:12Z',old_due_at:'broken',new_due_at:null}},'Asia/Tomsk')!
  assert.match(text,/не задано → 12\.11\.2026, 09:30:12/)
  assert.match(text,/Дедлайн: неизвестно → не задано/)
})
