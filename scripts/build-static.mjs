import {cp,mkdir,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const output=join(root,'dist');
const preview=process.argv.includes('--preview');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(join(root,'assets'),join(output,'assets'),{recursive:true});
const pages=(await readdir(root)).filter(p=>p.endsWith('.html'));
for(const filename of pages){
  let html=await readFile(join(root,filename),'utf8');
  if(preview)html=html.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>');
  await writeFile(join(output,filename),html);
}
for(const filename of ['robots.txt','sitemap.xml','_headers']){
 try{await cp(join(root,filename),join(output,filename))}catch(e){if(e.code!=='ENOENT')throw e}
}
if(preview)await writeFile(join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
// CNAME remains in the source for the existing domain; previews never publish it.
// Database migrations, tests and secrets are deliberately outside web output.
await mkdir(join(output,'docs'),{recursive:true});
for(const filename of ['SETUP.md','SERVICES.md','ACCEPTANCE.md','REQUIREMENTS.md','DRAFT-STATUS.md']){
 try{await cp(join(root,'docs',filename),join(output,'docs',filename))}catch(e){if(e.code!=='ENOENT')throw e}
}
console.log(`Static ${preview?'preview':'website'} built: ${pages.length} pages, original assets preserved.`);
