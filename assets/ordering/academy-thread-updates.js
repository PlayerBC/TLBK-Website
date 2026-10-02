// Poll only an open, visible conversation. Schedule after completion so a slow
// connection cannot stack requests; focus/online resumes immediately.
export function watchThreadUpdates({check,onError=()=>{},onState=()=>{},interval=3000}){
 let timer=null,stopped=false,running=false,failures=0;
 const available=()=>document.visibilityState!=='hidden'&&navigator.onLine!==false;
 const schedule=delay=>{clearTimeout(timer);if(!stopped&&available())timer=setTimeout(tick,delay);};
 async function tick(){
  if(stopped||running||!available())return;
  running=true;
  try{await check();failures=0;if(!stopped)onState('Updates automatically');}
  catch(error){if(!stopped){failures++;onState('Reconnecting… Your draft is safe.');onError(error);}}
  finally{running=false;schedule(Math.min(30000,interval*2**failures));}
 }
 const resume=()=>{clearTimeout(timer);if(!available()){if(!stopped&&navigator.onLine===false)onState('Offline · Your draft is safe.');return;}tick();};
 window.addEventListener('focus',resume);window.addEventListener('online',resume);window.addEventListener('offline',resume);document.addEventListener('visibilitychange',resume);
 schedule(interval);
 return ()=>{stopped=true;clearTimeout(timer);window.removeEventListener('focus',resume);window.removeEventListener('online',resume);window.removeEventListener('offline',resume);document.removeEventListener('visibilitychange',resume);};
}
