// Only the live site and this explicitly reviewed preview may receive scoped capabilities.
export const GAMEVERSE_PREVIEW_ORIGIN='https://pr27-gameverse-host-staging.gameverse-environment.workers.dev';
export function trustedGameverseOrigin(url,{allowLoopback=false}={}){
  if(url.username||url.password)return false;
  return url.origin==='https://gameverse.build'||url.origin===GAMEVERSE_PREVIEW_ORIGIN||allowLoopback&&url.protocol==='http:'&&url.hostname==='127.0.0.1';
}
