// Pure session storage tests. No browser, env, network or credentials.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readPendingCreate, readPendingClose, storePending, clearPending } from '../../src/lib/planningPending'
import type { CreateSprintRequest, CloseSprintRequest } from '../../src/lib/planning'

test('pending creation keeps exact UUID/payload across reopening, isolated by user and project', () => {
  const map = new Map<string,string>()
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)}})
  const request: CreateSprintRequest = {requestId:'request-1',projectId:'project-1',expectedVersion:7,draft:{name:'Same name',goal:'Goal',start_at:'2026-12-01T10:05:13Z',end_at:null}}
  storePending('user-1','project-1',request)
  assert.deepEqual(readPendingCreate('user-1','project-1'),request)
  assert.equal(readPendingCreate('user-2','project-1'),null)
  assert.equal(readPendingCreate('user-1','project-2'),null)
  clearPending('user-1','project-1',{...request,requestId:'different'})
  assert.deepEqual(readPendingCreate('user-1','project-1'),request)
  const close: CloseSprintRequest = {requestId:'request-2',sprintId:'sprint-1',expectedVersion:3,close:{cancel:true,reason:'Reason',decisions:[{task_id:'t',destination:'backlog'}]}}
  storePending('user-1','project-1',close)
  assert.deepEqual(readPendingClose('user-1','project-1','sprint-1'),close)
  assert.equal(readPendingClose('user-2','project-1','sprint-1'),null)
  assert.equal(readPendingClose('user-1','project-1','sprint-2'),null)
  clearPending('user-1','project-1',request)
  assert.equal(readPendingCreate('user-1','project-1'),null)
  assert.deepEqual(readPendingClose('user-1','project-1','sprint-1'),close)
  map.set('planning-request:user-1:project-1:create','{broken')
  assert.equal(readPendingCreate('user-1','project-1'),null)
})
