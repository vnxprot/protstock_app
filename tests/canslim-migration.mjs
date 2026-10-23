import {PGlite} from '../.v4-sql-check/node_modules/@electric-sql/pglite/dist/index.js'
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const db=new PGlite()
try{
 await db.exec(`create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table symbols(id bigint primary key);insert into symbols values(1);insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`)
 await db.exec(await readFile('supabase/migrations/20261023010000_canslim_workbench.sql','utf8'))
 await db.exec(`set role authenticated;set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';insert into canslim_preferences(user_id,settings) values(auth.uid(),'{"rules":[]}');`)
 await assert.rejects(()=>db.exec(`insert into canslim_vci_data(symbol_id) values(1)`),/permission denied/)
 await db.exec(`set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';`)
 assert.equal((await db.query('select * from canslim_preferences')).rows.length,0)
 await assert.rejects(()=>db.exec(`insert into canslim_preferences(user_id,settings) values('11111111-1111-4111-8111-111111111111','{}')`),/row-level security/)
 console.log('PASS: account isolation, service-only VCI writes, migration')
}finally{await db.close()}
