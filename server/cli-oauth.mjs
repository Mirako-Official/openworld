import {randomBytes,createHash} from 'node:crypto';
import {requireUser} from './auth.mjs';
import {fail} from './store.mjs';
import {watchaReady} from './watcha-auth.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function installCliOAuth(app,store,config,session){
  const {db}=store;(await db.exec('CREATE TABLE IF NOT EXISTS cli_authorizations(secret TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL,user TEXT,status TEXT NOT NULL)'));
  app.post('/api/cli/authorize/start',async (req,res)=>{
    (await store.rate('cli-auth-start:'+req.socket.remoteAddress,10,60000));if(!(config.clientId&&config.clientSecret)&&!watchaReady(config))fail(503,'站点尚未配置登录服务');
    (await db.prepare('DELETE FROM cli_authorizations WHERE expires<?').run(Date.now()));const secret=randomBytes(32).toString('base64url'),code=randomBytes(6).toString('hex').toUpperCase();
    (await db.prepare('INSERT INTO cli_authorizations VALUES (?,?,?,NULL,?)').run(hash(secret),code,Date.now()+600000,'pending'));res.json({secret,code,url:config.url+'/cli-authorize?code='+code,expiresIn:600,interval:2});
  });
  app.post('/api/cli/authorize/poll',async (req,res)=>{
    const secret=req.body?.secret;if(typeof secret!=='string'||secret.length!==43)fail(400,'授权请求无效');(await store.rate('cli-auth-poll:'+hash(secret),45,60000));
    const result=await store.transaction(async ()=>{const row=await db.prepare('SELECT * FROM cli_authorizations WHERE secret=?').get(hash(secret));if(!row||row.expires<=Date.now())fail(410,'授权已过期，请重新登录');if(row.status==='pending')return {status:'pending'};await db.prepare('DELETE FROM cli_authorizations WHERE secret=?').run(hash(secret));if(row.status==='denied')return {status:'denied'};return {...await session(req,res,await store.getUser(row.user)),status:'approved'};});res.json(result);
  });
  app.get('/api/cli/authorize/request',requireUser,async (req,res)=>{const row=(await db.prepare('SELECT code,expires FROM cli_authorizations WHERE code=? AND status=? AND expires>?').get(String(req.query.code||''),'pending',Date.now()));if(!row)fail(410,'授权请求已过期或已处理');res.json(row);});
  app.post('/api/cli/authorize/confirm',requireUser,async (req,res)=>{if(typeof req.body?.approve!=='boolean')fail(400,'请选择授权或拒绝');const result=(await db.prepare('UPDATE cli_authorizations SET user=?,status=? WHERE code=? AND status=? AND expires>?').run(req.user.id,req.body.approve?'approved':'denied',String(req.body.code||''),'pending',Date.now()));if(!result.changes)fail(410,'授权请求已过期或已处理');res.json({ok:true});});
}
