import { put, list, del } from '@vercel/blob';
import crypto from 'node:crypto';
const ROOT='siraj-3d-images-v2/';
const IDS=new Set(['nizwa-fort','mutrah-fort','qalhat-city','al-hamouda-fort','qubab-mosque','jalali-mirani','falaj','sur-dhow','grand-mosque','wadi-shab','khanjar','jabreen-castle','mutrah-fort','qalhat-city','al-hamouda-fort','qubab-mosque','jalali-mirani']);
const reply=(res,n,o)=>res.status(n).setHeader('Cache-Control','no-store').json(o);
const validHttp=u=>{try{const p=new URL(u);return p.protocol==='https:'?p.href:null}catch{return null}};
const authorized=req=>{const p=process.env.SIRAJ_OWNER_PASSWORD||'';const q=String(req.headers['x-siraj-admin']||'');if(!p||!q)return false;const a=Buffer.from(p),b=Buffer.from(q);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
async function getRows(){const found=[];let cursor;do{const x=await list({prefix:ROOT+'records/',cursor,limit:1000});found.push(...x.blobs);cursor=x.hasMore?x.cursor:null}while(cursor&&found.length<100);const rows=await Promise.all(found.map(async x=>{try{const v=await fetch(x.url,{cache:'no-store'});return v.ok?await v.json():null}catch{return null}}));return rows.filter(x=>x&&IDS.has(x.id)&&validHttp(x.url))}
export default async function handler(req,res){
 if(!process.env.BLOB_READ_WRITE_TOKEN)return reply(res,503,{error:'BLOB_READ_WRITE_TOKEN غير متاح للمشروع الحالي. تحقق من اتصال Vercel Blob وأعد نشر المشروع.'});
 try{
 if(req.method==='GET'){const rows=await getRows();const data={};for(const r of rows)data[r.id]={url:r.url,updatedAt:r.updatedAt||0};return reply(res,200,{ok:true,images:data})}
 if(req.method!=='POST')return reply(res,405,{error:'طريقة غير متاحة'});
 if(!authorized(req))return reply(res,403,{error:'كلمة مرور مسؤول المنصة غير صحيحة أو لم يتم إعداد SIRAJ_OWNER_PASSWORD في Vercel.'});
 const id=String(req.query.id||'');if(!IDS.has(id))return reply(res,400,{error:'معلم غير معروف'});
 const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
 if(!['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'].includes(type))return reply(res,415,{error:'اختر صورة JPG أو PNG أو WEBP أو GIF أو HEIC'});
 const length=Number(req.headers['content-length']||'0');if(length>4*1024*1024)return reply(res,413,{error:'الصورة تتجاوز 4 ميجابايت. صغّر حجمها ثم حاول.'});
 let parts=[],total=0;for await (const b of req){total+=b.length;if(total>4*1024*1024)return reply(res,413,{error:'الصورة تتجاوز 4 ميجابايت'});parts.push(b)}
 if(total<15)return reply(res,400,{error:'الصورة غير صالحة'});
 const buf=Buffer.concat(parts);const magic=buf.subarray(0,16);const known=(type==='image/jpeg'&&magic[0]===255&&magic[1]===216)||(type==='image/png'&&magic.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))||(type==='image/gif'&&magic.subarray(0,3).toString()==='GIF')||(type==='image/webp'&&magic.subarray(0,4).toString()==='RIFF'&&magic.subarray(8,12).toString()==='WEBP')||(['image/heic','image/heif'].includes(type)&&magic.subarray(4,8).toString()==='ftyp');
 if(!known)return reply(res,415,{error:'نوع الصورة لا يطابق محتواها'});
 const ext=type==='image/jpeg'?'jpg':type.split('/')[1];const old=(await getRows()).find(x=>x.id===id);
 const blob=await put(ROOT+'uploads/'+id+'-'+crypto.randomUUID()+'.'+ext,buf,{access:'public',contentType:type});
 const row={id,url:blob.url,updatedAt:Date.now()};await put(ROOT+'records/'+id+'.json',JSON.stringify(row),{access:'public',contentType:'application/json',addRandomSuffix:false,allowOverwrite:true});
 if(old?.url&&old.url!==blob.url){try{await del(old.url)}catch(e){console.warn('cleanup failed',e)}}
 return reply(res,200,{ok:true,image:row});
 }catch(e){console.error(e);return reply(res,500,{error:'تعذّر الاتصال بالتخزين السحابي. '+String(e.message||'')})}
}
export const config={api:{bodyParser:false}};
