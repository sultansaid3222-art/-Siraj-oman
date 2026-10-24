import { put, list, del } from '@vercel/blob';
import crypto from 'node:crypto';
const ROOT='siraj-library-v1/';
const KINDS=new Set(['video','podcast','pdf','file','link']);
const GRADES=new Set(['الخامس','السادس','السابع','الثامن']);
const SUBJECTS=new Set(['social','science','arabic']);
const respond=(res,code,data)=>{res.status(code).setHeader('Cache-Control','no-store').json(data)};
const safeUrl=(s)=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}};
const check=(request)=>{const expected=process.env.SIRAJ_OWNER_PASSWORD||'';const supplied=request.headers['x-owner-password']||'';if(!expected||!supplied)return false;const a=Buffer.from(expected),b=Buffer.from(supplied);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const configured=()=>!!process.env.BLOB_READ_WRITE_TOKEN;
const readBody=async(req)=>{if(typeof req.body==='object'&&req.body!==null&&!Buffer.isBuffer(req.body))return req.body;return {}};
const allBlobs=async()=>{let cursor,results=[];do{const p=await list({prefix:ROOT,limit:1000,cursor});results.push(...p.blobs);cursor=p.hasMore?p.cursor:undefined}while(cursor&&results.length<2000);return results};
export default async function handler(req,res){
 if(!configured())return respond(res,503,{configured:false,error:'يجب إعداد BLOB_READ_WRITE_TOKEN و SIRAJ_OWNER_PASSWORD في Vercel أولاً.'});
 try{
 if(req.method==='GET'){
   if(req.query.verify==='1')return check(req)?respond(res,200,{ok:true}):respond(res,403,{error:'غير مصرح'});
   const rows=(await allBlobs()).filter(b=>b.pathname.startsWith(ROOT+'metadata/')&&b.pathname.endsWith('.json'));
   const items=await Promise.all(rows.map(async b=>{try{const r=await fetch(b.url,{cache:'no-store'});return r.ok?await r.json():null}catch{return null}}));
   return respond(res,200,{configured:true,items:items.filter(x=>x&&x.status==='approved').sort((a,b)=>b.createdAt-a.createdAt),pending:check(req)?items.filter(x=>x&&x.status==='pending').sort((a,b)=>b.createdAt-a.createdAt):undefined});
 }
 if(req.method==='PATCH'){
   if(!check(req))return respond(res,403,{error:'غير مصرح بالمراجعة'});
   const id=String(req.query.id||'');if(!/^[a-f0-9-]{36}$/.test(id))return respond(res,400,{error:'معرّف غير صالح'});
   const b=(await allBlobs()).find(b=>b.pathname===ROOT+'metadata/'+id+'.json');if(!b)return respond(res,404,{error:'غير موجود'});
   const old=await (await fetch(b.url,{cache:'no-store'})).json();old.status='approved';
   await put(ROOT+'metadata/'+id+'.json',JSON.stringify(old),{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:true});
   return respond(res,200,{ok:true});
 }
 if(req.method==='DELETE'&&!check(req))return respond(res,403,{error:'غير مصرح بالحذف'});
 if(req.method==='DELETE'){
   const id=String(req.query.id||'');if(!/^[a-f0-9-]{36}$/.test(id))return respond(res,400,{error:'معرّف غير صالح'});
   const b=(await allBlobs()).find(b=>b.pathname===ROOT+'metadata/'+id+'.json');if(!b)return respond(res,404,{error:'المادة غير موجودة'});
   const r=await fetch(b.url);const doc=await r.json();
   await del(b.url);if(doc.fileUrl)await del(doc.fileUrl);return respond(res,200,{ok:true});
 }
 if(req.method==='POST'){
   // Vercel handles multipart/form-data with formidable via bodyParser:false; require separate parse.
   const {default:Busboy}=await import('busboy');
   const fields={},files=[];
   await new Promise((resolve,reject)=>{
     const parser=Busboy({headers:req.headers,limits:{fileSize:4*1024*1024,files:1,fields:10}});
     parser.on('field',(name,val)=>{fields[name]=val});
     parser.on('file',(name,stream,info)=>{const parts=[];let size=0;stream.on('data',b=>{size+=b.length;parts.push(b)});stream.on('limit',()=>reject(Error('الملف أكبر من 4 ميجابايت؛ استخدم رابطًا مباشرًا')));stream.on('end',()=>files.push({name:info.filename,mime:info.mimeType,data:Buffer.concat(parts),size}))});
     parser.on('error',reject);parser.on('finish',resolve);req.pipe(parser);
   });
   const grade=fields.grade,subject=fields.subject,kind=fields.kind;
   const title=String(fields.title||'').trim().slice(0,160),description=String(fields.description||'').slice(0,500);
   const url=fields.url?safeUrl(fields.url):'';
   if(!GRADES.has(grade)||!SUBJECTS.has(subject)||!KINDS.has(kind)||!title||(!url&&!files.length))return respond(res,400,{error:'بيانات ناقصة أو غير صالحة'});
   if(fields.url&&!url)return respond(res,400,{error:'رابط غير صالح'});
   const file=files[0];const id=crypto.randomUUID();let fileUrl='';
   if(file){
     if(file.size>4*1024*1024)return respond(res,413,{error:'الملف أكبر من 4MB'});
     const ext=(file.name?.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'bin';
     const uploaded=await put(ROOT+'uploads/'+id+'.'+ext,file.data,{access:'public',contentType:file.mime||'application/octet-stream'});
     fileUrl=uploaded.url;
   }
   const item={id,title,description,kind,grade,subject,url,fileUrl,createdAt:Date.now(),status:'pending'};
   await put(ROOT+'metadata/'+id+'.json',JSON.stringify(item),{access:'public',contentType:'application/json'});
   return respond(res,201,{ok:true,item,message:'استُلمت المادة وهي الآن بانتظار المراجعة'});
 }
 return respond(res,405,{error:'الطريقة غير متاحة'});
 }catch(e){console.error(e);return respond(res,500,{error:e.message||'خطأ خادم'})}
}
export const config={api:{bodyParser:false}};
