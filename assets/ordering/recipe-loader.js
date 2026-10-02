// Keep startup outside the module graph so missing or stale dependencies produce
// a visible recovery action instead of leaving the initial loading text forever.
const root=document.querySelector('#recipe-main');
let timeout;
function unavailable(){
 root.removeAttribute('aria-busy');
 const panel=document.createElement('section');panel.className='recipe-empty';panel.setAttribute('role','alert');
 const title=document.createElement('h1');title.textContent='Your recipe library could not open';
 const message=document.createElement('p');message.textContent='Check your connection, then reload. If you just updated the website, use Ctrl + Shift + R on Windows or Command + Shift + R on Mac.';
 const actions=document.createElement('div');actions.className='recipe-actions';
 const retry=document.createElement('button');retry.type='button';retry.className='primary';retry.textContent='Reload recipe library';retry.addEventListener('click',()=>location.reload());
 const account=document.createElement('a');account.href='account.html?next=recipes.html';account.className='recipe-button';account.textContent='Open account';
 actions.append(retry,account);panel.append(title,message,actions);root.replaceChildren(panel);
}
try {
 await Promise.race([
  import('./recipes.js?v=audit-search-safety-20261003-1').then(module=>module.startRecipeLibrary()),
  new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Recipe startup timed out.')),20000);}),
 ]);
}catch{unavailable();}
finally{clearTimeout(timeout);}
