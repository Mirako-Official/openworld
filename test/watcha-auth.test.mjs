import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.mjs';

test('Watcha PKCE login isolates identities, rejects invalid callbacks and authorizes CLI',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'watcha-auth-'));
  const config={dataDir:dir,url:'http://127.0.0.1:8787',adminIds:['12345'],watchaClientId:'test+client/id=',watchaClientSecret:'test-secret'};
  const {app,store}=await createApp(config),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  config.url='http://127.0.0.1:'+server.address().port;
  const realFetch=globalThis.fetch;let exchanges=0,profileError=false,lastBody;
  globalThis.fetch=async(url,options)=>{
    if(url==='https://watcha.cn/oauth/api/token'){
      exchanges++;lastBody=options.body;
      assert.equal(options.redirect,'error');assert.equal(lastBody.get('client_id'),config.watchaClientId);assert.equal(lastBody.get('client_secret'),config.watchaClientSecret);
      assert.equal(lastBody.get('grant_type'),'authorization_code');assert.equal(lastBody.get('redirect_uri'),config.url+'/auth/watcha/callback');
      return Response.json({access_token:'test-access',token_type:'Bearer'});
    }
    if(url==='https://watcha.cn/oauth/api/userinfo'){
      assert.equal(options.headers.Authorization,'Bearer test-access');
      return Response.json(profileError?{statusCode:400,data:{user_id:12345,nickname:'not-valid'}}:{statusCode:200,data:{user_id:12345,nickname:'Watcher'}});
    }
    return realFetch(url,options);
  };
  const get=(path,cookie='')=>realFetch(config.url+path,{headers:{Cookie:cookie},redirect:'manual'});
  const post=(path,body,headers={})=>realFetch(config.url+path,{method:'POST',headers:{Origin:config.url,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const begin=async(query='')=>{const response=await get('/auth/watcha'+query),target=new URL(response.headers.get('location'));return {target,state:target.searchParams.get('state'),cookie:response.headers.getSetCookie().find(s=>s.startsWith('town_watcha_oauth=')).split(';')[0]};};
  const callback=a=>'/auth/watcha/callback?code=test-code&state='+a.state;
  try{
    await store.upsertUser('12345','github-owner');await store.db.prepare('UPDATE users SET points=7777 WHERE id=?').run('12345');
    const availability=await(await get('/api/session')).json();assert.equal(availability.loginReady,true);assert.equal(availability.watchaReady,true);assert.equal(availability.githubReady,false);
    const chooser=await(await get('/auth/login?cli=ABCDEF123456')).text();assert.match(chooser,/使用观猹登录/);assert.doesNotMatch(chooser,/使用 GitHub 登录/);assert.match(chooser,/\/auth\/watcha\?cli=ABCDEF123456/);
    const request=await(await post('/api/cli/authorize/start',{})).json(),a=await begin('?cli='+request.code);
    assert.equal(a.target.origin,'https://watcha.cn');assert.equal(a.target.searchParams.get('client_id'),config.watchaClientId);assert.equal(a.target.searchParams.get('scope'),'read');assert.equal(a.target.searchParams.get('code_challenge_method'),'S256');
    assert.equal((await get(callback(a))).headers.get('location'),'/game?auth=state');assert.equal(exchanges,0);
    const cross=await get('/auth/github/callback?code=test&state='+a.state,'town_oauth='+a.state);assert.equal(cross.headers.get('location'),'/game?auth=expired');assert.equal(exchanges,0);
    const signed=await get(callback(a),a.cookie);assert.equal(signed.headers.get('location'),'/cli-authorize?code='+request.code);
    assert.equal(createHash('sha256').update(lastBody.get('code_verifier')).digest('base64url'),a.target.searchParams.get('code_challenge'));
    const sessionCookie=signed.headers.getSetCookie().find(s=>s.startsWith('town_session=')).split(';')[0];
    const session=await(await get('/api/session',sessionCookie)).json();assert.equal(session.user.id,'watcha:12345');assert.equal(session.user.admin,false);assert.equal(session.user.login,'Watcher');
    assert.equal((await store.getUser('12345')).points,7777);assert.equal((await store.getUser('watcha:12345')).points,4500);
    assert.equal((await get(callback(a),a.cookie)).headers.get('location'),'/game?auth=expired');assert.equal(exchanges,1);
    const confirmed=await post('/api/cli/authorize/confirm',{code:request.code,approve:true},{Cookie:sessionCookie,'X-CSRF-Token':session.csrf});assert.equal(confirmed.status,200);
    const polled=await(await post('/api/cli/authorize/poll',{secret:request.secret})).json();assert.equal(polled.user.id,'watcha:12345');assert.equal(polled.status,'approved');
    const denied=await begin();assert.equal((await get(callback(denied)+'&error=access_denied',denied.cookie)).headers.get('location'),'/game?auth=expired');assert.equal(exchanges,1);
    const expired=await begin();await store.db.prepare('UPDATE oauth SET expires=0').run();assert.equal((await get(callback(expired),expired.cookie)).headers.get('location'),'/game?auth=expired');assert.equal(exchanges,1);
    profileError=true;const invalid=await begin();const rejected=await get(callback(invalid),invalid.cookie);assert.equal(rejected.headers.get('location'),'/game?auth=failed');assert.ok(!rejected.headers.getSetCookie().some(s=>s.startsWith('town_session=')));
    config.watchaClientSecret='';assert.equal((await get('/auth/watcha')).headers.get('location'),'/game?auth=not-configured');
  }finally{globalThis.fetch=realFetch;server.closeAllConnections();await new Promise(r=>server.close(r));await store.close();rmSync(dir,{recursive:true,force:true});}
});
