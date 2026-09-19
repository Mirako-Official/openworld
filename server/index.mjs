import {createApp} from './app.mjs';
import {storageConfig,r2AssetStorage} from './asset-storage.mjs';
import {migrateAssetsOnStart} from './asset-migration.mjs';
import {createServer} from 'node:http';
import {installMultiplayer} from './multiplayer.mjs';
const production=process.env.NODE_ENV==='production',port=Number(process.env.PORT||8787);
const config={production,databaseUrl:process.env.DATABASE_URL,url:process.env.PUBLIC_URL||`http://127.0.0.1:${port}`,dataDir:process.env.DATA_DIR||'./data',clientId:process.env.GITHUB_CLIENT_ID||'',clientSecret:process.env.GITHUB_CLIENT_SECRET||'',adminIds:(process.env.ADMIN_GITHUB_IDS||'').split(',').map(s=>s.trim()).filter(Boolean)};
config.unlimitedPlotAreaUserIds=(process.env.UNLIMITED_PLOT_AREA_USER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
config.plotGrants=(process.env.PLOT_GRANTS||'').split(',').map(value=>value.trim()).filter(Boolean).map(value=>{const split=value.lastIndexOf(':');const name=value.slice(0,split).trim(),limit=Number(value.slice(split+1));if(split<1||!name||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('PLOT_GRANTS must use territory-name:limit entries');return {name,limit};});
const host=process.env.HOST||'127.0.0.1';
config.host=host;config.r2=storageConfig();
config.watchaClientId=process.env.WATCHA_CLIENT_ID||'';
config.watchaClientSecret=process.env.WATCHA_CLIENT_SECRET||'';
config.devAvatarFile=process.env.DEV_AVATAR_FILE||'';
config.devAvatarHide=(process.env.DEV_AVATAR_HIDE||'').split(',').map(s=>s.trim()).filter(Boolean);
config.allowedOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
if(process.env.R2_MIGRATE_ON_START==='1'){
  if(!config.r2)throw new Error('R2 migration requires ASSET_STORAGE=r2');
  console.log('R2 migration:',await migrateAssetsOnStart(config.dataDir,r2AssetStorage(config.r2)));
}
const {app,store}=await createApp(config),server=createServer(app),multiplayer=installMultiplayer(server,store,config);
server.listen(port,host,()=>console.log(`openworld: ${config.url}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await multiplayer.close();server.close(async()=>{await store.close();process.exit(0);});});
