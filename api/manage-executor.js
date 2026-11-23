// Vercel Node.js Function — place at PROJECT_ROOT/api/manage-executor.js
// Dependencies: firebase-admin, cloudinary (server-side only).
import {cert,getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import cloudinary from 'cloudinary';

const {v2:cloud}=cloudinary;
const RESOURCE_TYPES=['image','video','raw'];
const PLACEHOLDER='Аткаруучу көрсөтүлгөн эмес';

function initServices(action){
  const required=['FIREBASE_SERVICE_ACCOUNT_JSON','TENDER_ADMIN_UIDS'];
  if(action==='delete')required.push('CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET');
  const missing=required.filter(key=>!process.env[key]);
  if(missing.length)throw Object.assign(new Error('Сервердин настройкасы толук эмес: '+missing.join(', ')),{status:503});
  if(!getApps().length){
    const serviceAccount=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if(serviceAccount.project_id!=='tender-cb6c2')
      throw Object.assign(new Error('Firebase Admin tender-cb6c2 долбооруна туташышы керек'),{status:503});
    if(serviceAccount.private_key)serviceAccount.private_key=serviceAccount.private_key.replace(/\\n/g,'\n');
    initializeApp({credential:cert(serviceAccount)});
  }
  if(action==='delete'){
    if(process.env.CLOUDINARY_CLOUD_NAME!=='dqzgtlvlu')
      throw Object.assign(new Error('Cloudinary cloud name сайттагы dqzgtlvlu менен дал келиши керек'),{status:503});
    cloud.config({
      cloud_name:process.env.CLOUDINARY_CLOUD_NAME,
      api_key:process.env.CLOUDINARY_API_KEY,
      api_secret:process.env.CLOUDINARY_API_SECRET,
      secure:true
    });
  }
  return getFirestore();
}

const isMissingFolder=err=>err?.http_code===404||err?.status===404;
const keyFor=asset=>`${asset.resource_type||'raw'}:${asset.type||'upload'}:${asset.public_id}`;

async function listFolderAssets(folder){
  const found=new Map();
  // Dynamic folders: filename may not start with the physical folder name.
  try{
    let next;
    do{
      const result=await cloud.api.resources_by_asset_folder(folder,{
        max_results:500,...(next?{next_cursor:next}:{})
      });
      for(const asset of result.resources||[])found.set(keyFor(asset),asset);
      next=result.next_cursor;
    }while(next);
  }catch(err){
    // Legacy fixed-folder Cloudinary projects return 404 for this listing API.
    if(!isMissingFolder(err))throw err;
  }
  // Fixed folders: public IDs start with folder/. Also supports mixed legacy assets.
  for(const resource_type of RESOURCE_TYPES){
    let next;
    do{
      const result=await cloud.api.resources({
        resource_type,type:'upload',prefix:`${folder}/`,max_results:500,
        ...(next?{next_cursor:next}:{})
      });
      for(const asset of result.resources||[])found.set(keyFor(asset),asset);
      next=result.next_cursor;
    }while(next);
  }
  return found;
}

async function removeCloudinaryFiles(records){
  const assets=new Map();
  for(const snapshot of records){
    const folder=`tenderflow/${snapshot.id}`;
    const docs=snapshot.data().docs||{};
    for(const file of Object.values(docs)){
      if(!file)continue;
      if(typeof file.url==='string'&&file.url.startsWith('https://res.cloudinary.com/')){
        const actualCloud=new URL(file.url).pathname.split('/')[1];
        if(actualCloud!==process.env.CLOUDINARY_CLOUD_NAME)
          throw Object.assign(new Error(`Тендер ${snapshot.id}: файл башка Cloudinary аккаунтунда. Өчүрүү токтотулду.`),{status:409});
      }
      if(file.publicId){
        const asset={public_id:String(file.publicId),resource_type:file.resourceType||'raw',type:'upload'};
        assets.set(keyFor(asset),asset);
      }else if(typeof file.url==='string'&&file.url.includes('res.cloudinary.com/')){
        throw Object.assign(new Error(`Тендер ${snapshot.id}: эски файлдын Cloudinary publicId маалыматы жок. Адегенде файлды кол менен текшериңиз.`),{status:409});
      }
    }
    for(const [key,asset] of await listFolderAssets(folder))assets.set(key,asset);
  }
  let deleted=0;
  // Delete tracked files AND orphaned files that remain in the tender folders.
  const byType=new Map();
  for(const asset of assets.values()){
    const kind=`${asset.resource_type}:${asset.type}`;
    if(!byType.has(kind))byType.set(kind,[]);
    byType.get(kind).push(asset.public_id);
  }
  for(const [kind,ids] of byType){
    const [resource_type,type]=kind.split(':');
    for(let i=0;i<ids.length;i+=100){
      const publicIds=ids.slice(i,i+100);
      const result=await cloud.api.delete_resources(publicIds,{resource_type,type});
      for(const id of publicIds){
        const status=result.deleted?.[id];
        if(status==='deleted')deleted++;
        else if(status!=='not_found')throw Object.assign(new Error(`Cloudinary файлы өчкөн жок: ${id} (${status||'белгисиз'})`),{status:502});
      }
    }
  }
  return deleted;
}

async function commitRecords(database,records,action,field){
  let done=0;
  for(let i=0;i<records.length;i+=400){
    const batch=database.batch();
    for(const snapshot of records.slice(i,i+400)){
      if(action==='delete')batch.delete(snapshot.ref);
      else batch.update(snapshot.ref,{executor:field});
    }
    await batch.commit();
    done+=Math.min(400,records.length-i);
  }
  return done;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Allow','POST');
  if(req.method!=='POST')return res.status(405).json({error:'POST гана уруксат'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const action=body.action;
    if(!['rename','delete'].includes(action))return res.status(400).json({error:'Белгисиз операция'});
    const database=initServices(action);
    const token=/^Bearer (.+)$/.exec(String(req.headers.authorization||''))?.[1];
    if(!token)return res.status(401).json({error:'Аккаунтка кириңиз'});
    const verified=await getAuth().verifyIdToken(token,true);
    const admins=process.env.TENDER_ADMIN_UIDS.split(',').map(v=>v.trim()).filter(Boolean);
    if(!admins.includes(verified.uid))return res.status(403).json({error:'Аткаруучуларды башкарууга администратор гана укуктуу'});

    const executorName=typeof body.executorName==='string'?body.executorName.trim():'';
    if(executorName.length<2||executorName.length>80||executorName===PLACEHOLDER)
      return res.status(400).json({error:'Аткаруучунун аты туура эмес'});

    // Re-authentication on the client must be verifiable on the server too.
    // Merely passing a flag like `passwordVerified: true` would be insecure.
    if(action==='delete'){
      const secondsSinceAuth=Math.floor(Date.now()/1000)-Number(verified.auth_time||0);
      if(secondsSinceAuth<0||secondsSinceAuth>120)
        return res.status(403).json({error:'Өчүрүү үчүн азыркы парольду кайра жазыңыз'});
    }

    const query=await database.collection('tenders').where('executor','==',executorName).get();
    if(query.empty)return res.status(404).json({error:'Бул аткаруучунун тендерлери табылган жок. Баракты жаңыртыңыз.'});
    if(action==='rename'){
      const newName=typeof body.newName==='string'?body.newName.trim():'';
      if(newName.length<2||newName.length>80||newName===PLACEHOLDER)
        return res.status(400).json({error:'Жаңы атты туура жазыңыз (2–80 символ)'});
      if(newName===executorName)return res.status(200).json({updated:0});
      const existing=await database.collection('tenders').where('executor','==',newName).limit(1).get();
      if(!existing.empty)return res.status(409).json({error:'Бул ат менен башка аткаруучу бар'});
      const updated=await commitRecords(database,query.docs,'rename',newName);
      return res.status(200).json({updated});
    }

    // Cloudinary deletion MUST finish before removing Firestore references.
    // If it fails, the records remain available for retry/inspection.
    const filesDeleted=await removeCloudinaryFiles(query.docs);
    const deleted=await commitRecords(database,query.docs,'delete');
    return res.status(200).json({deleted,filesDeleted});
  }catch(err){
    console.error('manage-executor:',err);
    const status=err?.status&&Number.isInteger(err.status)?err.status:500;
    return res.status(status>=400&&status<600?status:500).json({error:status===500?'Сервер катасы. Vercel Logs бөлүмүн текшериңиз.':err.message});
  }
}
