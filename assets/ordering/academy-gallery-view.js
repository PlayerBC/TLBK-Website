export async function mountAcademyGallery(ui,{state={},onState,postId}){
 const {api,root,shell,heading,options,button,galleryCards,bindGallery,hydrate,dialog,photo,esc,notice,errorMessage,closeGalleryPost}=ui;
 let classId=state.classId||'',category=state.category||'',page=Math.min(10,Math.max(0,state.page||0)),posts=[],revision=0,popup=null,popupId='',postRevision=0,disposed=false;
 const filters=()=>({class_id:classId,category});
 const first=await api('gallery',{...filters(),offset:0});posts=first.posts;
 if(page){const pages=await Promise.all(Array.from({length:page},(_,i)=>api('gallery',{...filters(),offset:(i+1)*24})));posts=[...posts,...pages.flatMap(p=>p.posts)];}
 posts=[...new Map(posts.map(p=>[p.id,p])).values()];
 shell(`${heading('What our students are baking','A little inspiration, from every class.')}<div class="ap-filters"><label>Class<select id="ap-gallery-class" aria-label="Filter by class">${options([['','All classes'],...first.classes.map(c=>[c.id,c.name])],classId)}</select></label><label>Product<select id="ap-gallery-category" aria-label="Filter by category">${options(['All products','Cookies','Brownies','Cupcakes','Cakes','Bread','Pastries','Other'].map((c,i)=>[i?c:'',c]),category)}</select></label></div><div class="ap-filter-chips" aria-label="Active gallery filters"></div><p class="ap-small" id="ap-gallery-status" role="status"></p><div id="ap-gallery-feed">${galleryCards(posts)}</div><div class="ap-actions">${button('Load more','more',true)}</div>`,'gallery');
 const feed=root.querySelector('#ap-gallery-feed'),more=root.querySelector('[data-action=more]'),status=root.querySelector('#ap-gallery-status');
 const save=()=>onState({classId,category,page,scrollY:window.scrollY,at:Date.now()});
 function chips(){
  const node=root.querySelector('.ap-filter-chips');node.innerHTML=`${classId?`<button class="ap-filter-chip" data-clear-filter="class">${esc(first.classes.find(c=>c.id===classId)?.name||'Selected class')} <span aria-hidden="true">×</span><span class="ap-sr-only">Remove class filter</span></button>`:''}${category?`<button class="ap-filter-chip" data-clear-filter="category">${esc(category)} <span aria-hidden="true">×</span><span class="ap-sr-only">Remove product filter</span></button>`:''}${classId||category?'<button class="ap-button secondary small" data-clear-filter="all">Clear all</button>':''}`;
  node.querySelectorAll('button').forEach(b=>b.onclick=()=>{const field=b.dataset.clearFilter;if(field==='all'||field==='class')classId='';if(field==='all'||field==='category')category='';root.querySelector('#ap-gallery-class').value=classId;root.querySelector('#ap-gallery-category').value=category;load(false);});
 }
 function bind(){bindGallery();more.hidden=posts.length<(page+1)*24;hydrate(feed);chips();}
 async function load(append){
  const ticket=++revision,nextPage=append?page+1:0;
  try{more.disabled=true;feed.setAttribute('aria-busy','true');status.textContent='Loading creations…';
   const result=await api('gallery',{...filters(),offset:nextPage*24});if(disposed||ticket!==revision)return;
   page=nextPage;posts=append?[...new Map([...posts,...result.posts].map(p=>[p.id,p])).values()]:result.posts;
   feed.innerHTML=galleryCards(posts);bind();more.hidden=result.posts.length<24;status.textContent=`${posts.length} creations shown`;save();
  }catch(e){if(!disposed&&ticket===revision){status.textContent='The gallery could not load. Please try again.';notice(errorMessage(e),true);}}
  finally{if(!disposed&&ticket===revision){more.disabled=false;feed.setAttribute('aria-busy','false');}}
 }
 root.querySelector('#ap-gallery-class').onchange=event=>{classId=event.target.value;load(false);};
 root.querySelector('#ap-gallery-category').onchange=event=>{category=event.target.value;load(false);};more.onclick=()=>load(true);
 bind();window.addEventListener('scroll',save,{passive:true});
 if(state.scrollY)requestAnimationFrame(()=>{if(!disposed)window.scrollTo(0,state.scrollY);});
 const closing=new WeakSet();
 async function navigate(id){
  const ticket=++postRevision;if(popupId===id&&popup?.open)return;
  if(popup){closing.add(popup);popup.close();popup=null;}popupId=id||'';
  if(!id){status.textContent='';const target=root.querySelector(`[data-post="${CSS.escape(state.lastPost||'')}"]`);target?.focus({preventScroll:true});return;}
  status.textContent='Opening creation…';
  const post=await api('gallery_post',{id});if(disposed||ticket!==postRevision)return;
  status.textContent='';state.lastPost=id;save();let imageIndex=0;
  popup=dialog(post.title,`<button type="button" class="ap-button secondary" data-gallery-back>← Back to gallery</button><p class="ap-muted">${esc(post.class_name)} · Shared by ${esc(post.display_name)}</p>${post.recipe_title||post.module_name?`<p class="ap-small">${[post.module_name,post.recipe_title].filter(Boolean).map(esc).join(' · ')}</p>`:''}<div class="ap-gallery-slides">${post.media.map((m,i)=>`<figure ${i?'hidden':''} data-gallery-slide="${i}">${photo(m.id,`${post.title} — photo ${i+1}`)}</figure>`).join('')}</div><div class="ap-gallery-photo-nav"><button class="ap-button secondary small" data-gallery-prev aria-label="Previous photo" disabled>← Previous</button><span data-gallery-count role="status">Photo 1 of ${post.media.length}</span><button class="ap-button secondary small" data-gallery-next aria-label="Next photo" ${post.media.length<2?'disabled':''}>Next →</button></div><p class="ap-copy">${esc(post.caption)}</p>`);
  const opened=popup;opened.classList.add('ap-gallery-dialog');opened.querySelector('[data-gallery-back]').onclick=()=>closeGalleryPost();
  opened.addEventListener('close',()=>{if(!disposed&&!closing.has(opened))closeGalleryPost();});
  const show=index=>{imageIndex=index;opened.querySelectorAll('[data-gallery-slide]').forEach((slide,i)=>slide.hidden=i!==index);opened.querySelector('[data-gallery-count]').textContent=`Photo ${index+1} of ${post.media.length}`;opened.querySelector('[data-gallery-prev]').disabled=index===0;opened.querySelector('[data-gallery-next]').disabled=index===post.media.length-1;hydrate(opened);};
  opened.querySelector('[data-gallery-prev]').onclick=()=>show(Math.max(0,imageIndex-1));opened.querySelector('[data-gallery-next]').onclick=()=>show(Math.min(post.media.length-1,imageIndex+1));
 }
 const controller={navigate,dispose(){save();disposed=true;revision++;postRevision++;window.removeEventListener('scroll',save);if(popup){closing.add(popup);popup.close();}posts=[];}};
 try{if(postId)await navigate(postId);return controller;}catch(error){controller.dispose();throw error;}
}
