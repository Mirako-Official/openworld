import {randomBytes,createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const cookie=(req,key)=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1)||'';
export const watchaReady=config=>!!(config.watchaClientId&&config.watchaClientSecret);
const returnPath=req=>/^[A-F0-9]{12}$/.test(String(req.query.cli||''))?'/cli-authorize?code='+req.query.cli:req.query.returnTo==='admin'?'/admin':'/game';

export function installWatchaAuth(app,store,config,session){
  const options={httpOnly:true,sameSite:'lax',secure:config.url.startsWith('https:'),path:'/'};
  app.get('/auth/login',(req,res)=>{
    const params=new URLSearchParams();if(req.query.returnTo==='admin')params.set('returnTo','admin');if(/^[A-F0-9]{12}$/.test(String(req.query.cli||'')))params.set('cli',req.query.cli);
    const suffix=params.size?'?'+params:'';
    const providers=[];
    if(watchaReady(config))providers.push(['watcha','使用观猹登录']);
    if(config.clientId&&config.clientSecret)providers.push(['github','使用 GitHub 登录']);
    if(!providers.length)return res.redirect('/game?auth=not-configured');
    res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · OpenWorldCraft</title><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:radial-gradient(at 10% 0%,#334b58,#101a25 70%);color:#f1eadc;font:15px/1.8 system-ui}main{box-sizing:border-box;width:min(420px,calc(100% - 32px));padding:36px;border:1px solid #ffffff24;border-radius:24px;background:#ffffff08;box-shadow:0 24px 80px #0004}small{letter-spacing:3px;color:#c1ad86}h1{font-size:28px;margin:16px 0}p{color:#b8c6cf}a{display:block;margin-top:14px;padding:13px;border-radius:12px;text-align:center;text-decoration:none;color:#172632;background:#ecd6a8}a:hover{filter:brightness(1.08)}.back{background:transparent;color:#bbc9d2;font-size:13px}</style><main><small>OPENWORLDCRAFT</small><h1>欢迎回到你的世界</h1><p>选择登录方式，开始探索与建造。</p>${providers.map(([id,label])=>`<a href="/auth/${id}${suffix.replaceAll('&','&amp;')}">${label}</a>`).join('')}<p>已有领地请使用原来的登录方式，不同平台账号暂不互通。</p><a class="back" href="/game">返回世界 →</a></main></html>`);
  });
  app.get('/auth/watcha',async(req,res)=>{
    if(!watchaReady(config))return res.redirect('/game?auth=not-configured');
    if((config.allowedOrigins||[]).some(origin=>new URL(origin).host===req.headers.host)&&req.headers.host!==new URL(config.url).host){
      const params=new URLSearchParams();if(req.query.returnTo==='admin')params.set('returnTo','admin');if(/^[A-F0-9]{12}$/.test(String(req.query.cli||'')))params.set('cli',req.query.cli);
      return res.redirect(config.url+'/auth/watcha'+(params.size?'?'+params:''));
    }
    await store.rate('watcha-oauth:'+req.socket.remoteAddress,20);
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    await store.db.prepare('DELETE FROM oauth WHERE expires<?').run(Date.now());
    await store.db.prepare('INSERT INTO oauth VALUES (?,?,?)').run(hash('watcha:'+state),JSON.stringify({verifier,returnTo:returnPath(req)}),Date.now()+600000);
    res.cookie('town_watcha_oauth',state,{...options,maxAge:600000});
    res.redirect('https://watcha.cn/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:config.watchaClientId,redirect_uri:config.url+'/auth/watcha/callback',scope:'read',state,code_challenge:hashChallenge(verifier),code_challenge_method:'S256'}));
  });
  app.get('/auth/watcha/callback',async(req,res)=>{
    if(!watchaReady(config))return res.redirect('/game?auth=not-configured');
    const state=req.query.state;
    if(typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state)||state!==cookie(req,'town_watcha_oauth'))return res.redirect('/game?auth=state');
    const row=await store.db.prepare('DELETE FROM oauth WHERE state=? RETURNING *').get(hash('watcha:'+state));
    res.clearCookie('town_watcha_oauth',options);
    if(!row||row.expires<Date.now()||req.query.error||typeof req.query.code!=='string'||!req.query.code||req.query.code.length>4096)return res.redirect('/game?auth=expired');
    try{
      const {verifier,returnTo}=JSON.parse(row.verifier);
      const response=await fetch('https://watcha.cn/oauth/api/token',{method:'POST',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:req.query.code,redirect_uri:config.url+'/auth/watcha/callback',client_id:config.watchaClientId,client_secret:config.watchaClientSecret,code_verifier:verifier}),signal:AbortSignal.timeout(15000)});
      const token=await response.json();if(!response.ok||token.error||typeof token.access_token!=='string'||!token.access_token)throw Error('token');
      const profile=await fetch('https://watcha.cn/oauth/api/userinfo',{redirect:'error',headers:{Accept:'application/json',Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
      const payload=await profile.json(),user=payload.data;
      if(!profile.ok||payload.statusCode!==200||!Number.isSafeInteger(user?.user_id)||user.user_id<=0||typeof user.nickname!=='string'||!user.nickname.trim()||user.nickname.length>200)throw Error('profile');
      await session(req,res,await store.upsertUser('watcha:'+user.user_id,user.nickname.trim()));
      res.redirect(returnTo);
    }catch{res.redirect('/game?auth=failed');}
  });
}
function hashChallenge(value){return createHash('sha256').update(value).digest('base64url');}
