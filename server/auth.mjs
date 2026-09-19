import {randomBytes,createHash} from 'node:crypto';
import {fail} from './store.mjs';
import {installCliOAuth} from './cli-oauth.mjs';
import {installWatchaAuth,watchaReady} from './watcha-auth.mjs';
const random=()=>randomBytes(32).toString('base64url');
const hash=s=>createHash('sha256').update(s).digest('hex');
function cookie(req,key){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1)||'';}
export async function installAuth(app,store,config){
  const {db}=store,secure=config.url.startsWith('https:'),cookieOptions={httpOnly:true,sameSite:'lax',secure,path:'/'};
  (await db.prepare("DELETE FROM sessions WHERE user IN ('demo-owner','demo-visitor')").run());
  const isAdmin=id=>config.adminIds.includes(id);
  async function session(req,res,user){const token=random(),csrf=random();(await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token),user.id,csrf,Date.now()+7*86400000));res.cookie('town_session',token,{...cookieOptions,maxAge:7*86400000});return {user:{...user,admin:isAdmin(user.id)},csrf};}
  app.use(async (req,res,next)=>{
    const token=cookie(req,'town_session');const row=token&&(await db.prepare('SELECT s.csrf,u.* FROM sessions s JOIN users u ON s.user=u.id WHERE s.hash=? AND s.expires>?').get(hash(token),Date.now()));
    if(row){req.user={id:row.id,login:row.login,admin:isAdmin(row.id)};req.csrf=row.csrf;}
    next();
  });
  app.get('/api/session',(req,res)=>res.json({user:req.user||null,csrf:req.csrf||null,githubReady:!!(config.clientId&&config.clientSecret),watchaReady:watchaReady(config),loginReady:!!(config.clientId&&config.clientSecret)||watchaReady(config)}));
  installWatchaAuth(app,store,config,session);
  (await installCliOAuth(app,store,config,session));
  app.post('/api/cli/login',async(req,res)=>{
    (await store.rate('cli-login:'+req.socket.remoteAddress,10,60000));
    const token=req.body?.githubToken;if(typeof token!=='string'||token.length<10||token.length>512)fail(400,'请提供有效的 GitHub Token');
    const response=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','User-Agent':'openworld-cli'},signal:AbortSignal.timeout(15000)}),user=await response.json();
    if(!response.ok||!Number.isSafeInteger(user.id)||user.id<=0||typeof user.login!=='string')fail(401,'GitHub Token 验证失败');
    res.json((await session(req,res,(await store.upsertUser(String(user.id),user.login)))));
  });
  app.post('/api/logout',requireUser,async (req,res)=>{(await db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(cookie(req,'town_session'))));res.clearCookie('town_session',cookieOptions);res.json({ok:true});});
  app.get('/auth/github',async (req,res)=>{
    if((config.allowedOrigins||[]).some(origin=>new URL(origin).host===req.headers.host)&&req.headers.host!==new URL(config.url).host){const query=new URLSearchParams();if(req.query.returnTo==='admin')query.set('returnTo','admin');if(/^[A-F0-9]{12}$/.test(String(req.query.cli||'')))query.set('cli',req.query.cli);return res.redirect(config.url+'/auth/github'+(query.size?'?'+query:''));}
    if(!config.clientId||!config.clientSecret)return res.redirect('/game?auth=not-configured');
    (await store.rate('oauth:'+req.socket.remoteAddress,20));
    const state=random(),verifier=random();(await db.prepare('DELETE FROM oauth WHERE expires<?').run(Date.now()));(await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()));(await db.prepare('INSERT INTO oauth VALUES (?,?,?)').run(hash(state),verifier,Date.now()+600000));
    res.cookie('town_oauth',state,{...cookieOptions,maxAge:600000});
    if(/^[A-F0-9]{12}$/.test(String(req.query.cli||'')))res.cookie('town_cli',req.query.cli,{...cookieOptions,maxAge:600000});else res.clearCookie('town_cli',cookieOptions);
    if(req.query.returnTo==='admin')res.cookie('town_return','admin',{...cookieOptions,maxAge:600000});else res.clearCookie('town_return',cookieOptions);
    const params=new URLSearchParams({client_id:config.clientId,redirect_uri:config.url+'/auth/github/callback',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    res.redirect('https://github.com/login/oauth/authorize?'+params);
  });
  app.get('/auth/github/callback',async(req,res)=>{
    const state=typeof req.query.state==='string'?req.query.state:'';
    if(!state||state!==cookie(req,'town_oauth'))return res.redirect('/game?auth=state');
    const row=(await db.prepare('DELETE FROM oauth WHERE state=? RETURNING *').get(hash(state)));res.clearCookie('town_oauth',cookieOptions);
    if(!row||row.expires<Date.now()||typeof req.query.code!=='string')return res.redirect('/game?auth=expired');
    try{
      const response=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code:req.query.code,redirect_uri:config.url+'/auth/github/callback',code_verifier:row.verifier}),signal:AbortSignal.timeout(15000)});
      const token=await response.json();if(!response.ok||!token.access_token)throw new Error('token');
      const profile=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+token.access_token,Accept:'application/vnd.github+json','User-Agent':'sakurami-online','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
      const user=await profile.json();if(!profile.ok||!Number.isSafeInteger(user.id)||user.id<=0||typeof user.login!=='string')throw new Error('profile');
      (await session(req,res,(await store.upsertUser(String(user.id),user.login))));const cli=cookie(req,'town_cli'),admin=cookie(req,'town_return')==='admin';res.clearCookie('town_cli',cookieOptions);res.clearCookie('town_return',cookieOptions);res.redirect(/^[A-F0-9]{12}$/.test(cli)?'/cli-authorize?code='+cli:admin?'/admin':'/game');
    }catch{res.redirect('/game?auth=failed');}
  });
}
export function requireUser(req,res,next){if(!req.user)fail(401,'请先登录');if(!['GET','HEAD'].includes(req.method)&&(!req.csrf||req.headers['x-csrf-token']!==req.csrf))fail(403,'会话校验失败，请刷新页面');next();}
export function requireAdmin(req,res,next){requireUser(req,res,()=>{if(!req.user.admin)fail(403,'仅管理员可审核');next();});}
