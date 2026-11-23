import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import{FieldPath,collection,deleteDoc,doc,getDoc,getDocsFromServer,setDoc,updateDoc,onSnapshot}from'firebase/firestore';
import { db, auth, firebaseApp } from "./firebase";
import{
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential
}from'firebase/auth';
import{
  LayoutDashboard,
  Briefcase,
  Building2,
  Copy,
  FileText,
  Settings,
  Search,
  Users,
  ShieldCheck,
  Plus,
  Upload,
  Wallet,
  X,
  Paperclip,
  Trash2,
  CheckCircle2,
  FolderOpen,
  Save,
  PackageCheck,
  Pencil,
  Download,
  Printer,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  LogOut,
  User
}from'lucide-react';
import'./style.css';

const DOC_GROUPS={
  'Тендерге катышуу': ['Таблица цен','Техническая спецификация','Коммерческое предложение','Заявка на участие','Гарантийное письмо','Сертификат соответствия','Декларация соответствия','Реквизиты компании','Справка об отсутствии задолженности','Лицензия / разрешительные документы','Доверенность','Учредительные документы'],
  'Договор жана жеткирүү': ['Договор','Дополнительное соглашение','Спецификация к договору','Счет на оплату','Счет-фактура','Накладная','Акт приема-передачи','Акт выполненных работ','Акт сверки','Платежное поручение'],
  'Кепилдиктер жана кайтаруу': ['ГОПП — гарантийное обеспечение предложения','ГОИК — гарантийное обеспечение исполнения контракта','ГОКЗ — гарантийное обеспечение качества','Заявление на возврат ГОПП','Возврат ГОПП — подтверждение','Заявление на возврат ГОИК','Возврат ГОИК — подтверждение','Заявление на возврат ГОКЗ','Возврат ГОКЗ — подтверждение'],
  'Башка': ['Другие документы']
};
const DOCS=Object.values(DOC_GROUPS).flat();

// Таблица цен документин эски жана жаңы сактоо форматтарынан аныктоо.
const hasPriceTable = docs => Object.entries(docs || {}).some(([key, file]) => {
  if (!file) return false;
  const labels = [key.split('__')[0], file.docName, file.name]
    .filter(Boolean)
    .map(value => String(value).trim().toLocaleLowerCase('ru-RU').replace(/[_-]+/g, ' ').replace(/\s+/g, ' '));
  return labels.some(value => /(?:таблица\s*цен|ценовая\s*таблица|таблица\s*баа)/i.test(value));
});
const tenderKey=t=>t.recordId||t.id;
// «Срок вскрытия»: жаңы күн биринчи, эски күн акырында.
// ISO YYYY-MM-DD даталары түз сап катары да туура салыштырылат.
// Датасы жок/туура эмес тендерлер тизменин аягына жайгашат.
const dateOrderValue = value => {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [year, month, day] = date.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? date : '';
};
const sortTendersByDate = list => [...list].sort((a, b) => {
  const da = dateOrderValue(a.date);
  const db = dateOrderValue(b.date);
  if (da !== db) return da < db ? 1 : -1;
  // Бирдей дата болсо, баштапкы ирет сакталат (stable sort).
  return 0;
});

const matches=(value,term)=>String(value||'').toLocaleLowerCase().includes(term.trim().toLocaleLowerCase());
const fileSize=n=>n ? (n<1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`) : '—';

const isNotHeld=t=>t?.status==='not_held';
const hasGuarantee=(t,kind)=>String(t?.[kind]??'').trim()!=='';
const isGuaranteePaid=(t,kind)=>{
  const status=t?.[kind+'Status'];
  return status==='paid'||status==='returned'||(!status&&!!t?.[kind+'Paid']);
};
const guaranteeLabel=kind=>kind==='gopp'?'ГОПП':kind==='goik'?'ГОИК':String(kind||'').toUpperCase();
const matchesGuaranteeFilter=(t,filter)=>{
  if(!filter)return true;
  if(!hasGuarantee(t,filter.kind))return false;
  return isGuaranteePaid(t,filter.kind)===(filter.status==='paid');
};

const money=n=>
  new Intl.NumberFormat('ru-RU').format(Number(n)||0)+' сом';

const niceDate=v=>v||'—';

const CLOUDINARY_CLOUD_NAME = 'dqzgtlvlu';
const CLOUDINARY_UPLOAD_PRESET = 'tender';

async function uploadToCloudinary(file,tenderId,docName){
  const form=new FormData();
  form.append('file',file);
  form.append('upload_preset',CLOUDINARY_UPLOAD_PRESET);
  form.append('folder',`tenderflow/${tenderId}`);

  const res=await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${file.type.startsWith('image/')||file.type.startsWith('video/')||file.name.toLowerCase().endsWith('.pdf')?'auto':'raw'}/upload`,
    {method:'POST',body:form}
  );
  const data=await res.json();

  if(!res.ok){
    throw new Error(data?.error?.message||'Cloudinary upload error');
  }

  return {
    name:file.name,
    size:file.size,
    type:file.type,
    url:data.secure_url,
    publicId:data.public_id,
    resourceType:data.resource_type,
    docName
  };
}

async function downloadCloudFile(url,fileName){
  if(!url){
    alert('Файлдын ссылкасы табылган жок.');
    return;
  }

  try{
    const res=await fetch(url);
    if(!res.ok)throw new Error('download');
    const blob=await res.blob();
    const blobUrl=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=blobUrl;
    a.download=fileName||'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(blobUrl),1000);
  }catch{
    window.open(url,'_blank','noopener,noreferrer');
  }
}

export default function App(){

  const[tenders,setTenders]=useState([]);
  const[syncError,setSyncError]=useState('');
  const[syncState,setSyncState]=useState('loading');
  const[syncRetry,setSyncRetry]=useState(0);
  const firebaseProjectId=firebaseApp.options.projectId||'белгисиз';
  const[active,setActive]=useState(null);
  const[addOpen,setAddOpen]=useState(false);
  const[addFiles,setAddFiles]=useState([]);
  const[addFileError,setAddFileError]=useState('');
  const[docsOpen,setDocsOpen]=useState(false);
  const[q,setQ]=useState('');
  const[tableSearchOpen,setTableSearchOpen]=useState(false);
  const tableSearchInputRef=useRef(null);
  const tableSearchContainerRef=useRef(null);
  const[copyTip,setCopyTip]=useState(null);
  const[guaranteeFilter,setGuaranteeFilter]=useState(null);
  const[page,setPage]=useState('tenders');
  const[payStatusModal,setPayStatusModal]=useState(null);

  const[selectedExecutor,setSelectedExecutor]=useState(null);
  const[executorQuery,setExecutorQuery]=useState('');
  const[selectedIds,setSelectedIds]=useState([]);
  const[openAccordionMap,setOpenAccordionMap]=useState({});
  const[executorsExpanded,setExecutorsExpanded]=useState(false);
  const[logoutConfirm,setLogoutConfirm]=useState(false);
  const[deleteConfirmOpen,setDeleteConfirmOpen]=useState(false);
  const[mobileNavOpen,setMobileNavOpen]=useState(false);
  useEffect(()=>{
    document.body.classList.toggle('nav-lock', mobileNavOpen);
    return ()=>document.body.classList.remove('nav-lock');
  },[mobileNavOpen]);

  useEffect(()=>{
    // Every main menu page owns its scroll inside <main>.
    // Reset it when switching pages and make sure no stale body lock survives.
    if(!mobileNavOpen) document.body.classList.remove('nav-lock');
    const main=document.querySelector('.shell > main');
    if(main) main.scrollTo({top:0,left:0,behavior:'auto'});
  },[page,mobileNavOpen]);

  const[user,setUser]=useState(null);
  const[authReady,setAuthReady]=useState(false);
  const[companies,setCompanies]=useState([]);
  const[authMode,setAuthMode]=useState('login');
  const[selectedCompany,setSelectedCompany]=useState(null);
  const[authError,setAuthError]=useState('');
  const[authBusy,setAuthBusy]=useState(false);
  const[resetCode,setResetCode]=useState(
    new URLSearchParams(window.location.search).get('oobCode')||''
  );
  const[resetMode,setResetMode]=useState(()=>{
    const params=new URLSearchParams(window.location.search);
    const path=window.location.pathname.replace(/\/+$/,'');
    return params.get('mode')==='resetPassword' || path==='/reset-password';
  });
  const[resetEmail,setResetEmail]=useState('');
  const[resetVerified,setResetVerified]=useState(false);

  React.useEffect(()=>{
    if(!resetMode || !resetCode)return;

    verifyPasswordResetCode(auth,resetCode)
      .then(email=>{
        setResetEmail(email);
        setResetVerified(true);
        setAuthError('');
      })
      .catch(err=>{
        console.error('Reset code error:',err);
        setResetVerified(false);
        setAuthError('Бул пароль калыбына келтирүү шилтемеси жараксыз же мөөнөтү бүткөн.');
      });
  },[resetMode,resetCode]);

  React.useEffect(()=>{
    let mounted=true;
    let unsubscribe=()=>{};
    (async()=>{
      try{
        // Firebase сеансы F5 басылганда жана браузер кайра ачылганда сакталат.
        await setPersistence(auth,browserLocalPersistence);
      }catch(err){console.error('Auth persistence:',err);}
      if(!mounted)return;
      unsubscribe=onAuthStateChanged(auth,u=>{
        if(!mounted)return;
        setUser(u);
        setAuthReady(true);
      });
    })();
    return()=>{mounted=false;unsubscribe();};
  },[]);

  React.useEffect(()=>{
    if(!authReady || !user?.uid){setCompanies([]);return;}
    let current=true;
    // Профиль гана окулат; башка аккаунттардын маалыматтары да, localStorage да колдонулбайт.
    Promise.all([
      getDoc(doc(db,'publicCompanies',user.uid)).catch(err=>{console.warn('Profile load:',err);return null;}),
      getDoc(doc(db,'companies',user.uid)).catch(err=>{console.warn('Legacy profile load:',err);return null;})
    ]).then(([primary,legacy])=>{
      if(!current)return;
      const record=primary?.exists()?primary:legacy?.exists()?legacy:null;
      const company={uid:user.uid,email:user.email,name:user.email?.split('@')[0]||'Компания',...(record?.data()||{})};
      setCompanies([company]);
      setSelectedCompany({email:company.email,name:company.name});
    }).catch(err=>{console.error('Company load:',err);});
    return()=>{current=false;};
  },[authReady,user?.uid,user?.email]);

  React.useEffect(()=>{
    if(!user){setTenders([]);setSyncError('');setSyncState('loading');return;}
    let alive=true;
    let serverSeen=false;
    const tendersRef=collection(db,'tenders');
    const recordsFromSnapshot=snapshot=>snapshot.docs.map(d=>{
      const data=d.data();
      return {...data,recordId:d.id,id:data.id||d.id};
    });
    const showReadError=err=>{
      if(!alive)return;
      console.error('Firestore read:',err);
      setSyncState('error');
      setSyncError(err?.code==='permission-denied'
        ?'Firestore Rules окууга уруксат берген жок. Firebase Console → Firestore → Rules бөлүмүн текшериңиз.'
        :'Firebase серверинен маалымат алынган жок: '+(err?.message||String(err)));
    };
    setSyncState('loading');
    setSyncError('');
    // Орток база: бардык аккаунттар бардык тендерлерди, анын ичинде «Не состоялся»
    // статусундагыларды да, реалдуу убакытта көрөт. ownerUid окууну чектебейт.
    const unsub=onSnapshot(tendersRef,{includeMetadataChanges:true},snap=>{
      if(!alive)return;
      // Firestore башында бош локалдык кешти бериши мүмкүн: аны сервердин
      // чындап эле бош жообу катары көрсөтпөйбүз.
      if(snap.metadata.fromCache){
        if(!serverSeen){
          if(snap.size>0)setTenders(recordsFromSnapshot(snap));
          setSyncState('loading');
        }
        return;
      }
      serverSeen=true;
      setTenders(recordsFromSnapshot(snap));
      setSyncState(snap.empty?'empty':'connected');
      setSyncError('');
    },err=>{
      showReadError(err);
    });
    // Кештен эле бош жооп келе берсе же интернет үзүлсө — ачык ката чыгарабыз.
    // Серверден алынган биринчи натыйжаны realtime listener андан ары жаңыртат.
    getDocsFromServer(tendersRef).then(snap=>{
      if(!alive||serverSeen)return;
      serverSeen=true;
      setTenders(recordsFromSnapshot(snap));
      setSyncState(snap.empty?'empty':'connected');
      setSyncError('');
    }).catch(err=>{if(!serverSeen)showReadError(err);});
    return ()=>{alive=false;unsub();};
  },[user?.uid,syncRetry]);

  const[notice,setNotice]=useState('');
  // Ар бир жаңы билдирүү 3 секунддан кийин автоматтык жабылат.
  useEffect(()=>{
    if(!notice)return;
    const timer=window.setTimeout(()=>setNotice(''),3000);
    return ()=>window.clearTimeout(timer);
  },[notice]);
  const[busy,setBusy]=useState(false);
  const saveRemote=async (recordId,record)=>{
    if(!user?.uid)throw new Error('Firebase аккаунтуна кириңиз');
    // Башка кызматкер өзгөртсө да, тендерди биринчи кошкон адамдын UID'си сакталат.
    await setDoc(doc(db,'tenders',recordId),{...record,recordId,ownerUid:record.ownerUid||user.uid});
  };
  const patchRemote=async (recordId,patch)=>{
    if(!user?.uid)throw new Error('Firebase аккаунтуна кириңиз');
    await updateDoc(doc(db,'tenders',recordId),patch);
  };
  const reportError=(err)=>{console.error(err);setNotice('Firebase катасы: '+(err?.message||String(err)));};

  const showCopyTip=(event)=>{
    const rect=event.currentTarget.getBoundingClientRect();
    setCopyTip({left:Math.min(window.innerWidth-76,Math.max(76,rect.right-14)),top:Math.max(10,rect.top-40)});
  };

  const copyTenderNumber=async(number)=>{
    const value=String(number||'');
    if(!value)return;
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(value);
      }else{
        const input=document.createElement('textarea');
        input.value=value;
        input.style.position='fixed';input.style.opacity='0';
        document.body.appendChild(input);
        input.select();
        const copied=document.execCommand('copy');
        input.remove();
        if(!copied)throw new Error('copy failed');
      }
      setNotice('Номер скопирован');
    }catch(err){setNotice('Номер көчүрүлгөн жок. Кайра аракет кылыңыз.');}
  };

  const createAccount=async e=>{
    e.preventDefault();setAuthError('');
    const f=new FormData(e.currentTarget);
    const email=String(f.get('email')||'').trim().toLowerCase();
    const password=String(f.get('password')||'');
    const repeatPassword=String(f.get('repeatPassword')||'');
    if(!email){setAuthError('Email дарегин жазыңыз');return;}
    if(password.length<6){setAuthError('Пароль кеминде 6 символ болушу керек');return;}
    if(password!==repeatPassword){setAuthError('Паролдор дал келиши керек');return;}
    setAuthBusy(true);
    try{
      const credential=await createUserWithEmailAndPassword(auth,email,password);
      const name=email.split('@')[0];
      const company={uid:credential.user.uid,email,name,authType:'password'};
      setSelectedCompany(company);
      await Promise.all([
        setDoc(doc(db,'publicCompanies',credential.user.uid),company),
        setDoc(doc(db,'companies',credential.user.uid),company).catch(()=>null)
      ]);
      const next=[...companies.filter(c=>(c.uid||c.docId)!==credential.user.uid),company];
      setCompanies(next);setAuthMode('login');
    }catch(err){
      const code=err?.code||'';
      if(code==='auth/email-already-in-use')setAuthError('Бул email менен аккаунт мурунтан катталган');
      else if(code==='auth/weak-password')setAuthError('Пароль өтө жөнөкөй. Башка пароль жазыңыз');
      else setAuthError('Каттоо катасы: '+(err.message||code));
    }finally{setAuthBusy(false)}
  };
  const login=async e=>{
    e.preventDefault();setAuthError('');
    const f=new FormData(e.currentTarget);
    const email=String(f.get('email')||selectedCompany?.email||'').trim().toLowerCase();
    const secret=String(f.get('password')||'');
    if(!email){setAuthError('Email дарегин жазыңыз');return;}
    if(!secret){setAuthError('Парольду жазыңыз');return;}
    setAuthBusy(true);
    try{
      await signInWithEmailAndPassword(auth,email,secret);
      setSelectedCompany({email,name:email.split('@')[0]});
    }catch(err){
      setAuthError('Email же пароль туура эмес');
    }finally{setAuthBusy(false)}
  };
  const resetPassword=async(emailOverride='')=>{
    const email=String(emailOverride||selectedCompany?.email||user?.email||'').trim().toLowerCase();
    if(!email)return;
    setAuthBusy(true);setAuthError('');
    try{
      await sendPasswordResetEmail(auth,email);
      setAuthError('Пароль алмаштыруу шилтемеси email дарегине жөнөтүлдү.');
    }catch(err){setAuthError(err.message)}finally{setAuthBusy(false)}
  };
  const saveReset=async e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    const password=String(f.get('password')||'');
    const repeat=String(f.get('repeatPassword')||'');
    if(password.length<6){setAuthError('Жаңы пароль кеминде 6 символ болушу керек');return;}
    if(password!==repeat){setAuthError('Паролдор дал келиши керек');return;}
    setAuthBusy(true);
    try{
      await confirmPasswordReset(auth,resetCode,password);
      window.history.replaceState({},'', '/');
      setResetMode(false);setAuthError('');
    }catch(err){setAuthError(err.message)}finally{setAuthBusy(false)}
  };


  const currentCompany=companies.find(c=>(c.uid||c.docId)===user?.uid || c.email===user?.email)||null;

  const updateCompanyName=async e=>{
    e.preventDefault();
    const name=String(new FormData(e.currentTarget).get('companyName')||'').trim();
    if(name.length<2){setNotice('Компаниянын атын туура жазыңыз');return;}
    setBusy(true);
    try{
      const uid=user.uid;
      const updated={...(currentCompany||{}),uid,email:user.email,name,authType:currentCompany?.authType||'password'};
      await Promise.all([
        setDoc(doc(db,'publicCompanies',uid),updated,{merge:true}),
        setDoc(doc(db,'companies',uid),updated,{merge:true}).catch(()=>null)
      ]);
      const next=[...companies.filter(c=>(c.uid||c.docId)!==uid && c.email!==user.email),updated];
      setCompanies(next);setNotice('Компаниянын аты өзгөртүлдү');
    }catch(err){reportError(err)}finally{setBusy(false)}
  };

  const changeAccountPassword=async e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    const current=String(f.get('currentPassword')||'');
    const next=String(f.get('newPassword')||'');
    const repeat=String(f.get('repeatNewPassword')||'');
    const legacy=currentCompany?.authType==='pin';
    if(!current){setNotice('Азыркы парольду жазыңыз');return;}
    if(next.length<6){setNotice('Жаңы пароль кеминде 6 символ болушу керек');return;}
    if(next!==repeat){setNotice('Жаңы паролдор дал келген жок');return;}
    setBusy(true);
    try{
      const credential=EmailAuthProvider.credential(user.email,current);
      await reauthenticateWithCredential(user,credential);
      await updatePassword(user,next);
      const updated={...(currentCompany||{}),uid:user.uid,email:user.email,name:currentCompany?.name||'Компания',authType:'password'};
      await Promise.all([
        setDoc(doc(db,'publicCompanies',user.uid),updated,{merge:true}),
        setDoc(doc(db,'companies',user.uid),updated,{merge:true}).catch(()=>null)
      ]);
      const list=[...companies.filter(c=>(c.uid||c.docId)!==user.uid && c.email!==user.email),updated];
      setCompanies(list);e.currentTarget.reset();setNotice('Пароль ийгиликтүү өзгөртүлдү');
    }catch(err){
      if(['auth/invalid-credential','auth/wrong-password','auth/invalid-login-credentials'].includes(err?.code))setNotice('Firebase азыркы парольду кабыл алган жок. Кирүүдө колдонгон парольду кайра текшериңиз же төмөнкү email аркылуу калыбына келтирүүнү колдонуңуз.');
      else if(err?.code==='auth/too-many-requests')setNotice('Көп аракет жасалды. Бир аздан кийин кайталаңыз же email аркылуу калыбына келтириңиз.');
      else if(err?.code==='auth/requires-recent-login')setNotice('Коопсуздук үчүн аккаунтка кайра кирип, парольду өзгөртүңүз.');
      else reportError(err);
    }finally{setBusy(false)}
  };

  // Аткаруучулар Firestore'до өзүнчө аккаунт эмес: алардын аты тендерлерде сакталат.
  // Өчүрүү Cloudinary менен Firestore'ду тең тазалаган корголгон сервердик API аркылуу өтөт.
  const manageExecutor=async(action,executorName,newName='',currentPassword='')=>{
    if(!user?.email||busy)return {ok:false,error:'Аккаунтка кириңиз'};
    setBusy(true);
    try{
      if(action==='delete'){
        if(!currentPassword)return {ok:false,error:'Өз аккаунтуңуздун паролун жазыңыз'};
        await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,currentPassword));
      }
      const token=await user.getIdToken(action==='delete');
      const response=await fetch('/api/manage-executor',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({action,executorName,newName:action==='rename'?newName:undefined})
      });
      // Vite localhost:5173 API жок учурда index.html'ди 200 катары кайтарышы мүмкүн.
      // Ошону ийгиликтүү операция деп кабыл алууга БОЛБОЙТ.
      if(!response.headers.get('content-type')?.includes('application/json'))
        throw new Error('Аткаруучулар API табылган жок. Бул функцияны Vercel сайтында текшериңиз (локалдык Vite сервери /api иштетпейт).');
      const result=await response.json().catch(()=>{throw new Error('Сервер туура JSON жооп берген жок');});
      if(!response.ok)throw new Error(result.error||`Сервер катасы (${response.status})`);
      if(action==='rename'&&!Number.isInteger(result.updated))throw new Error('Сервер өзгөртүүнү ырастаган жок');
      if(action==='delete'&&(!Number.isInteger(result.deleted)||!Number.isInteger(result.filesDeleted)))throw new Error('Сервер толук өчүрүүнү ырастаган жок');
      if(action==='rename'){
        if(selectedExecutor===executorName)setSelectedExecutor(newName.trim());
        setNotice(`«${executorName}» → «${newName.trim()}»: ${result.updated} тендер өзгөртүлдү`);
      }else{
        if(selectedExecutor===executorName){setSelectedExecutor(null);setPage('tenders');}
        setSelectedIds([]);
        setNotice(`«${executorName}» өчүрүлдү: ${result.deleted} тендер, ${result.filesDeleted} файл`);
      }
      return {ok:true};
    }catch(err){
      const message=['auth/invalid-credential','auth/wrong-password','auth/invalid-login-credentials'].includes(err?.code)
        ?'Азыркы аккаунттун паролу туура эмес'
        :err?.code==='auth/too-many-requests'
          ?'Көп аракет болду. Бир аздан кийин кайра аракет кылыңыз'
          :err?.message||'Өзгөртүү аткарылган жок';
      return {ok:false,error:message};
    }finally{setBusy(false);}
  };

  const[paymentEditId,setPaymentEditId]=useState(null);
  const[paymentValue,setPaymentValue]=useState('');

  const[editingId,setEditingId]=useState(null);
  const[editDraft,setEditDraft]=useState(null);
  const[mobileEditOpen,setMobileEditOpen]=useState(false);
  const[mobilePaymentTender,setMobilePaymentTender]=useState(null);

  const isFailedPage=page==='not-held';
  // «Тендерлер» бөлүмүндө активдүү лоттор гана, «Не состоялся» бөлүмүндө
  // токтотулган лоттор гана көрсөтүлөт. Эки тизме бири-бирине аралашпайт.
  const belongsToCurrentSection=t=>isFailedPage?isNotHeld(t):!isNotHeld(t);
  // Аткаруучуну менюдан тандаганда гана анын тендерлерин башкаруу ачылат.
  const isGeneralPage=page==='tenders'&&!selectedExecutor;
  const canManageTenders=Boolean(selectedExecutor)&&(page==='tenders'||page==='not-held');
  // «Не состоялся» бөлүмүндө аткаруучу тандалбаса да ГОПП, ГОИК жана файлдар иштейт.
  // Жалпы «Тендерлер» бөлүмү мурдагыдай көрүү үчүн гана калат.
  const canManageGuaranteesAndFiles=canManageTenders||isFailedPage;
  useEffect(()=>{if(tableSearchOpen)tableSearchInputRef.current?.focus();},[tableSearchOpen]);
  useEffect(()=>{
    if(!tableSearchOpen)return;
    const closeOnOutside=(event)=>{
      if(!tableSearchContainerRef.current?.contains(event.target)){
        setTableSearchOpen(false);
        setQ('');
      }
    };
    document.addEventListener('pointerdown',closeOnOutside);
    return ()=>document.removeEventListener('pointerdown',closeOnOutside);
  },[tableSearchOpen]);

  const executorsGroup=useMemo(()=>{
    const map={};
    tenders.forEach(t=>{
      const ex=t.executor||'Аткаруучу көрсөтүлгөн эмес';
      if(!map[ex]) map[ex]=[];
      map[ex].push(t);
    });
    Object.keys(map).forEach(name=>{map[name]=sortTendersByDate(map[name]);});
    return map;
  },[tenders]);
  // Сол жактагы аткаруучулардын саны да учурдагы бөлүмгө гана тиешелүү.
  // Настройкадагы башкаруу үчүн executorsGroup толук бойдон сакталат.
  const sidebarExecutorsGroup=useMemo(()=>{
    const map={};
    Object.entries(executorsGroup).forEach(([name,items])=>{
      const visible=items.filter(t=>isFailedPage?isNotHeld(t):!isNotHeld(t));
      if(visible.length)map[name]=visible;
    });
    return map;
  },[executorsGroup,isFailedPage]);

  // Бир номердеги лоттор жалпы тизмеде да, аткаруучунун бөлүмүндө да бир сапта.
  const [activeLotByTender,setActiveLotByTender]=useState({});
  const [openLotTender,setOpenLotTender]=useState(null);
  const toggleLotMenu=key=>setOpenLotTender(previous=>previous===key?null:key);
  useEffect(()=>{
    if(!openLotTender)return;
    const close=e=>{if(!e.target.closest('.tfLotPicker'))setOpenLotTender(null)};
    document.addEventListener('pointerdown',close);
    return ()=>document.removeEventListener('pointerdown',close);
  },[openLotTender]);
  const groupedLots=useMemo(()=>{
    const groups=new Map();
    sortTendersByDate(tenders.filter(t=>belongsToCurrentSection(t)&&
      (!selectedExecutor||(t.executor||'Аткаруучу көрсөтүлгөн эмес')===selectedExecutor))).forEach(t=>{
      const number=String(t.id||'').trim();
      const key=number || `single:${tenderKey(t)}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(t);
    });
    // Издөө бир лотко дал келсе да, ошол номердин БАРДЫК лоттору жана жалпы суммасы көрүнөт.
    return new Map(Array.from(groups.entries()).filter(([,lots])=>lots.some(t=>
      [t.id,t.org,t.name,t.executor,t.partnerCompany].join(' ').toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())
      && matchesGuaranteeFilter(t,guaranteeFilter)
    )));
  },[tenders,isFailedPage,selectedExecutor,q,guaranteeFilter]);
  const displayGroups=useMemo(()=>{
    const entries=Array.from(groupedLots.entries());
    return entries.map(([groupKey,lots])=>{
      const matchesCurrent=x=>[x.id,x.org,x.name,x.executor,x.partnerCompany].join(' ')
        .toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())&&matchesGuaranteeFilter(x,guaranteeFilter);
      const selected=lots.find(x=>tenderKey(x)===activeLotByTender[groupKey]);
      return {
        groupKey,lots,
        t:selected||lots.find(matchesCurrent)||lots[0],
        totalSum:lots.reduce((sum,item)=>sum+(Number(item.sum)||0),0),
        totalPaid:lots.reduce((sum,item)=>sum+(Number(item.paid)||0),0)
      };
    });
  },[groupedLots,activeLotByTender,q,guaranteeFilter]);
  const displayFiltered=useMemo(()=>displayGroups.map(x=>x.t),[displayGroups]);
  const selectLot=(groupKey,recordId)=>{
    setActiveLotByTender(prev=>({...prev,[groupKey]:recordId}));
    setOpenLotTender(null);
    setEditingId(null);
    setEditDraft(null);
    setPaymentEditId(null);
  };
  const selectedTenders=useMemo(()=>{
    return tenders.filter(t=>selectedIds.includes(tenderKey(t)));
  },[tenders,selectedIds]);

  const selectedExecutorsSet=useMemo(()=>{
    const set=new Set();
    selectedTenders.forEach(t=>set.add(t.executor||'Аткаруучу көрсөтүлгөн эмес'));
    return Array.from(set);
  },[selectedTenders]);

  const headerExecutorTitle=useMemo(()=>{
    if(selectedExecutor) return selectedExecutor;
    if(selectedExecutorsSet.length===1) return selectedExecutorsSet[0];
    if(selectedExecutorsSet.length>1) return null;
    return null;
  },[selectedExecutor,selectedExecutorsSet]);

  const scopeTenders=useMemo(()=>selectedExecutor
    ?tenders.filter(t=>belongsToCurrentSection(t)&&(t.executor||'Аткаруучу көрсөтүлгөн эмес')===selectedExecutor)
    :tenders.filter(belongsToCurrentSection),[tenders,selectedExecutor,isFailedPage]);
  const scopeTenderCount=useMemo(()=>new Set(scopeTenders.map(t=>String(t.id||tenderKey(t)).trim())).size,[scopeTenders]);
  const total=useMemo(()=>scopeTenders.reduce((sum,t)=>sum+(Number(t.sum)||0),0),[scopeTenders]);
  const displayedTotal=selectedIds.length>0
    ?selectedTenders.reduce((sum,t)=>sum+(Number(t.sum)||0),0)
    :total;

  const chooseGuaranteeFilter=(kind,status)=>{
    setGuaranteeFilter(previous=>previous?.kind===kind&&previous?.status===status?null:{kind,status});
    setSelectedIds([]);
    setOpenLotTender(null);
    setEditingId(null);
    setEditDraft(null);
    setPaymentEditId(null);
  };

  const toggleGroupSelect=lots=>{
    const ids=lots.map(tenderKey);
    setSelectedIds(prev=>ids.every(id=>prev.includes(id))
      ?prev.filter(id=>!ids.includes(id))
      :Array.from(new Set([...prev,...ids])));
    setExecutorsExpanded(false);
  };

  const toggleSelectAll=()=>{
    const visible=displayGroups.flatMap(group=>group.lots.map(tenderKey));
    setSelectedIds(prev=>visible.length && visible.every(id=>prev.includes(id))
      ?prev.filter(id=>!visible.includes(id))
      :Array.from(new Set([...prev,...visible])));
    setExecutorsExpanded(false);
  };

  const deleteSelected=()=>{
    if(!canManageTenders)return;
    if(selectedIds.length===0)return;
    setDeleteConfirmOpen(true);
  };

  const runBulk=async (action,successNotice)=>{
    if(!canManageTenders||!selectedIds.length||busy)return;
    const ids=[...selectedIds];
    setBusy(true);
    try{
      const outcomes=await Promise.allSettled(ids.map(async id=>{
        const tender=tenders.find(t=>tenderKey(t)===id);
        if(!tender)throw new Error('Тендер Firebase тизмесинен табылган жок');
        if((tender.executor||'Аткаруучу көрсөтүлгөн эмес')!==selectedExecutor)throw new Error('Тендер башка аткаруучуга тиешелүү');
        await action(id,tender);
      }));
      const failed=outcomes.map((outcome,i)=>({outcome,id:ids[i]})).filter(x=>x.outcome.status==='rejected');
      setSelectedIds(failed.map(x=>x.id));
      if(!failed.length){
        setDeleteConfirmOpen(false);
        setNotice(successNotice);
      }else{
        const error=failed[0].outcome.reason;
        setNotice(`${ids.length-failed.length}/${ids.length} сакталды. ${failed.length} ката: ${error?.message||String(error)}`);
        console.error('Firebase bulk action:',error);
      }
    }finally{setBusy(false)}
  };

  const markNotHeld=()=>runBulk((id,tender)=>isNotHeld(tender)?Promise.resolve():patchRemote(id,{status:'not_held'}),'Тендерлер «Не состоялся» деп белгиленди');
  const restoreTenders=()=>runBulk((id,tender)=>!isNotHeld(tender)?Promise.resolve():patchRemote(id,{status:'active'}),'Тендерлер кайра активдештирилди');

  const confirmDeleteSelected=()=>{
    if(!canManageTenders||!selectedIds.length){setDeleteConfirmOpen(false);return;}
    return runBulk(id=>deleteDoc(doc(db,'tenders',id)),'Тандалган тендерлер өчүрүлдү');
  };

  const update=async(id,patch)=>{
    const old=tenders.find(t=>tenderKey(t)===id);if(!old)return;
    const allowed=new Set(['goppStatus','goppPaid','goikStatus','goikPaid','docs']);
    const isOnlyAllowedFields=Object.keys(patch).every(key=>allowed.has(key));
    const managingOwnExecutor=canManageTenders&&(old.executor||'Аткаруучу көрсөтүлгөн эмес')===selectedExecutor;
    const managingFailedExtras=isFailedPage&&isNotHeld(old)&&isOnlyAllowedFields;
    if(!managingOwnExecutor&&!managingFailedExtras){
      setNotice('Өзгөртүү үчүн сол жактан ушул тендердин аткаруучусун тандаңыз');return false;
    }
    if(isNotHeld(old)&&Object.keys(patch).some(key=>!allowed.has(key))){
      setNotice('Бул тендер токтотулган: ГОПП, ГОИК жана файлдар гана өзгөртүлөт');return false;
    }
    try{
      if(patch.docs){
        // FieldPath өзгөчө символдору бар файл аттарын туура иштетет.
        // updateDoc башка файлдарды өчүрбөйт жана жок тендерди кайра түзбөйт.
        const docFields=Object.entries(patch.docs).flatMap(([key,value])=>[new FieldPath('docs',key),value]);
        if(!docFields.length)return true;
        await updateDoc(doc(db,'tenders',id),...docFields);
      }else{
        await patchRemote(id,patch);
      }
      setActive(x=>x&&tenderKey(x)===id?{...x,...patch,docs:patch.docs?{...(x.docs||{}),...patch.docs}:x.docs}:x);
      return true;
    }
    catch(err){reportError(err);return false;}
  };

  async function add(e){
    e.preventDefault();
    if(!canManageTenders||isFailedPage){setNotice('Жаңы тендерди аткаруучунун бөлүмүнөн кошуңуз');return;}
    if(busy)return;
    const f=new FormData(e.currentTarget);

    let t={
      id:String(f.get('id')).trim(),
      org:String(f.get('org')).trim(),
      name:String(f.get('name')).trim(),
      executor:String(f.get('executor')||'Аткаруучу').trim(),
      partnerCompany:String(f.get('partnerCompany')||'').trim(),
      sum:Number(f.get('sum')),
      paid:0,
      gopp:String(f.get('gopp')||'').trim(),
      goik:String(f.get('goik')||'').trim(),
      goppPaid:false,
      goikPaid:false,
      date:String(f.get('date')||''),
      docs:{}
    };

    // Бир эле номер (жадагалса окшош лот аталышы) кайра кошула берет: ар лот өзүнчө Firestore документи.
    if(!t.id||!t.name||!t.org||!t.executor||!t.partnerCompany){setNotice('Милдеттүү талааларды толтуруңуз');return;}
    if(!Number.isFinite(t.sum)||t.sum<0){setNotice('Сумманы туура жазыңыз');return;}
    setBusy(true);
    setAddFileError('');
    try{
      if(!user?.uid)throw new Error('Firebase аккаунтуна кириңиз');
      // Firestore өзү берген уникалдуу ID: crypto.randomUUID'ка көз каранды эмес.
      const recordId=doc(collection(db,'tenders')).id;
      // Биринчи сактоо сервер тарабынан тастыкталмайынча модал жабылбайт.
      await saveRemote(recordId,{...t,recordId,docs:{}});
      setActiveLotByTender(previous=>({...previous,[t.id]:recordId}));
      const failedFiles=[];
      for(const [index,file] of addFiles.entries()){
        const docName=`Тиркелген файл ${index+1} — ${file.name}`;
        try{
          const uploaded=await uploadToCloudinary(file,recordId,docName);
          // Бир файлды кошуу бүт тендерди кайра жазбашы керек.
          await updateDoc(doc(db,'tenders',recordId),new FieldPath('docs',docName),uploaded);
        }catch(fileError){
          console.error('Файл жүктөө катасы:',fileError);
          failedFiles.push(file.name);
        }
      }
      setAddOpen(false);
      setAddFiles([]);
      if(failedFiles.length){
        setNotice("Тендер Firebase'ге сакталды, бирок айрым файлдар жүктөлгөн жок");
        window.alert("Тендер Firebase Firestore'го сакталды. Жүктөлбөгөн файлдар: "+failedFiles.join(', '));
      }else{
        setNotice("Тендер Firebase'ге сакталды"+(addFiles.length?' (файлдары менен)':''));
      }
    }catch(err){
      const hint=err?.code==='permission-denied'
        ?'Firestore эрежелери бул аккаунтка жазууга уруксат берген жок.'
        :err?.code==='unavailable'
          ?'Firebase жеткиликсиз. Интернетти текшерип кайра аракет кылыңыз.'
          :err?.message||String(err);
      setAddFileError('Тендер Firebase\'ге сакталган жок: '+hint);
      reportError(err);
    }
    finally{setBusy(false)}
  }

  const startPayment=t=>{
    setPaymentEditId(tenderKey(t));
    setPaymentValue(
      t.paid>0
        ?String(t.paid)
        :''
    );
  };

  const savePayment=async t=>{
    let value=Number(paymentValue||0);
    if(value<0)value=0;
    if(value>Number(t.sum))value=Number(t.sum);

    const ok=await update(tenderKey(t),{paid:value});
    if(ok){setPaymentEditId(null);setPaymentValue('');}
    return ok;
  };

  const startEdit=t=>{
    setPaymentEditId(null);
    setEditingId(tenderKey(t));
    setEditDraft({
      id:t.id,
      org:t.org,
      name:t.name,
      executor:t.executor||'',
      partnerCompany:t.partnerCompany||'',
      sum:t.sum,
      paid:t.paid||0,
      gopp:t.gopp||'',
      goik:t.goik||'',
      date:t.date||''
    });
  };

  const changeEdit=(key,value)=>{
    setEditDraft(d=>({
      ...d,
      [key]:value
    }));
  };

  const saveEdit=async oldId=>{
    if(!editDraft)return;
    if(!canManageTenders){setNotice('Тендерди өзгөртүү аткаруучу бөлүмүндө гана мүмкүн');return;}

    const oldTender=tenders.find(t=>tenderKey(t)===oldId);
    if(!oldTender)return;
    if((oldTender.executor||'Аткаруучу көрсөтүлгөн эмес')!==selectedExecutor){setNotice('Башка аткаруучунун тендерин бул жерден өзгөртүүгө болбойт');return;}
    if(isNotHeld(oldTender)){setNotice('Токтотулган тендерди оңдоого болбойт');return;}

    const newId=String(editDraft.id||'').trim();
    const newSum=Math.max(0,Number(editDraft.sum)||0);
    let newPaid=Math.max(0,Number(editDraft.paid)||0);
    if(newPaid>newSum)newPaid=newSum;

    const newTender={
      ...oldTender,
      ...editDraft,
      id:newId,
      org:String(editDraft.org||'').trim(),
      name:String(editDraft.name||'').trim(),
      executor:String(editDraft.executor||'').trim(),
      partnerCompany:String(editDraft.partnerCompany||'').trim(),
      sum:newSum,
      paid:newPaid,
      gopp:String(editDraft.gopp||'').trim(),
      goik:String(editDraft.goik||'').trim(),
      date:editDraft.date||''
    };

    if(!newTender.gopp)newTender.goppPaid=false;
    if(!newTender.goik)newTender.goikPaid=false;

    if(!newId||!newTender.name||!newTender.org||!newTender.executor){setNotice('Милдеттүү талааларды толтуруңуз');return;}
    setBusy(true);
    try{
      const {id,org,name,executor,partnerCompany,sum,paid,gopp,goik,date}=newTender;
      const fields={id,org,name,executor,partnerCompany,sum,paid,gopp,goik,date};
      if(typeof newTender.goppPaid==='boolean')fields.goppPaid=newTender.goppPaid;
      if(typeof newTender.goikPaid==='boolean')fields.goikPaid=newTender.goikPaid;
      await patchRemote(oldId,fields);
      setEditingId(null);setEditDraft(null);setMobileEditOpen(false);setNotice('Өзгөртүүлөр сакталды');
    }catch(err){reportError(err)}finally{setBusy(false)}
  };

  const logout=async()=>{
    await signOut(auth);
    setAuthMode('login');
    setSelectedCompany(null);
    setAuthError('');
  };

  // Файл терезеси ачылып турганда да Firebase'тин акыркы версиясын көрсөтүү.
  const currentActive=active&&(tenders.find(item=>tenderKey(item)===tenderKey(active))||active);

  if(!authReady){
    return(
      <div className="authScreen">
        <div className="authLoading">Тендер База жүктөлүүдө...</div>
      </div>
    );
  }

  if(resetMode){return <ResetPinPage verified={resetVerified} email={resetEmail} error={authError} busy={authBusy} save={saveReset}/>;}

  if(!user){
    return(
      <CompanyAuth
        companies={companies}
        mode={authMode}
        setMode={setAuthMode}
        selected={selectedCompany}
        setSelected={company=>{
          setSelectedCompany(company);
          setAuthError('');
        }}
        error={authError}
        busy={authBusy}
        createAccount={createAccount}
        login={login}
        resetPassword={resetPassword}
      />
    );
  }

  // ТАБЛИЦА СТАКТАЛГАН ТОЛУК СТИЛЬ КОЛОНКАЛАРЫ
const tableGridStyle = {
  display: 'grid',
  gridTemplateColumns: '34px 32px minmax(177px,1.65fr) minmax(90px,1fr) minmax(115px,1.25fr) minmax(112px,1.05fr) minmax(110px,1.1fr) 90px 80px 105px 108px 72px 55px',
  alignItems: 'center',
  columnGap: 0,
  width: '100%',
  minWidth: '1275px',
  boxSizing: 'border-box'
};
  return(
    <div className="shell">
      {notice&&<div className={'tfToast'+(notice==='Номер скопирован'?' tfToastCopied':'')} role="alert">{notice==='Номер скопирован'&&<CheckCircle2 size={20}/>}<span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Жабуу"><X size={16}/></button></div>}
      {copyTip&&createPortal(<div className="tfCopyFloatingTip" role="tooltip" style={{left:copyTip.left,top:copyTip.top}}><Copy size={12}/> Скопировать</div>,document.body)}

      <div className="mobileTopbar">
        <div className="mobileTopbarBrand"><span className="mobileTopbarLogo">ТБ</span><strong>Тендер База</strong></div>
        <button type="button" className={"mobileMenuTrigger tfHamburger "+(mobileNavOpen?"isOpen":"")} aria-label={mobileNavOpen?"Менюну жабуу":"Менюну ачуу"} aria-expanded={mobileNavOpen} onClick={()=>setMobileNavOpen(v=>!v)}><i/><i/><i/></button>
      </div>
      {mobileNavOpen && <button type="button" className="mobileNavBackdrop" aria-label="Менюну жабуу" onClick={()=>setMobileNavOpen(false)}/>}
      <aside className={mobileNavOpen ? "mobileNavOpen" : ""}>

        <div className="brand">
          
          <div className="logo">ТБ</div>
          <div>
            <b>Тендер База</b>
            <small>ТЕНДЕРЛЕР БАЗАСЫ</small>
          </div>
        </div>

        <nav>
          <a
            className={page==='tenders' && !selectedExecutor ?'on':''}
            onClick={()=>{
              setPage('tenders');
              setSelectedExecutor(null);
              setQ('');
              setGuaranteeFilter(null);
              setSelectedIds([]);
              setTableSearchOpen(false);
              setMobileNavOpen(false);
            }}
          >
            <LayoutDashboard/>
            Тендерлер
          </a>

          <a
            className={page==='not-held'?'on failedNavActive':''}
            onClick={()=>{
              setPage('not-held');
              setSelectedExecutor(null);
              setSelectedIds([]);
              setQ('');
              setGuaranteeFilter(null);
              setTableSearchOpen(false);
              setMobileNavOpen(false);
            }}
          >
            <X/>
            Не состоялся
            <span className="failedNavCount">{tenders.filter(isNotHeld).length}</span>
          </a>

          <div className="navAccordionSection" style={{marginTop:'8px',paddingLeft:'8px',paddingRight:'8px'}}>
            <div style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:'700',marginBottom:'6px',letterSpacing:'0.5px'}}>
              АТКАРУУЧУЛАР
            </div>
            <label className="executorSearch"><Search size={15}/><input aria-label="Аткаруучуларды издөө" placeholder="Аткаруучуну издөө…" value={executorQuery} onChange={e=>setExecutorQuery(e.target.value)}/></label>
            <div className="executorScrollable" aria-label="Аткаруучулардын тизмеси">
            {!Object.keys(sidebarExecutorsGroup).some(name=>matches(name,executorQuery))&&<p className="searchEmpty">Аткаруучу табылган жок</p>}
            {Object.entries(sidebarExecutorsGroup).filter(([name])=>matches(name,executorQuery)).map(([execName, execTenders])=>{
              const isSelected=selectedExecutor===execName;

              return(
                <div key={execName} style={{marginBottom:'4px'}}>
                  <button
                    type="button"
                    onClick={()=>{
                      setSelectedExecutor(execName);
                      // «Не состоялся» ичинен тандаса, аткаруучунун токтотулган лоттору ачылат.
                      setPage(page==='not-held'?'not-held':'tenders');
                      setQ('');
                      setGuaranteeFilter(null);
                      setSelectedIds([]);
                      setMobileNavOpen(false);
                    }}
                    aria-pressed={isSelected}
                    style={{
                      width:'100%',
                      background:isSelected?'rgba(255,255,255,0.12)':'transparent',
                      border:'none',
                      color:'var(--text-main)',
                      display:'flex',
                      alignItems:'center',
                      justifyContent:'space-between',
                      padding:'8px 10px',
                      borderRadius:'6px',
                      cursor:'pointer',
                      fontSize:'13px',
                      fontWeight:isSelected?'700':'500',
                      textAlign:'left'
                    }}
                  >
                    <span style={{display:'flex',alignItems:'center',gap:'6px'}}>
                      <User size={13}/> {execName}
                    </span>
                    <span className="executorNavCount">{execTenders.length}</span>
                  </button>
                </div>
              );
            })}
            </div>
          </div>

          <a
            className={page==='files'?'on':''}
            onClick={()=>{
              setPage('files');
              setSelectedExecutor(null);
              setMobileNavOpen(false);
            }}
            style={{marginTop:'8px'}}
          >
            <FileText/>
            Файлдар
          </a>

          <a
            className={page==='settings'?'on':''}
            onClick={()=>{
              setPage('settings');
              setSelectedExecutor(null);
              setMobileNavOpen(false);
            }}
          >
            <Settings/>
            Настройки
          </a>
          <a
            href="https://tovarkg.vercel.app/"
            onClick={()=>setMobileNavOpen(false)}
          >
            <Search/>
            Товар издөө
          </a>
        </nav>

        <div className="navbottom">
          <button type="button" className="sidebarLogoutOnly" onClick={()=>{setMobileNavOpen(false);setLogoutConfirm(true);}}>
            <LogOut size={18}/>
            Выйти
          </button>
        </div>
      </aside>

      {deleteConfirmOpen&&canManageTenders&&(
        <div className="deleteConfirmShade" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setDeleteConfirmOpen(false)}}>
          <div className="deleteConfirmDialog tenderActionDialog" role="dialog" aria-modal="true" aria-labelledby="deleteConfirmTitle">
            <button type="button" className="deleteConfirmClose" disabled={busy} onClick={()=>setDeleteConfirmOpen(false)} aria-label="Жабуу"><X size={17}/></button>
            <div className="deleteConfirmIcon"><Trash2 size={23}/></div>
            <small>ӨЧҮРҮҮНҮ ЫРАСТОО</small>
            <h2 id="deleteConfirmTitle">{selectedIds.length} тендерди өчүрөсүзбү?</h2>
            <p>Тандалган тендерлер биротоло өчүрүлөт. Бул аракетти артка кайтаруу мүмкүн эмес.</p>
            <div className="deleteConfirmActions">
              <button type="button" className="deleteCancelBtn" disabled={busy} onClick={()=>setDeleteConfirmOpen(false)}>Артка</button>
              <button type="button" className="deleteApproveBtn" disabled={busy} onClick={confirmDeleteSelected}><Trash2 size={16}/>{busy?'Өчүрүлүүдө...':'Ооба, өчүрүү'}</button>
            </div>
          </div>
        </div>
      )}

      {logoutConfirm&&<div className="logoutShade" onMouseDown={e=>{if(e.target===e.currentTarget)setLogoutConfirm(false)}}>
        <div className="logoutDialog" role="dialog" aria-modal="true" aria-labelledby="logoutTitle">
          <div className="logoutDialogIcon"><User size={22}/></div>
          <h2 id="logoutTitle">Аккаунттан чыгасызбы?</h2>
          <p>Кайра кирүү үчүн паролуңузду гана жазасыз.</p>
          <div className="logoutDialogActions">
            <button type="button" onClick={()=>setLogoutConfirm(false)}>Жок, калам</button>
            <button type="button" className="logoutConfirmButton" onClick={async()=>{setLogoutConfirm(false);await logout()}}>Ооба, чыгуу</button>
          </div>
        </div>
      </div>}
      <main>
        {syncState!=='connected'&&<div className={'tfFirebaseStatus tfFirebaseStatus-'+syncState} role={syncState==='loading'?'status':'alert'}>
          <Briefcase size={19}/>
          <div>
            <strong>{syncState==='loading'?'Firebase серверинен маалымат текшерилүүдө…':syncState==='empty'?'Firebase сервери 0 документ кайтарды':'Firebase маалыматтарын окуу катасы'}</strong>
            <p>{syncState==='loading'
              ?`Долбоор: ${firebaseProjectId} · tenders коллекциясы. Сервердин жообун күтүп жатабыз.`
              :syncState==='empty'
                ?`Долбоор: ${firebaseProjectId} · tenders коллекциясында сервер боюнча 0 документ бар. Бул эски тендерлер өчүрүлдү дегенди билдирбейт: туура Firebase долбоору/базасы тандалганын текшериңиз.`
                :`${syncError} (Долбоор: ${firebaseProjectId})`}</p>
          </div>
          <button type="button" onClick={()=>setSyncRetry(previous=>previous+1)}>Кайра текшерүү</button>
        </div>}
        {(page==='tenders'||page==='not-held') ? (
          <>
            <header className="tenderTopbar">
              <h1>{isFailedPage?'Тендер не состоялся':isGeneralPage?<>Тендерлерди <em>оңой башкарыңыз.</em></>:<>{selectedExecutor} — <em>тендерлерди башкаруу.</em></>}</h1>
              {canManageTenders&&!isFailedPage&&<div className="actions"><button
                  className="primary"
                  onClick={()=>setAddOpen(true)}
                >
                  <Plus/>
                  Тендер кошуу
                </button></div>}
            </header>

            <section className="stats">
              <Stat
                icon={<Briefcase/>}
                label={selectedExecutor?'Аткаруучунун тендерлери':'Тендерлер'}
                value={syncState==='loading'&&tenders.length===0?'…':scopeTenderCount}
              />
              <Stat
                icon={<Wallet/>}
                label={selectedExecutor?'Аткаруучунун жалпы суммасы':'Жалпы сумма'}
                value={syncState==='loading'&&tenders.length===0?'Жүктөлүүдө…':money(displayedTotal)}
              />
              <GuaranteeStat
                kind="gopp"
                icon={<PackageCheck/>}
                tenders={scopeTenders}
                activeFilter={guaranteeFilter}
                onSelect={chooseGuaranteeFilter}
              />
              <GuaranteeStat
                kind="goik"
                icon={<CheckCircle2/>}
                tenders={scopeTenders}
                activeFilter={guaranteeFilter}
                onSelect={chooseGuaranteeFilter}
              />
              <Stat
                icon={<FileText/>}
                label="Файлдар"
                value={
                  scopeTenders.reduce(
                    (a,t)=>a+Object.keys(t.docs||{}).length,
                    0
                  )
                }
              />
            </section>

            <div className="panel tablePanel">
              <div className="panelhead" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <small>{isFailedPage?'НЕ СОСТОЯЛСЯ ТЕНДЕРЛЕР':isGeneralPage?'БАРДЫК ТЕНДЕРЛЕР — КӨРҮҮ ГАНА':'АТКАРУУЧУНУН ТЕНДЕРЛЕРИ'}</small>
                  <div className="tableTitleRow">
                    <h2>{isFailedPage?'Не состоялся':'Таблица'}{headerExecutorTitle ? ` — ${headerExecutorTitle}` : ''}</h2>
                    <div ref={tableSearchContainerRef} className={'tableHeaderSearch'+(tableSearchOpen?' expanded':'')}>
                      {tableSearchOpen&&<Search className="tfSearchInsideIcon" size={17} aria-hidden="true"/>}
                      <button type="button" className="tableSearchToggle" aria-expanded={tableSearchOpen} aria-controls="tender-table-search" aria-label={tableSearchOpen?'Издөөнү жабуу':'Таблицадан издөө'} title={tableSearchOpen?'Издөөнү жабуу':'Поиск'} onClick={()=>{setTableSearchOpen(open=>!open);if(tableSearchOpen)setQ('');}}>
                        {tableSearchOpen?<X size={15}/>:<Search size={16}/>}
                      </button>
                      <div className="tableHeaderSearchField">
                        <input id="tender-table-search" ref={tableSearchInputRef} aria-label="Тендер издөө" tabIndex={tableSearchOpen?0:-1} value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){setTableSearchOpen(false);setQ('')}}} placeholder="Номер, мекеме, товар..."/>
                      </div>
                    </div>
              {guaranteeFilter&&<button type="button" className="guaranteeClearFilter" onClick={()=>chooseGuaranteeFilter(guaranteeFilter.kind,guaranteeFilter.status)}>
                {guaranteeLabel(guaranteeFilter.kind)} — {guaranteeFilter.status==='paid'?'Төлөнгөн':'Төлөнө элек'} <X size={14}/>
              </button>}
              {selectedExecutorsSet.length===1 && (
                <div className="selectedExecutorSingle">
                  <User size={16}/>
                  <span>Аткаруучу: <strong>{selectedExecutorsSet[0]}</strong></span>
                  <span className="selectedExecutorCount">{selectedTenders.length} тендер</span>
                </div>
              )}
              {selectedExecutorsSet.length>1 && (
                <div className="selectedExecutorsAccordion">
                  <button type="button" className="selectedExecutorsToggle"
                    aria-expanded={executorsExpanded}
                    onClick={()=>setExecutorsExpanded(v=>!v)}>
                    <span><User size={16}/> Аткаруучулар <b>{selectedExecutorsSet.length}</b></span>
                    {executorsExpanded?<ChevronDown size={17}/>:<ChevronRight size={17}/>}
                  </button>
                  {executorsExpanded && <div className="selectedExecutorsList" role="region" aria-label="Тандалган аткаруучулар">
                    <div className="executorMenuTop">
                      <span>Тандалган аткаруучулар</span>
                      <span className="executorMenuCount">{selectedExecutorsSet.length}</span>
                    </div>
                    <div className="executorMenuBody">
                      {selectedExecutorsSet.map(execName=>{
                        const items=selectedTenders.filter(t=>(t.executor||'Аткаруучу көрсөтүлгөн эмес')===execName);
                        const isOpen=!!openAccordionMap[execName];
                        return <div className={'selectedExecutorGroup'+(isOpen?' isOpen':'')} key={execName}>
                          <button type="button" className="executorGroupButton" aria-expanded={isOpen} onClick={()=>setOpenAccordionMap(prev=>({...prev,[execName]:!prev[execName]}))}>
                            <span className="executorGroupAvatar"><User size={16}/></span>
                            <span className="executorGroupLabel"><strong title={execName}>{execName}</strong><small>{items.length} тендер</small></span>
                            <ChevronDown className="executorGroupChevron" size={17}/>
                          </button>
                          {isOpen&&<div className="selectedExecutorItems">{items.map(t=><div className="executorTenderItem" key={tenderKey(t)}>
                            <span className="executorTenderDetails"><span className="executorTenderNumber">№ {t.id}</span><span className="executorTenderName" title={t.name}>{t.name}</span></span>
                            <strong className="executorTenderAmount">{money(t.sum)}</strong>
                          </div>)}</div>}
                        </div>;
                      })}
                    </div>
                  </div>}
                </div>
              )}

                  </div>
                </div>

                <div className="tenderBulkActions">
                  {canManageTenders&&selectedIds.length>0 && <>
                    <button type="button" className="tenderBulkDelete" disabled={busy} onClick={deleteSelected}>
                      <Trash2 size={15}/> Өчүрүү ({selectedIds.length})
                    </button>
                    {selectedTenders.some(t=>!isNotHeld(t))&&(
                      <button type="button" className="tenderBulkNotHeld" disabled={busy} onClick={markNotHeld}>
                        <X size={15}/> {busy?'Сакталууда...':'Тендер не состоялся'}
                      </button>
                    )}
                    {selectedTenders.some(isNotHeld)&&(
                      <button type="button" className="tenderBulkRestore" disabled={busy} onClick={restoreTenders}>
                        <CheckCircle2 size={15}/> Кайра активдештирүү
                      </button>
                    )}
                  </>}
                  <span className="count">{displayFiltered.length}</span>
                </div>
              </div>

              {!selectedExecutor&&<div className="tfSharedViewSummary" role="status">
                <span><Briefcase size={15}/> Firebase: <strong>{syncState==='loading'&&tenders.length===0?'Жүктөлүүдө…':`${tenders.length} лот`}</strong></span>
                <span>Бул бөлүмдө: <strong>{scopeTenders.length} лот</strong></span>
                <span>Таблицада: <strong>{displayGroups.length} сап</strong> (бирдей номерлер бириккен)</span>
                <span className="tfReadonlyBadge"><CheckCircle2 size={14}/> Көрүү гана</span>
              </div>}

              <div className="tfMobileTenderList">
                {displayGroups.map(({t,lots,groupKey,totalSum,totalPaid})=>{
                  const key=tenderKey(t);
                  const paid=totalPaid;
                  const status=(kind)=>{
                    const val=t[kind];
                    const state=t[kind+'Status'];
                    return state==='returned'?'Кайтарылды':state==='waiting'?'Күтүлүүдө':state==='unpaid'?'Төлөнө элек':state==='paid'||(!state&&t[kind+'Paid'])?'Төлөндү':Number(String(val||'').replace(/\s/g,''))>0?'Төлөнө элек':'Жок';
                  };
                  const failed=isNotHeld(t);
                  return <article className={'tfMobileTenderCard'+(failed?' tfTenderFailed':'')} key={groupKey}>
                    <div className="tfCardHead">
                      {canManageTenders&&<input type="checkbox" className="tfCardSelect" aria-label={`Тендер ${t.id} тандоо`} checked={lots.every(item=>selectedIds.includes(tenderKey(item)))} onChange={()=>toggleGroupSelect(lots)}/>}
                      <button type="button" className="tfCardNumber tfTenderCopy" aria-label={`Скопировать тендер № ${t.id}`} onMouseEnter={showCopyTip} onMouseLeave={()=>setCopyTip(null)} onFocus={showCopyTip} onBlur={()=>setCopyTip(null)} onClick={()=>{setCopyTip(null);copyTenderNumber(t.id)}}><FileText size={15}/> <span>Тендер №: {t.id}</span></button>
                      <span className="tfCardDate">{t.date||'—'}</span>
                      {canManageTenders&&<button type="button" className="tfCardEdit" aria-label="Тендерди оңдоо" disabled={failed} onClick={()=>{startEdit(t);setMobileEditOpen(true);}}><Pencil size={16}/></button>}
                    </div>
                    {failed&&<span className="tfFailedBadge">Тендер не состоялся</span>}
                    <div className="tfCardInfo org"><small>КОМПАНИЯ:</small><strong>{t.partnerCompany||'—'}</strong></div>
                    <div className="tfCardInfo org"><small>МЕКЕМЕ:</small><strong>{t.org}</strong></div>
                    <div className="tfCardInfo lot"><small>ЛОТ АТАЛЫШЫ:</small>{lots.length>1?<LotAccordion lots={lots} activeLot={t} open={openLotTender===groupKey} onToggle={()=>toggleLotMenu(groupKey)} onSelect={recordId=>selectLot(groupKey,recordId)}/>:<strong>{t.name}</strong>}</div>
                    <div className="tfCardAmounts"><div><small>Бюджет (жалпы сумма):</small><strong>{money(totalSum)}</strong>{lots.length>1&&<small>{lots.length} лоттун суммасы</small>}</div><div role={canManageTenders&&!failed?'button':undefined} tabIndex={canManageTenders&&!failed?0:undefined} className={failed?'tfFailedInactive':''} onClick={()=>{if(canManageTenders&&!failed){startPayment(t);setMobilePaymentTender(t)}}} onKeyDown={e=>{if(canManageTenders&&!failed&&e.key==='Enter'){startPayment(t);setMobilePaymentTender(t)}}}><small>Төлөнгөн сумма: {canManageTenders&&!failed?'✎':''}</small><strong className={paid>0?'positive':'negative'}>{paid>0?'✓ ':'× '}{money(paid)}</strong>{canManageTenders&&lots.length>1&&<small>Оңдоо: тандалган лот</small>}</div></div>
                    <div className="tfCardGuarantees">{['gopp','goik'].map(kind=>{
                      const cls='tfCardGuarantee '+(status(kind)==='Төлөндү'?'blue':status(kind)==='Кайтарылды'?'green':status(kind)==='Күтүлүүдө'?'yellow':status(kind)==='Жок'?'gray':'red');
                      const label=status(kind)+(t[kind]?' · '+t[kind]+' сом':'');
                      return <div key={kind}><small>{guaranteeLabel(kind)}:</small>{canManageGuaranteesAndFiles?<button type="button" className={cls} onClick={()=>setPayStatusModal({t,type:kind})}>{label}</button>:<span className={cls+' tfReadonlyPill'}>{label}</span>}</div>;
                    })}</div>
                    <div className="tfCardPrice"><span>Таблица цен:</span><b className={hasPriceTable(t.docs)?'attached':'missing'}>{hasPriceTable(t.docs)?'✓ Тиркелген':'Жок'}</b></div>
                    <button type="button" className="tfCardFiles" onClick={()=>{setActive(t);setDocsOpen(true)}}><FolderOpen size={16}/> Файлдар <span><Paperclip size={13}/> {Object.keys(t.docs||{}).length} файл</span></button>
                  </article>;
                })}
              </div>

              {/* ТАБЛИЦА */}
            {/* ТАБЛИЦА БӨЛҮГҮ */}
<div className="bigTable">
  {/* ШАПКАСЫ */}
  <div className="row head" style={tableGridStyle}>
    <span style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
      {canManageTenders&&<input
        type="checkbox"
        checked={displayGroups.length>0 && displayGroups.every(group=>group.lots.every(t=>selectedIds.includes(tenderKey(t))))}
        onChange={toggleSelectAll}
        title="Тандоону тазалоо"
        style={{cursor:'pointer',width:'14px',height:'14px'}}
      />}
    </span>
    <span>№</span>
    <span>ТЕНДЕР НОМЕР</span>
    <span>МЕКЕМЕЛЕР</span>
    <span>LOT АТАЛЫШЫ</span>
    <span>СУММАСЫ</span>
    <span>ТӨЛӨНГӨН СУММАЛАР</span>
    <span>ГОПП</span>
    <span>ГОИК</span>
    <span>ТАБЛИЦА ЦЕН</span>
    <span>СРОК ВСКРЫТИЯ</span>
    <span>ФАЙЛДАР</span>
    <span style={{textAlign:'center'}}>{canManageTenders?'ОҢДОО':''}</span>
  </div>

  {/* СТРОКАЛАРЫ */}
  {displayGroups.map(({t,lots,groupKey,totalSum,totalPaid},i)=>{
    const editing=canManageTenders&&editingId===tenderKey(t);
    const paymentEditing=canManageTenders&&paymentEditId===tenderKey(t);
    const isChecked=lots.every(item=>selectedIds.includes(tenderKey(item)));
    const failed=isNotHeld(t);

    return(
      <div
        className={'row '+(editing?'editingRow':'')+(failed?' tfTenderFailed':'')}
        key={groupKey}
        style={tableGridStyle}
      >
        {/* ЧЕКБОКС */}
        <span style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
          {canManageTenders&&<input
            type="checkbox"
            checked={isChecked}
            onChange={()=>toggleGroupSelect(lots)}
            style={{cursor:'pointer',width:'14px',height:'14px'}}
          />}
        </span>

        <span>{i+1}</span>

        {/* ТЕНДЕР НОМЕР */}
        <span className="tfTenderCompanyCell">
          {editing ? (
            <span className="tfTenderCompanyStack">
              <input className="tableInput" aria-label="Тендер номери" value={editDraft.id} onChange={e=>changeEdit('id',e.target.value)}/>
              <input className="tableInput" aria-label="Кайсы компания менен аткарды" placeholder="Компаниянын аты" value={editDraft.partnerCompany||''} onChange={e=>changeEdit('partnerCompany',e.target.value)}/>
            </span>
          ):(
            <span className="tfTenderCompanyStack">
              <button type="button" className="tenderLink tfTenderCopy" aria-label={`Скопировать тендер № ${t.id}`} onMouseEnter={showCopyTip} onMouseLeave={()=>setCopyTip(null)} onFocus={showCopyTip} onBlur={()=>setCopyTip(null)} onClick={()=>{setCopyTip(null);copyTenderNumber(t.id)}}>{t.id}<Copy className="tfCopyInlineIcon" size={14} aria-hidden="true"/>{failed&&<small className="tfFailedBadge">Не состоялся</small>}</button>
              <span className="tfTenderCompanyName" title={t.partnerCompany||'Компания көрсөтүлгөн эмес'}><Building2 size={12} aria-hidden="true"/>{t.partnerCompany||'Компания көрсөтүлгөн эмес'}</span>
            </span>
          )}
        </span>

        {/* МЕКЕМЕ */}
        <span className="orgCell" title={t.org||''}>
          {editing ? (
            <input
              className="tableInput"
              value={editDraft.org}
              onChange={e=>changeEdit('org',e.target.value)}
            />
          ):(
            t.org
          )}
        </span>

        {/* LOT АТАЛЫШЫ */}
        <span className="lotCell" title={t.name||''} style={{fontWeight:'500'}}>
          {editing ? (
            <input
              className="tableInput"
              value={editDraft.name}
              onChange={e=>changeEdit('name',e.target.value)}
            />
          ):(lots.length>1 ? (
            <LotAccordion lots={lots} activeLot={t} open={openLotTender===groupKey} onToggle={()=>toggleLotMenu(groupKey)} onSelect={recordId=>selectLot(groupKey,recordId)}/>
          ) : t.name)}
        </span>

        {/* ЖАЛПЫ СУММА */}
        <span style={{fontWeight:'700'}}>
          {editing ? (
            <div className="tfGroupAmount"><input className="tableInput" type="number" min="0" value={editDraft.sum} onChange={e=>changeEdit('sum',e.target.value)}/>{lots.length>1&&<small>Тандалган лотту оңдоо</small>}</div>
          ):(
            <div className="tfGroupAmount"><strong>{money(totalSum)}</strong>{lots.length>1&&<small>{lots.length} лоттун жалпы суммасы</small>}</div>
          )}
        </span>

        {/* ТӨЛӨНГӨН СУММА */}
        <span>
          {editing ? (
            <input
              className="tableInput"
              type="number"
              min="0"
              max={editDraft.sum}
              value={editDraft.paid}
              onChange={e=>changeEdit('paid',e.target.value)}
            />
          ):failed?(
            <span className="paidAmount red tfFailedInactive tfReadonlyPill">Жеткиликсиз</span>
          ):paymentEditing ? (
            <div className="paymentEditor">
              <input
                type="number"
                min="0"
                max={t.sum}
                autoFocus
                value={paymentValue}
                onChange={e=>setPaymentValue(e.target.value)}
                onKeyDown={e=>{
                  if(e.key==='Enter')savePayment(t);
                  if(e.key==='Escape')setPaymentEditId(null);
                }}
              />
              <button
                className="paymentSave"
                title="Сохранить"
                onClick={()=>savePayment(t)}
              >
                <Save size={13}/>
              </button>
            </div>
          ):(
            <PaidAmount
              t={lots.length>1?{...t,paid:totalPaid,sum:totalSum}:t}
              onClick={()=>startPayment(t)}
              readOnly={!canManageTenders||failed}
            />
          )}
        </span>

        {/* ГОПП */}
        <span>
          {editing ? (
            <input
              className="tableInput"
              value={editDraft.gopp}
              placeholder="Жок"
              onChange={e=>changeEdit('gopp',e.target.value)}
            />
          ):(
            <PayPill
              t={t}
              type="gopp"
              openStatus={()=>setPayStatusModal({t,type:'gopp'})}
              readOnly={!canManageGuaranteesAndFiles}
            />
          )}
        </span>

        {/* ГОИК */}
        <span>
          {editing ? (
            <input
              className="tableInput"
              value={editDraft.goik}
              placeholder="Жок"
              onChange={e=>changeEdit('goik',e.target.value)}
            />
          ):(
            <PayPill
              t={t}
              type="goik"
              openStatus={()=>setPayStatusModal({t,type:'goik'})}
              readOnly={!canManageGuaranteesAndFiles}
            />
          )}
        </span>

        {/* ТАБЛИЦА ЦЕН */}
        <span>
          <b
            className={
              failed?'pill red tfFailedInactive':hasPriceTable(t.docs)
                ?'pill green'
                :'pill gray'
            }
          >
            {failed?'Токтотулган':hasPriceTable(t.docs)?'✓ Тиркелген':'Жок'}
          </b>
        </span>

        {/* СРОК */}
        <span style={{whiteSpace:'nowrap',fontSize:'12px',color:'#475569'}}>
          {editing ? (
            <input
              className="tableInput"
              type="date"
              value={editDraft.date}
              onChange={e=>changeEdit('date',e.target.value)}
            />
          ):(
            niceDate(t.date)
          )}
        </span>

        {/* ФАЙЛДАР */}
        <span>
          <button
            className="filesBtn"
            onClick={()=>{
              setActive(t);
              setDocsOpen(true);
            }}
          >
            <FolderOpen size={13}/>
            ({Object.keys(t.docs||{}).length})
          </button>
        </span>

        {/* КАРАНДАШ / SAVE */}
        <span style={{display:'flex',justifyContent:'center',alignItems:'center'}}>
          {!canManageTenders?null:editing ? (
            <button
              className="rowSaveBtn"
              title="Сохранить"
              onClick={()=>saveEdit(tenderKey(t))}
            >
              <Save size={14}/>
            </button>
          ):(
            <button
              className="editBtn"
              disabled={failed}
              title="Изменить"
              onClick={()=>startEdit(t)}
            >
              <Pencil size={14}/>
            </button>
          )}
        </span>
      </div>
    );
  })}
</div>
            </div>
          </>
        ) : page==='files' ? (
          <FilesPage
            tenders={tenders}
            openDocs={t=>{
              setActive(t);
              setDocsOpen(true);
            }}
          />
        ) : (
          <SettingsPage
            user={user}
            company={currentCompany}
            executors={Object.entries(executorsGroup).filter(([name])=>name!=='Аткаруучу көрсөтүлгөн эмес')}
            busy={busy}
            updateCompanyName={updateCompanyName}
            changeAccountPassword={changeAccountPassword}
            manageExecutor={manageExecutor}
            sendReset={async()=>{
              try{await sendPasswordResetEmail(auth,user.email);setNotice('Пароль алмаштыруу шилтемеси email дарегине жөнөтүлдү');}
              catch(err){reportError(err)}
            }}
            logout={()=>setLogoutConfirm(true)}
          />
        )}
      </main>

      {/* ТЕНДЕР КОШУУ МОДАЛКАСЫ */}
      {addOpen&&canManageTenders&&
        <Modal close={()=>{if(!busy){setAddOpen(false);setAddFiles([]);setAddFileError('');}}}>
          <form onSubmit={add}>
            <small>ЖАҢЫ ТЕНДЕР</small>
            <h2>Тендер кошуу</h2>

            <div className="fields">
              <label>
                Тендер номер *
                <input name="id" required placeholder="Бир тендерде бир нече лот болушу мүмкүн"/>
              </label>

              <label>
                Организация *
                <input name="org" required/>
              </label>

              <label>
                Ким аткарды (Аткаруучу) *
                <input name="executor" required defaultValue={selectedExecutor||''} readOnly title="Аткаруучу сол жактагы менюдан тандалды"/>
              </label>

              <label>
                Кайсы компания менен аткарды? *
                <input name="partnerCompany" required placeholder="Мисалы: Альфа Строй"/>
              </label>

              <label className="full">
                Лот № / Товардын аталышы *
                <input name="name" required/>
              </label>

              <label>
                Суммасы *
                <input name="sum" type="number" required/>
              </label>

              <label>
                Срок вскрытия *
                <input name="date" type="date" required/>
              </label>

              <label>
                ГОПП
                <em>жок болсо бош калтыр</em>
                <input name="gopp" placeholder="мисалы 15 600"/>
              </label>

              <label>
                ГОИК
                <em>жок болсо бош калтыр</em>
                <input name="goik" placeholder="мисалы 8 000"/>
              </label>
            </div>

            <div className="addFilesBox">
              <div className="addFilesTitle"><Paperclip size={17}/><strong>Файлдарды тиркөө</strong><span>Милдеттүү эмес</span></div>
              <label className="addFilesPicker">
                <Upload size={21}/>
                <span><b>Файлдарды тандоо</b><small>PDF, Word, Excel, сүрөт жана башка файлдар · 10 файлга чейин</small></span>
                <input type="file" multiple disabled={busy} onChange={e=>{
                  const picked=Array.from(e.target.files||[]);
                  const tooLarge=picked.find(f=>f.size>20*1024*1024);
                  if(tooLarge){setAddFileError('Бир файл 20 МБдан ашпашы керек: '+tooLarge.name);e.target.value='';return;}
                  setAddFiles(prev=>{
                    const next=[...prev,...picked.filter(f=>!prev.some(p=>p.name===f.name&&p.size===f.size&&p.lastModified===f.lastModified))];
                    if(next.length>10){setAddFileError('10 файлдан көп тиркөөгө болбойт');return prev;}
                    setAddFileError('');return next;
                  });
                  e.target.value='';
                }}/>
              </label>
              {addFiles.length>0&&<div className="addFilesList">{addFiles.map((file,i)=><div className="addFileRow" key={`${file.name}-${file.lastModified}-${i}`}><FileText size={15}/><span title={file.name}>{file.name}</span><small>{fileSize(file.size)}</small><button type="button" disabled={busy} aria-label="Файлды алып салуу" onClick={()=>setAddFiles(prev=>prev.filter((_,j)=>j!==i))}><X size={15}/></button></div>)}</div>}
              {addFileError&&<p className="addFileError" role="alert">{addFileError}</p>}
            </div>
            <button className="primary submit" disabled={busy}>
              <Plus/>
              {busy?'Сакталууда, күтө туруңуз…':'Тендерди кошуу'}
            </button>
          </form>
        </Modal>
      }

      {active&&docsOpen&&createPortal(
        <Documents
          t={currentActive}
          update={update}
          readOnly={!(isFailedPage&&isNotHeld(currentActive))&&(!canManageTenders||(currentActive.executor||'Аткаруучу көрсөтүлгөн эмес')!==selectedExecutor)}
          close={()=>setDocsOpen(false)}
        />, document.body
      )}

      {mobileEditOpen && canManageTenders && editDraft && (
        <Modal close={()=>{if(!busy){setMobileEditOpen(false);setEditingId(null);setEditDraft(null)}}}>
          <div className="tfMobileEditDialog">
            <small>ТЕНДЕРДИ ОҢДОО</small><h2>Тендер маалыматтары</h2>
            <form onSubmit={e=>{e.preventDefault();saveEdit(editingId)}}>
              <div className="tfMobileEditFields">
                {[['id','Тендер номери'],['partnerCompany','Кайсы компания менен аткарды'],['org','Мекеме'],['name','Лот аталышы'],['executor','Аткаруучу'],['sum','Суммасы'],['paid','Төлөнгөн сумма'],['gopp','ГОПП'],['goik','ГОИК'],['date','Срок вскрытия']].map(([field,label])=><label key={field}>{label}<input required={['id','org','name','executor'].includes(field)} type={field==='date'?'date':['sum','paid'].includes(field)?'number':'text'} min={['sum','paid'].includes(field)?'0':undefined} value={editDraft[field]??''} onChange={e=>changeEdit(field,e.target.value)}/></label>)}
              </div>
              <div className="tfMobileEditActions"><button type="button" onClick={()=>{setMobileEditOpen(false);setEditingId(null);setEditDraft(null)}}>Жок</button><button type="submit" className="primary" disabled={busy}><Save size={16}/> {busy?'Сакталууда...':'Сактоо'}</button></div>
            </form>
          </div>
        </Modal>
      )}
      {mobilePaymentTender && canManageTenders && (
        <Modal close={()=>setMobilePaymentTender(null)}>
          <div className="tfMobileEditDialog"><small>ТӨЛӨМДҮ ОҢДОО</small><h2>Төлөнгөн сумма</h2>
            <form onSubmit={async e=>{e.preventDefault();const t=tenders.find(x=>tenderKey(x)===tenderKey(mobilePaymentTender))||mobilePaymentTender;const ok=await savePayment(t);if(ok)setMobilePaymentTender(null)}}>
              <label>Сумма (сом)<input autoFocus type="number" min="0" max={mobilePaymentTender.sum} value={paymentValue} onChange={e=>setPaymentValue(e.target.value)}/></label>
              <div className="tfMobileEditActions"><button type="button" onClick={()=>setMobilePaymentTender(null)}>Жок</button><button type="submit" className="primary"><Save size={16}/> Сактоо</button></div>
            </form>
          </div>
        </Modal>
      )}
      {payStatusModal&&canManageGuaranteesAndFiles&&(
        <PaymentStatusModal
          t={tenders.find(item=>tenderKey(item)===tenderKey(payStatusModal.t))||payStatusModal.t}
          type={payStatusModal.type}
          update={update}
          close={()=>setPayStatusModal(null)}
        />
      )}
    </div>
  );
}

function LotAccordion({lots,activeLot,open,onToggle,onSelect}){
  const menuId=React.useId();
  return <div className={'tfLotPicker'+(open?' tfLotPickerOpen':'')}>
    <button type="button" className="tfLotTrigger" aria-expanded={open} aria-controls={menuId} onClick={onToggle} title="Лоттордун аталыштарын ачуу">
      <span>{activeLot.name}</span><span className="tfLotCount">{lots.length} лот</span><ChevronDown className="tfLotChevron" size={16}/>
    </button>
    {open&&<div id={menuId} className="tfLotDropdown" role="group" aria-label="Ушул номердеги лоттор">
      {lots.map((item,index)=><button type="button" key={tenderKey(item)} className={'tfLotOption'+(tenderKey(item)===tenderKey(activeLot)?' selected':'')} aria-current={tenderKey(item)===tenderKey(activeLot)?'true':undefined} onClick={()=>onSelect(tenderKey(item))}>
        <span className="tfLotOptionName"><small>Лот {index+1}{isNotHeld(item)?' · Не состоялся':''}</small><strong>{item.name}</strong></span>
        <span className="tfLotOptionAmount">{money(item.sum)}</span>
      </button>)}
    </div>}
  </div>;
}

function PinInput({name,autoFocus=false,length=8}){
  const[value,setValue]=useState('');
  const inputRef=useRef(null);

  const change=e=>{
    setValue(e.target.value.replace(/\D/g,'').slice(0,length));
  };

  return(
    <div
      className="pinInputWrap"
      onClick={()=>inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        className="pinRealInput"
        name={name}
        value={value}
        onChange={change}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={length}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      <div className="pinBoxes">
        {Array.from({length}).map((_,i)=>(
          <span
            key={i}
            className={'pinBox '+(i===value.length?'active ':'')+(value[i]?'filled':'')}
          >
            {value[i]?'•':''}
          </span>
        ))}
      </div>
    </div>
  );
}

function SecretField({name,placeholder='Пароль',autoFocus=false,minLength=6}){
  const [visible,setVisible]=useState(false);
  return <div className="tfSecret"><input name={name} type={visible?'text':'password'} placeholder={placeholder} minLength={minLength} required autoFocus={autoFocus} autoComplete={name==='password'?'current-password':'new-password'}/><button type="button" onClick={()=>setVisible(v=>!v)} aria-label={visible?'Жашыруу':'Көрсөтүү'}>{visible?'Жашыруу':'Көрсөтүү'}</button></div>;
}
function AuthFrame({children}){
  return <div className="emeraldAuth">
    <div className="emeraldBackdrop" aria-hidden="true"/><div className="emeraldArchitecture" aria-hidden="true"/>
    <div className="emeraldLayout">
      <section className="emeraldIntro">
        <div className="emeraldBrand"><div className="emeraldMonogram">ТБ</div><div><strong>Тендер<span> База</span></strong><small>ТЕНДЕРЛЕРДИ БАШКАРУУ</small></div></div>
        <div className="emeraldMessage"><h1>Бардык<br/>тендерлер<br/><em>бир жерде</em></h1><p>Документтер, аткаруучулар, төлөмдөр жана бардык тендерлерди ыңгайлуу башкарыңыз.</p>
        <div className="emeraldFeatures">
          <div><span><FileText size={23}/></span><div><b>Документтер</b><small>Жүктөө, сактоо, түзөтүү</small></div></div>
          <div><span><User size={23}/></span><div><b>Аткаруучулар</b><small>Тизме жана байланыш</small></div></div>
          <div><span><Wallet size={23}/></span><div><b>Төлөмдөр</b><small>Ыңгайлуу эсепке алуу</small></div></div>
          <div><span><CheckCircle2 size={23}/></span><div><b>Коопсуздук</b><small>Firebase менен коргоо</small></div></div>
        </div></div>
        <div className="emeraldBottom"><span className="emeraldLines"><i/><i/><i/><i/></span>Ишенимдүү система — ийгиликтүү тендерлер</div>
      </section>
      <section className="emeraldFormArea"><div className="emeraldPanel">{children}</div></section>
    </div>
  </div>;
}
function ResetPinPage({verified,email,error,busy,save}){
  return <AuthFrame><div className="emeraldTitle"><h2>Жаңы пароль</h2><p>{verified?email:'Шилтеме текшерилип жатат...'}</p></div>
    {verified&&<form className="emeraldForm" onSubmit={save}>
      <label>Жаңы пароль<SecretField name="password" placeholder="Кеминде 6 символ"/></label>
      <label>Парольду кайталоо<SecretField name="repeatPassword" placeholder="Кайра жазыңыз"/></label>
      {error&&<p className="emeraldError" role="alert">{error}</p>}
      <button className="emeraldSubmit" disabled={busy}>{busy?'Сакталууда...':'Парольду сактоо'}<ArrowRight size={19}/></button>
    </form>}{!verified&&error&&<p className="emeraldError">{error}</p>}
  </AuthFrame>;
}
function CompanyAuth({companies,mode,setMode,selected,setSelected,error,busy,createAccount,login,resetPassword}){
  // Үн эффекттери катталуу/кирүү экранына гана тиешелүү.
  // Браузер үн ойнотууга биринчи басуудан кийин гана уруксат бериши мүмкүн.
  // Үн дайыма күйүк: браузер уруксат берген биринчи аракеттен кийин ойнойт.
  // Кыймыл/басуу үнү сол кара панелдин ичинде гана иштейт.
  const waterRef=useRef(null);
  const popsRef=useRef([]);
  const lastMoveRef=useRef(0);
  const audioActivity=useRef({last:0,energy:0,unlocked:false,raf:0,previous:0});
  useEffect(()=>{
    const water=new Audio('/water.mp3');
    water.loop=true;water.preload='auto';water.volume=0;
    const pops=Array.from({length:4},()=>{const a=new Audio('/bubble-click.mp3');a.preload='auto';a.volume=.09;return a;});
    waterRef.current=water;popsRef.current=pops;
    const activity=audioActivity.current;
    let active=true;
    const tick=now=>{
      if(!active)return;
      const dt=Math.min(.08,(now-(activity.previous||now))/1000);activity.previous=now;
      if(now-activity.last>85)activity.energy*=Math.exp(-dt*7);
      const target=activity.unlocked?Math.min(.3,activity.energy*.3):0;
      water.volume=Math.max(0,Math.min(.3,water.volume+(target-water.volume)*(1-Math.exp(-dt*(target>water.volume?9:5)))));
      if(water.volume<.002&&now-activity.last>400&&!water.paused)water.pause();
      activity.raf=requestAnimationFrame(tick);
    };
    activity.raf=requestAnimationFrame(tick);
    return ()=>{active=false;cancelAnimationFrame(activity.raf);water.pause();water.src='';pops.forEach(a=>{a.pause();a.src='';});waterRef.current=null;popsRef.current=[];};
  },[]);
  const stopWater=()=>{audioActivity.current.last=0;};
  const authPointerMove=(e,distance=0)=>{
    if(e.pointerType!=='mouse' && e.pointerType!=='pen')return;
    const activity=audioActivity.current;
    const now=performance.now();
    const elapsed=Math.max(12,now-(activity.last||now-16));
    const speed=Math.min(1,Math.max(.1,distance/elapsed/1.2));
    activity.energy=Math.max(activity.energy,speed);
    activity.last=now;
    const water=waterRef.current;
    if(activity.unlocked&&water?.paused)water.play().catch(()=>{});
  };
  const authPointerDown=()=>{
    const activity=audioActivity.current;
    activity.unlocked=true;
    const sounds=popsRef.current;if(!sounds.length)return;
    const a=sounds.shift();sounds.push(a);
    a.pause();a.currentTime=0;a.volume=.09;a.play().catch(()=>{});
    const water=waterRef.current;
    if(water?.paused)water.play().catch(()=>{});
  };
  // Курсорду ээрчиген майда көбүкчөлөр — чоң шар жок.
  const visualCanvas=useRef(null);
  const bubbleMotion=useRef({x:0,y:0,tx:0,ty:0,inside:false,hasPosition:false,velocity:0,emission:0});
  useEffect(()=>{
    const canvas=visualCanvas.current;if(!canvas)return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    let w=0,h=0,dpr=1,raf=0,last=0;
    const particles=[];
    const ripples=[];
    let movementAt=0;
    // Күңүрт суу: жалтылдаган пикселдик катмар жок. Өтө жумшак,
    // үзгүлтүксүз жылган суунун майда сызыктары гана тартылат.
    const waterDisturbances=[];
    const resizeWater=()=>{};
    const drawWater=t=>{
      const time=t*.00022;
      ctx.save();
      ctx.lineWidth=.8;
      for(let line=0;line<18;line++){
        const baseY=(line+.5)*h/18;
        ctx.beginPath();
        for(let x=0;x<=w+8;x+=8){
          let influence=0;
          for(const d of waterDisturbances){
            const age=(t-d.start)/1000;
            const dist=Math.hypot(x-d.x,baseY-d.y);
            influence+=Math.sin(dist*.052-age*8)*Math.exp(-dist/135)*Math.max(0,1-age/2)*d.strength*2.2;
          }
          const y=baseY+Math.sin(x*.012+time*2+line*.63)*2.4
            +Math.sin(x*.023-time*1.35+line*.81)*1.2+influence;
          if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        }
        ctx.strokeStyle=`rgba(95,151,164,${.028+(line%4)*.004})`;
        ctx.stroke();
      }
      ctx.restore();
    };

    const random=(a,b)=>a+Math.random()*(b-a);
    const resize=()=>{const r=canvas.getBoundingClientRect();w=r.width;h=r.height;dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);resizeWater()};
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
    const spawn=(x,y,n=3,burst=false)=>{
      for(let i=0;i<n;i++){
        if(particles.length>260)particles.shift();
        const angle=random(0,Math.PI*2),speed=burst?random(.9,3.8):random(.15,1.1);
        particles.push({x:x+random(-5,5),y:y+random(-5,5),vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-(burst?.15:.35),r:random(1.2,4.7),life:1,decay:random(.006,.016),shine:Math.random(),phase:random(0,7)});
      }
    };
    const move=e=>{
      const rect=canvas.getBoundingClientRect();
      const x=e.clientX-rect.left,y=e.clientY-rect.top;
      if(x<0||y<0||x>w||y>h)return;
      const m=bubbleMotion.current;
      const distance=m.hasPosition?Math.hypot(x-m.tx,y-m.ty):0;
      if(!m.hasPosition){m.x=x;m.y=y;m.hasPosition=true;}
      m.tx=x;m.ty=y;m.inside=true;
      m.velocity=Math.max(m.velocity,Math.min(15,distance*.48));
      movementAt=performance.now();
      if(distance>3 && waterDisturbances.length<14)waterDisturbances.push({x,y,start:movementAt,strength:Math.min(1,distance/35)});
      authPointerMove(e,distance);
    };
    const leave=()=>{bubbleMotion.current.inside=false;bubbleMotion.current.velocity=0;stopWater();};
    const click=e=>{
      const rect=canvas.getBoundingClientRect();
      const x=e.clientX-rect.left,y=e.clientY-rect.top;
      const m=bubbleMotion.current;m.tx=x;m.ty=y;if(!m.hasPosition){m.x=x;m.y=y;m.hasPosition=true;}
      spawn(x,y,24,true);
      ripples.push({x,y,r:2,life:1,seed:Math.random()*1000});
      waterDisturbances.push({x,y,start:performance.now(),strength:2.5});
      authPointerDown(e);
    };
    const side=canvas.parentElement;
    side.addEventListener('pointermove',move);
    side.addEventListener('pointerleave',leave);
    side.addEventListener('pointerdown',click);
    const draw=t=>{
      const dt=Math.min(2,(t-last)/16.67||1);last=t;
      ctx.clearRect(0,0,w,h);
      for(let i=waterDisturbances.length-1;i>=0;i--){if(t-waterDisturbances[i].start>1900)waterDisturbances.splice(i,1);}
      drawWater(t);
      // Курсордун изи дароо секирбейт: инерция менен жетип, токтогондо жай басаңдайт.
      const m=bubbleMotion.current;
      if(m.inside&&m.hasPosition){
        if(t-movementAt>90)m.velocity*=Math.exp(-.15*dt);
        const dx=m.tx-m.x,dy=m.ty-m.y;
        const follow=1-Math.exp(-.115*dt);
        m.x+=dx*follow;m.y+=dy*follow;
        const remaining=Math.hypot(dx,dy);
        const motion=Math.max(m.velocity,remaining*.10);
        m.emission+=Math.min(2.4,motion*.14)*dt;
        while(m.emission>=1){spawn(m.x,m.y,3);m.emission-=1;}
        m.velocity*=Math.exp(-.19*dt);
        if(m.velocity<.07)m.velocity=0;
      }
      // Майда көбүкчөлөр, чоң шар жок.
      for(let i=particles.length-1;i>=0;i--){
        const p=particles[i];p.x+=(p.vx+Math.sin(t*.0018+p.phase)*.12)*dt;p.y+=p.vy*dt;p.vx*=Math.pow(.987,dt);p.vy-=.009*dt;p.life-=p.decay*dt;
        if(p.life<=0){particles.splice(i,1);continue;}
        const alpha=Math.min(1,p.life*1.35),r=p.r*(.5+.5*p.life);
        ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
        ctx.fillStyle=`rgba(152,211,220,${alpha*.35})`;ctx.fill();
        ctx.lineWidth=.8;ctx.strokeStyle=`rgba(188,229,235,${alpha*.48})`;ctx.stroke();
        ctx.beginPath();ctx.arc(p.x-r*.25,p.y-r*.3,Math.max(.55,r*.24),0,Math.PI*2);
        ctx.fillStyle=`rgba(220,241,244,${alpha*.45})`;ctx.fill();
      }
      // Сууга тамчы түшкөндөй: жарык жана көлөкө менен жумшак кеңейген шакекчелер.
      for(let i=ripples.length-1;i>=0;i--){
        const wave=ripples[i];wave.r+=2.9*dt;wave.life-=.0095*dt;
        if(wave.life<=0){ripples.splice(i,1);continue;}
        const fade=Math.sin(Math.PI*Math.min(1,(1-wave.life)*5)) * Math.pow(wave.life,1.4);
        const outer=wave.r+20;
        const glow=ctx.createRadialGradient(wave.x,wave.y,Math.max(0,wave.r-23),wave.x,wave.y,outer);
        glow.addColorStop(0,'rgba(135,225,245,0)');
        glow.addColorStop(.47,`rgba(100,200,235,${fade*.035})`);
        glow.addColorStop(.78,`rgba(205,245,255,${fade*.055})`);
        glow.addColorStop(1,'rgba(100,210,240,0)');
        ctx.fillStyle=glow;ctx.beginPath();ctx.arc(wave.x,wave.y,outer,0,Math.PI*2);ctx.fill();
        for(let ring=0;ring<3;ring++){
          const radius=wave.r-ring*19;
          if(radius<=1)continue;
          for(let pass=0;pass<2;pass++){
            ctx.beginPath();
            for(let j=0;j<=120;j++){
              const angle=j*Math.PI*2/120;
              const irregular=(Math.sin(angle*4+wave.seed+wave.r*.012)*1.1+Math.sin(angle*7-wave.r*.015)*.65)*fade;
              const rr=radius+irregular+(pass?2:0);
              const px=wave.x+Math.cos(angle)*rr,py=wave.y+Math.sin(angle)*rr*.96;
              if(j===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
            }
            ctx.closePath();
            ctx.lineWidth=pass?3.3:1.65;
            ctx.strokeStyle=pass?`rgba(30,110,155,${fade*(.18-ring*.035)})`:`rgba(200,246,255,${fade*(.35-ring*.075)})`;
            ctx.stroke();
          }
        }
      }
      raf=requestAnimationFrame(draw);
    };
    raf=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(raf);observer.disconnect();side.removeEventListener('pointermove',move);side.removeEventListener('pointerleave',leave);side.removeEventListener('pointerdown',click)};
  },[]);
  const [showPassword,setShowPassword]=useState(false);
  const [loginEmail,setLoginEmail]=useState('');
  const isRegister=mode==='create';
  const hasRememberedEmail=!!selected?.email;
  return <div className="novaAuth">
    <aside className="novaSide">
      <canvas ref={visualCanvas} className="novaLiquidCanvas" aria-hidden="true"/>
      <div className="novaLiquidCaption">ЖАНДУУ ИНТЕРАКТИВДҮҮ ФОН <span>● Мышканы кыймылдатыңыз</span></div>
      <div className="novaBrand"><span className="novaBrandMark">ТБ</span><span><strong>Тендер База</strong><small>WORKSPACE / 2026</small></span></div>
      <div className="novaSideBody"><span className="novaKicker">БИРДИКТҮҮ БАШКАРУУ</span><h1>Бардык тендерлер.<br/><em>Бир жерде.</em></h1><p>Документтерди, келишимдерди жана аткаруучуларды ыңгайлуу башкарыңыз.</p><div className="novaDecor"><span>01 / АККАУНТТАР</span><span>02 / ТЕНДЕРЛЕР</span><span>03 / ДОКУМЕНТТЕР</span></div></div>
      <div className="novaSideFoot">TENDER BAZA <span>© 2026</span></div>
    </aside>
    <main className="novaMain"><div className="novaMainTop"><span className="novaOnline"/> КООПСУЗ КИРҮҮ <span className="novaTopRule"/></div>
      <div className="novaContent">
      {isRegister?<>
        <div className="novaTitle"><span className="novaStep">01 — БИР ЖОЛКУ КАТТАЛУУ</span><h2>Катталуу</h2><p>Email жана пароль киргизип аккаунт түзүңүз. Кийинки жолу пароль гана суралат.</p></div>
        <form className="novaForm" onSubmit={createAccount}>
          <label>Email дареги<input name="email" type="email" autoComplete="email" placeholder="example@mail.com" required/></label>
          <label>Пароль<SecretField name="password" placeholder="Кеминде 6 символ"/></label>
          <label>Парольду кайталоо<SecretField name="repeatPassword" placeholder="Парольду кайра жазыңыз"/></label>
          {error&&<div className="novaError" role="alert">{error}</div>}
          <button className="novaSubmit" disabled={busy}>{busy?'Катталууда...':'Регистрация'}<ArrowRight size={19}/></button>
        </form>
        <button type="button" className="novaTextLink" onClick={()=>{setMode('login');setSelected(null)}}>Аккаунтуңуз барбы? Email менен кириңиз</button>
      </>:<>
        <div className="novaTitle"><span className="novaStep">ПАРОЛЬ МЕНЕН КИРҮҮ</span>
          {hasRememberedEmail?<div className="novaLoginIdentity"><span className="novaIdentityIcon">{(selected.name||selected.email||'А').slice(0,1).toUpperCase()}</span><span><h2>Кош келиңиз!</h2><p>{selected.email}</p></span></div>:<h2>Кирүү</h2>}
          <p>{hasRememberedEmail?'Паролуңузду жазып эле кириңиз.':'Катталган email жана паролуңузду жазыңыз.'}</p>
        </div>
        <form className="novaForm" onSubmit={login}>
          {!hasRememberedEmail&&<label>Email дареги<input name="email" type="email" autoComplete="email" placeholder="example@mail.com" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} required autoFocus/></label>}
          <label>Пароль<div className="novaPassword"><input name="password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Паролуңузду жазыңыз" required autoFocus/><button type="button" onClick={()=>setShowPassword(v=>!v)}>{showPassword?'Жашыруу':'Көрсөтүү'}</button></div></label>
          <button type="button" className="novaForgot" onClick={()=>resetPassword(hasRememberedEmail?'':loginEmail)} disabled={busy||(!hasRememberedEmail&&!loginEmail.trim())}>Парольду унуттуңузбу?</button>
          {error&&<div className="novaError" role="alert">{error}</div>}
          <button className="novaSubmit" disabled={busy}>{busy?'Кирүүдө...':'Кирүү'}<ArrowRight size={19}/></button>
        </form>
        <button type="button" className="novaTextLink" onClick={()=>{setSelected(null);setShowPassword(false);setMode(hasRememberedEmail?'login':'create')}}>
          {hasRememberedEmail?'Башка email менен кирүү':'Жаңы аккаунт каттоо'}
        </button>
      </>}
      </div><div className="novaMainFoot">Тендер База <span>•</span> Коопсуз кирүү</div>
    </main>
  </div>;
}
function PaidAmount({t,onClick,readOnly=false}){
  const paid=Number(t.paid||0);
  const total=Number(t.sum||0);

  let state='red';
  let text='✕ 0 сом';

  if(paid>0 && paid<total){
    state='yellow';
    text=money(paid);
  }

  if(total>0 && paid>=total){
    state='green';
    text='✓ '+money(paid);
  }

  if(readOnly)return <span className={'paidAmount '+state+' tfReadonlyPill'}>{text}</span>;
  return(
    <button
      type="button"
      className={'paidAmount '+state}
      title="Төлөнгөн сумманы өзгөртүү"
      onClick={onClick}
    >
      {text}
    </button>
  );
}

function PayPill({t,type,openStatus,readOnly=false}){
  const val=t[type];

  if(!val){
    return readOnly?<span className="pill gray noGuarantee tfReadonlyPill">Жок</span>:<button type="button" className="pill gray clickable noGuarantee" onClick={openStatus} title="Статусту өзгөртүү">Жок</button>;
  }

  const status=
    t[type+'Status'] ||
    (t[type+'Paid']?'paid':'unpaid');

  const meta={
    unpaid:{label:'Төлөнө элек',cls:'red'},
    waiting:{label:'Күтүлүүдө',cls:'yellow'},
    paid:{label:'Төлөндү',cls:'blue'},
    returned:{label:'Кайтарылды',cls:'green'}
  }[status]||{label:'Төлөнө элек',cls:'red'};

  if(readOnly)return <span className={'pill '+meta.cls+' tfReadonlyPill'} title={meta.label}>{money(String(val).replace(/\s/g,''))}</span>;
  return(
    <button
      type="button"
      className={'pill clickable '+meta.cls}
      onClick={openStatus}
      title="Статусту өзгөртүү"
    >
      {money(String(val).replace(/\s/g,''))}
    </button>
  );
}

function PaymentStatusModal({t,type,update,close}){
  const val=t[type];
  const current=
    t[type+'Status'] ||
    (t[type+'Paid']?'paid':'unpaid');

  const [saving,setSaving]=useState(false);
  const choose=async status=>{
    if(saving)return;
    setSaving(true);
    try{
      const saved=await update(tenderKey(t),{
        [type+'Status']:status,
        [type+'Paid']:status==='paid'||status==='returned'
      });
      if(saved)close();
    }finally{setSaving(false);}
  };

  return(
    <div className="overlay" onMouseDown={close}>
      <div
        className="modal paymentStatusModal"
        onMouseDown={e=>e.stopPropagation()}
      >
        <button className="close" onClick={close}>
          <X/>
        </button>

        <small>{guaranteeLabel(type)} СТАТУСУ</small>
        <h2>Төлөм статусун тандаңыз</h2>

        <div className="statusModalAmount">
          <span>Суммасы</span>
          <b>{val?money(String(val).replace(/\s/g,'')):'Көрсөтүлгөн эмес'}</b>
        </div>

        <div className="statusModalButtons">
          {[
            {key:'unpaid',color:'red',label:'Төлөнө элек',detail:'Төлөм жасала элек'},
            {key:'paid',color:'blue',label:'Төлөндү',detail:'Төлөм толук аткарылды'},
            {key:'waiting',color:'yellow',label:'Күтүлүүдө',detail:'Төлөм текшерилип же күтүлүп жатат'},
            {key:'returned',color:'green',label:'Кайтарылды',detail:'Кепилдик суммасы кайтарылды'}
          ].map(option=>(
            <button
              key={option.key}
              type="button"
              className={'statusChoice '+option.color+(current===option.key?' selected':'')}
              disabled={saving}
              onClick={()=>choose(option.key)}
            >
              <span className="statusDot"/>
              <div><b>{option.label}</b><small>{option.detail}</small></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsPage({user,company,executors,busy,updateCompanyName,changeAccountPassword,manageExecutor,sendReset,logout}){
  const legacy=company?.authType==='pin';
  const[managersOpen,setManagersOpen]=useState(false);
  const[executorSearch,setExecutorSearch]=useState('');
  const[editExecutor,setEditExecutor]=useState(null);
  const[editName,setEditName]=useState('');
  const[deleteExecutor,setDeleteExecutor]=useState(null);
  const[deletePassword,setDeletePassword]=useState('');
  const[actionError,setActionError]=useState('');
  const visibleExecutors=executors.filter(([name])=>matches(name,executorSearch))
    .sort(([first],[second])=>first.localeCompare(second,'ru'));
  const startRename=name=>{
    setDeleteExecutor(null);setEditExecutor(name);setEditName(name);setActionError('');
  };
  const rename=async e=>{
    e.preventDefault();
    const next=editName.trim();
    if(next.length<2){setActionError('Аты кеминде 2 символ болушу керек');return;}
    if(next===editExecutor){setEditExecutor(null);return;}
    setActionError('');
    const result=await manageExecutor('rename',editExecutor,next);
    if(result.ok)setEditExecutor(null);
    else setActionError(result.error);
  };
  const remove=async e=>{
    e.preventDefault();
    if(!deleteExecutor)return;
    setActionError('');
    const result=await manageExecutor('delete',deleteExecutor,undefined,deletePassword);
    if(result.ok){setDeleteExecutor(null);setDeletePassword('');}
    else setActionError(result.error);
  };
  return <div className="settingsPage">
    <header className="settingsHeader">
      <div><small>АККАУНТ</small><h1>Настройки</h1><p>Компания жана аккаунт маалыматын ушул жерден башкарасыз.</p></div>
    </header>
    <div className="settingsGrid">
      <section className="settingsCard">
        <div className="settingsCardTitle"><User/><div><h2>Компания</h2><p>Компаниянын көрүнгөн атын өзгөртүү</p></div></div>
        <form className="settingsForm" onSubmit={updateCompanyName}>
          <label>Компаниянын аты<input name="companyName" defaultValue={company?.name||''} required/></label>
          <label>Email<input value={user?.email||''} disabled/></label>
          <button className="primary" disabled={busy}><Save/>{busy?'Сакталууда...':'Атын сактоо'}</button>
        </form>
      </section>
      <section className="settingsCard">
        <div className="settingsCardTitle"><Settings/><div><h2>Коопсуздук</h2><p>{legacy?'8 цифралык PINди кадимки парольго алмаштыра аласыз':'Паролуңузду өзгөртүңүз'}</p></div></div>
        <form className="settingsForm" onSubmit={changeAccountPassword}>
          <label>{legacy?'Азыркы 8 цифралык PIN':'Азыркы пароль'}<input name="currentPassword" type="password" inputMode={legacy?'numeric':undefined} maxLength={legacy?8:undefined} required/></label>
          <label>Жаңы пароль<input name="newPassword" type="password" minLength="6" required placeholder="Кеминде 6 символ"/></label>
          <label>Жаңы парольду кайталаңыз<input name="repeatNewPassword" type="password" minLength="6" required/></label>
          <button className="primary" disabled={busy}><Save/>{busy?'Өзгөртүлүүдө...':'Парольду өзгөртүү'}</button>
        </form>
        <button type="button" className="settingsLinkButton" onClick={sendReset}>Email аркылуу парольду калыбына келтирүү</button>
      </section>
      <section className="settingsCard settingsInfoCard">
        <div className="settingsCardTitle"><FileText/><div><h2>Аккаунт маалыматы</h2><p>Firebase аккаунтуңуздун негизги маалыматы</p></div></div>
        <div className="settingsInfo"><span>Email<strong>{user?.email||'—'}</strong></span><span>Кирүү түрү<strong>{legacy?'8 цифралык PIN':'Кадимки пароль'}</strong></span><span>UID<strong>{user?.uid||'—'}</strong></span></div>
      </section>
      <section className="settingsCard settingsManagersCard">
        <button type="button" className="settingsManagersToggle" aria-expanded={managersOpen} onClick={()=>{setManagersOpen(open=>!open);setEditExecutor(null);setActionError('');}}>
          <span className="settingsManagersIcon"><Users size={21}/></span>
          <span className="settingsManagersText"><b>Управление пользователями / Аткаруучулар</b><small>Аткаруучунун атын өзгөртүү же анын бардык тендерлерин жана файлдарын өчүрүү</small></span>
          <span className="settingsManagersCount">{executors.length}</span>
          {managersOpen?<ChevronDown size={18}/>:<ChevronRight size={18}/>}
        </button>
        {managersOpen&&<div className="settingsManagersPanel">
          <label className="settingsManagerSearch"><Search size={16}/><input aria-label="Аткаруучуну издөө" placeholder="Аткаруучуну издөө..." value={executorSearch} onChange={e=>setExecutorSearch(e.target.value)}/></label>
          {actionError&&<p role="alert" className="settingsManagerError">{actionError}</p>}
          {!visibleExecutors.length&&<p className="settingsManagerEmpty">Аткаруучу табылган жок</p>}
          <div className="settingsManagersList">{visibleExecutors.map(([name,items])=><div className="settingsManagerRow" key={name}>
            {editExecutor===name ? <form className="settingsManagerEdit" onSubmit={rename}>
              <label>Жаңы аты<input autoFocus value={editName} maxLength={80} onChange={e=>setEditName(e.target.value)} disabled={busy} required/></label>
              <button type="submit" className="settingsManagerSave" disabled={busy}><Save size={15}/>Сактоо</button>
              <button type="button" className="settingsManagerCancel" disabled={busy} onClick={()=>{setEditExecutor(null);setActionError('');}}>Жок</button>
            </form> : <>
              <span className="settingsManagerAvatar"><User size={17}/></span>
              <span className="settingsManagerIdentity"><b>{name}</b><small>{items.length} лот · {new Set(items.map(t=>String(t.id||tenderKey(t)))).size} тендер</small></span>
              <button type="button" className="settingsManagerRename" disabled={busy} onClick={()=>startRename(name)}><Pencil size={15}/><span>Изменить</span></button>
              <button type="button" className="settingsManagerDelete" disabled={busy} onClick={()=>{setEditExecutor(null);setActionError('');setDeletePassword('');setDeleteExecutor(name);}}><Trash2 size={15}/><span>Удалить</span></button>
            </>}
          </div>)}</div>
          <div className="settingsManagersFootnote"><ShieldCheck size={16}/> Өчүрүүгө учурда кирип турган аккаунттун паролу жана администратор укугу талап кылынат.</div>
        </div>}
      </section>
      <section className="settingsCard dangerSettings">
        <div className="settingsCardTitle"><X/><div><h2>Сеанс</h2><p>Бул түзмөктөгү аккаунттан чыгуу</p></div></div>
        <button type="button" className="settingsLogout" onClick={logout}>Аккаунттан чыгуу</button>
      </section>
    </div>
    {deleteExecutor&&<div className="settingsDeleteShade" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy){setDeleteExecutor(null);setDeletePassword('');setActionError('');}}}>
      <div className="settingsDeleteDialog" role="dialog" aria-modal="true" aria-labelledby="settingsDeleteTitle">
        <span className="settingsDeleteIcon"><Trash2 size={23}/></span>
        <small>ӨЧҮРҮҮНҮ ЫРАСТОО</small>
        <h2 id="settingsDeleteTitle">«{deleteExecutor}» аткаруучусун өчүрөсүзбү?</h2>
        <p>Бул аткаруучунун <strong>{executors.find(([name])=>name===deleteExecutor)?.[1].length||0} лоту</strong>, Firebase'деги маалыматтары жана Cloudinary'деги бардык файлдары биротоло өчүрүлөт. Артка кайтаруу мүмкүн эмес.</p>
        <form onSubmit={remove}>
          <label>Өчүрүү үчүн өз аккаунтуңуздун азыркы паролун жазыңыз
            <input autoFocus type="password" autoComplete="current-password" value={deletePassword} onChange={e=>setDeletePassword(e.target.value)} disabled={busy} required placeholder="Введите пароль своей учётной записи"/>
          </label>
          {actionError&&<div className="settingsManagerError" role="alert">{actionError}</div>}
          <div className="settingsDeleteActions">
            <button type="button" disabled={busy} onClick={()=>{setDeleteExecutor(null);setDeletePassword('');setActionError('');}}>Отмена</button>
            <button type="submit" disabled={busy||!deletePassword}><Trash2 size={16}/>{busy?'Өчүрүлүүдө...':'Удалить навсегда'}</button>
          </div>
        </form>
      </div>
    </div>}
  </div>;
}

function FilesPage({tenders,openDocs}){
  const[openTenderDocs,setOpenTenderDocs]=useState({});
  const[fileQuery,setFileQuery]=useState('');
  const[preview,setPreview]=useState(null);
  const visibleTenders=sortTendersByDate(tenders.filter(t=>matches([t.id,t.name,t.org,t.executor,...Object.entries(t.docs||{}).flatMap(([k,v])=>[k,v?.name])].join(' '),fileQuery)));

  const toggleTenderDocs=tenderId=>{
    setOpenTenderDocs(prev=>({...prev,[tenderId]:!prev[tenderId]}));
  };

  const totalFilesCount=tenders.reduce(
    (a,t)=>a+Object.keys(t.docs||{}).length,
    0
  );

  return(
    <div className="filesPage">
      <div className="filesCompactTop">
        <div className="filesCompactTitle">
          <small>ДОКУМЕНТТЕР БАЗАСЫ</small>
          <h1>Файлдар</h1>
        </div>
        <label className="librarySearch filesTopSearch"><Search size={17}/><input aria-label="Файлдарды издөө" placeholder="Файл, тендер же аткаруучу…" value={fileQuery} onChange={e=>setFileQuery(e.target.value)}/></label>
        <div className="filesMiniStats">
          <div className="filesMiniStat"><FileText size={17}/><span>Файлдар</span><b>{totalFilesCount}</b></div>
          <div className="filesMiniStat"><Briefcase size={17}/><span>Документи бар</span><b>{tenders.filter(t=>Object.keys(t.docs||{}).length>0).length}</b></div>
        </div>
      </div>

      <div className="panel tablePanel filesPagePanel">
        <div className="panelhead">
          <div>
            <small>ТЕНДЕРЛЕР ЖАНА ДОКУМЕНТТЕР</small>
            <h2>Документтер архиви</h2>
          </div>
          <span className="count">{tenders.length} тендер</span>
        </div>

        {visibleTenders.length===0 ? (
          <div className="docsEmpty filesPageEmpty">
            <FolderOpen/>
            <b>{fileQuery ? "Издөө боюнча файл табылган жок" : "Азырынча тендер жок"}</b>
          </div>
        ) : (
          <div className="accordionContainer">
            {visibleTenders.map(tender=>{
              const isTenderOpen=!!fileQuery.trim()||!!openTenderDocs[tenderKey(tender)];
              const tenderMatch=matches([tender.id,tender.name,tender.org,tender.executor].join(' '),fileQuery);
              const docEntries=Object.entries(tender.docs||{}).filter(([k,v])=>tenderMatch||matches(k+' '+v?.name,fileQuery));

              return(
                <div className="tenderAccordionSubGroup" key={tenderKey(tender)}>
                  <button
                    type="button"
                    className="tenderAccordionHeader" aria-expanded={isTenderOpen}
                    onClick={()=>toggleTenderDocs(tenderKey(tender))}
                  >
                    <div className="tenderAccordionTitleText">
                      <span>{tender.name}</span>
                      <small>({tender.org} — {money(tender.sum)} | Аткаруучу: {tender.executor||'Жок'})</small>
                    </div>
                    <div className="tenderAccordionMeta">
                      <span className="fileCountPill">
                        {docEntries.length} документ
                      </span>
                      {isTenderOpen ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                    </div>
                  </button>

                  {isTenderOpen&&(
                    <div className="tenderAccordionDocsList">
                      <button className="primary archiveAttach" onClick={()=>openDocs(tender)}><FolderOpen size={16}/> Документтерди көрүү</button>
                      {docEntries.length===0 ? (
                        <div className="noDocsInline">Бул тендерге документ тиркеле элек</div>
                      ) : (
                        docEntries.map(([docTypeName, fileObj])=>(
                          <div className="fileAccordionRow" key={docTypeName}>
                            <div className="fileIconSmall"><FileText size={14}/></div>
                            <div className="fileInfoSmall">
                              <b>{docTypeName}</b>
                              <small>{fileObj?.name||'Файл'}</small>
                            </div>

                            <button
                              type="button"
                              className="downloadBtn"
                              onClick={()=>downloadCloudFile(fileObj?.url,fileObj?.name)}
                              disabled={!fileObj?.url}
                            >
                              <Download size={14}/>
                              Скачать
                            </button>

                            <button
                              type="button"
                              className="filesBtn"
                              onClick={()=>setPreview(fileObj)} disabled={!fileObj?.url}
                            >
                              Ачуу
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {preview&&<FilePreview file={preview} close={()=>setPreview(null)}/>}
    </div>
  );
}


pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;

function TenderPdfViewer({url,name}){
  const [pdf,setPdf]=useState(null);
  const [pages,setPages]=useState(0);
  const [zoom,setZoom]=useState(1);
  const [fitWidth,setFitWidth]=useState(true);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const scrollRef=useRef(null);
  const [width,setWidth]=useState(850);
  useEffect(()=>{
    const node=scrollRef.current;
    if(!node)return;
    const observer=new ResizeObserver(entries=>{
      const w=entries[0]?.contentRect?.width;
      if(w)setWidth(Math.max(240,w-32));
    });
    observer.observe(node);
    return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    let cancelled=false;
    let task;
    setPdf(null);setPages(0);setLoading(true);setError('');setZoom(1);setFitWidth(true);
    (async()=>{
      try{
        // Cloudinary CORS must permit reading PDF bytes for canvas rendering.
        task=pdfjsLib.getDocument({url,withCredentials:false});
        const document=await task.promise;
        if(cancelled){await document.destroy();return;}
        setPdf(document);setPages(document.numPages);setLoading(false);
      }catch(err){
        if(!cancelled){setError('PDF жүктөлгөн жок: '+(err?.message||String(err)));setLoading(false);}
      }
    })();
    return ()=>{cancelled=true;task?.destroy()?.catch?.(()=>{});};
  },[url]);
  const setScale=delta=>{setFitWidth(false);setZoom(z=>Math.min(3,Math.max(.4,Math.round((z+delta)*10)/10)));};
  return <div className="tfPdfViewer">
    <div className="tfPdfScroll" ref={scrollRef}>
      {loading&&<div className="tfPdfStatus">PDF жүктөлүүдө…</div>}
      {error&&<div className="tfPdfStatus tfPdfError">{error}<a href={url} target="_blank" rel="noopener noreferrer">Жаңы беттен ачуу</a></div>}
      {pdf&&Array.from({length:pages},(_,i)=><TenderPdfPage key={`${url}-${i}`} pdf={pdf} pageNumber={i+1} width={width} zoom={zoom} fitWidth={fitWidth}/>)}
    </div>
  </div>;
}
function TenderPdfPage({pdf,pageNumber,width,zoom,fitWidth}){
  const canvasRef=useRef(null);
  const [state,setState]=useState('loading');
  useEffect(()=>{
    let cancelled=false,renderTask;
    (async()=>{
      try{
        setState('loading');
        const page=await pdf.getPage(pageNumber);
        if(cancelled)return;
        const base=page.getViewport({scale:1});
        const scale=fitWidth?Math.min(2.5,width/base.width):zoom;
        const viewport=page.getViewport({scale});
        const pixelRatio=Math.min(window.devicePixelRatio||1,2);
        const canvas=canvasRef.current;
        if(!canvas)return;
        canvas.width=Math.round(viewport.width*pixelRatio);
        canvas.height=Math.round(viewport.height*pixelRatio);
        canvas.style.width=`${viewport.width}px`;
        canvas.style.height=`${viewport.height}px`;
        const ctx=canvas.getContext('2d',{alpha:false});
        renderTask=page.render({canvasContext:ctx,viewport,transform:pixelRatio!==1?[pixelRatio,0,0,pixelRatio,0,0]:undefined});
        await renderTask.promise;
        if(!cancelled)setState('ready');
      }catch(err){if(!cancelled&&err?.name!=='RenderingCancelledException')setState('error');}
    })();
    return ()=>{cancelled=true;renderTask?.cancel();};
  },[pdf,pageNumber,width,zoom,fitWidth]);
  return <div className="tfPdfPage"><canvas ref={canvasRef} aria-label={`PDF барак ${pageNumber}`}/><small>{state==='error'?'Баракты көрсөтүүдө ката':`${pageNumber}`}</small></div>;
}

function Documents({t,update,close,readOnly=false}){
  const [drafts,setDrafts]=useState(t.docs||{});
  const [docTitle,setDocTitle]=useState('');
  const [selectedFiles,setSelectedFiles]=useState([]);
  const [expanded,setExpanded]=useState(null);
  const [preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [deleteTarget,setDeleteTarget]=useState(null);
  const [search,setSearch]=useState('');
  const [showSuggestions,setShowSuggestions]=useState(false);
  const picker=useRef(null);
  const suggestionsRef=useRef(null);
  const lock=useRef(false);
  useEffect(()=>{
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return ()=>{document.body.style.overflow=previous};
  },[]);
  useEffect(()=>{setDrafts(t.docs||{});},[t.docs]);
  useEffect(()=>{
    if(!showSuggestions)return;
    const dismiss=e=>{if(suggestionsRef.current&&!suggestionsRef.current.contains(e.target))setShowSuggestions(false)};
    document.addEventListener('pointerdown',dismiss);
    return ()=>document.removeEventListener('pointerdown',dismiss);
  },[showSuggestions]);

  const folders=useMemo(()=>{
    const grouped=new Map();
    Object.entries(drafts).forEach(([key,file])=>{
      if(!file)return;
      // Мурда сакталган документтер да папка катары көрсөтүлөт.
      const folder=String(file.docName||key.split('__')[0]||'Документ').trim();
      if(!grouped.has(folder))grouped.set(folder,[]);
      grouped.get(folder).push({key,file});
    });
    return Array.from(grouped,([name,files])=>({name,files}))
      .filter(folder=>matches(folder.name+' '+folder.files.map(x=>x.file.name).join(' '),search));
  },[drafts,search]);

  const folderSuggestions=Array.from(new Set(Object.entries(drafts).filter(([,f])=>!!f).map(([key,f])=>String(f.docName||key.split('__')[0]||'Документ').trim())))
    .filter(name=>!docTitle.trim()||name.toLocaleLowerCase().includes(docTitle.trim().toLocaleLowerCase()));

  const saveFiles=async e=>{
    e.preventDefault();
    if(readOnly){setError('Файл кошуу үчүн аткаруучунун бөлүмүн ачыңыз');return;}
    const name=docTitle.trim();
    if(!name){setError('Документтин атын жазыңыз');return;}
    if(!selectedFiles.length){setError('Жок дегенде бир файл тандаңыз');return;}
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    let next={...drafts},saved=0;
    try{
      for(const file of selectedFiles){
        if(file.size>20*1024*1024)throw new Error(`${file.name}: 20 МБдан чоң файл`);
        const uploaded=await uploadToCloudinary(file,tenderKey(t),name);
        const key=`${name}__${doc(collection(db,'tenders')).id}`;
        next={...next,[key]:{...uploaded,docName:name}};
        // Ушул жаңы файл гана Firebase'ке кошулат; башка компьютердин файлдары сакталат.
        const ok=await update(tenderKey(t),{docs:{[key]:next[key]}});
        if(!ok)throw new Error('Firebase сактоо катасы');
        setDrafts(next);
        saved++;
      }
      setExpanded(name);
      setDocTitle('');setSelectedFiles([]);setShowSuggestions(false);
      if(picker.current)picker.current.value='';
    }catch(err){
      setError(`${saved} файл сакталды. ${err.message}`);
      setSelectedFiles(selectedFiles.slice(saved));
    }finally{lock.current=false;setBusy(false);}
  };

  const removeFile=async()=>{
    if(readOnly){setError('Файл өчүрүү үчүн аткаруучунун бөлүмүн ачыңыз');return;}
    if(!deleteTarget||busy)return;
    setBusy(true);setError('');
    try{
      const token=await auth.currentUser?.getIdToken();
      if(!token)throw new Error('Аккаунтка кайра кириңиз');
      const response=await fetch('/api/delete-file',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({tenderId:tenderKey(t),docName:deleteTarget.key})
      });
      if(!response.headers.get('content-type')?.includes('application/json'))
        throw new Error('Файл өчүрүү API табылган жок. Vercel сервердик функциясын жана настройкасын текшериңиз.');
      const result=await response.json().catch(()=>{throw new Error('Сервер туура JSON жооп берген жок');});
      if(!response.ok)throw new Error(result.error||`Өчүрүү катасы (${response.status})`);
      if(result.ok!==true)throw new Error('Сервер Cloudinary жана Firebase өчүрүүнү ырастаган жок');
      // /api/delete-file Cloudinary менен Firestore'дон өзү өчүрөт.
      // Экинчи updateDoc'тун кереги жок: ал жарым-жартылай ката жаратышы мүмкүн.
      const next={...drafts};delete next[deleteTarget.key];
      setDrafts(next);
      if(preview?.key===deleteTarget.key)setPreview(null);
      setDeleteTarget(null);
    }catch(err){setError('Өчүрүү ишке ашкан жок: '+err.message)}
    finally{setBusy(false)}
  };

  const previewFile=preview?.file;
  const extension=(previewFile?.name||'').split('.').pop().toLowerCase();
  const isImage=previewFile?.type?.startsWith('image/')||['jpg','jpeg','png','webp','gif','bmp','svg'].includes(extension);
  const isPdf=extension==='pdf'||previewFile?.type==='application/pdf';
  const office=['doc','docx','xls','xlsx','ppt','pptx'].includes(extension);
  return <div className="drawerShade docsDrawerShade"><div className="docsModal tfDocsV2" role="dialog" aria-modal="true" aria-label="Документтер">
    <div className="tfDocsHead">
      <div><small>ТЕНДЕР № {t.id}</small><h2>Документтер</h2><p>{t.name} · {t.executor||'Аткаруучу көрсөтүлгөн эмес'}</p></div>
      <button className="tfDocsClose" type="button" onClick={close} disabled={busy} aria-label="Жабуу"><X size={20}/></button>
    </div>
    {readOnly&&<div className="tfDocsReadonlyNotice"><FolderOpen size={16}/> Бул бөлүмдө документтерди көрүп, жүктөп гана алсаңыз болот.</div>}
    {!readOnly&&<form className="tfDocsForm" onSubmit={saveFiles}>
      <div className="tfDocsField tfDocsTitlePicker" ref={suggestionsRef}>
        <label htmlFor="tfDocsNameInput">Название документа</label>
        <input id="tfDocsNameInput" autoComplete="off" value={docTitle}
          onFocus={()=>setShowSuggestions(true)}
          onChange={e=>{setDocTitle(e.target.value);setShowSuggestions(true)}}
          onKeyDown={e=>{if(e.key==='Escape')setShowSuggestions(false)}}
          placeholder="Папканын атын жазыңыз же тандаңыз" disabled={busy} required/>
        {showSuggestions&&folderSuggestions.length>0&&<div className="tfDocsSuggestions" role="listbox" aria-label="Бар папкалар">
          {folderSuggestions.map(name=><button type="button" role="option" aria-selected={docTitle===name} key={name}
            onClick={()=>{setDocTitle(name);setShowSuggestions(false)}}><FolderOpen size={15}/><span>{name}</span></button>)}
        </div>}
      </div>
      <label className="tfDocsFileField"><span>Файлдарды тандоо</span><input ref={picker} type="file" multiple onChange={e=>setSelectedFiles(Array.from(e.target.files||[]))} disabled={busy}/></label>
      <button type="submit" className="primary tfDocsSave" disabled={busy||!docTitle.trim()||!selectedFiles.length}><Save size={17}/>{busy?'Сакталууда…':'Сохранить'}</button>
      {selectedFiles.length>0&&<small className="tfDocsSelected">{selectedFiles.length} файл тандалды: {selectedFiles.map(f=>f.name).join(', ')}</small>}
    </form>}
    {error&&<p className="authError" role="alert">{error}</p>}
    <div className="tfDocsBody">
      <section className="tfDocsFolders">
        <div className="tfDocsSectionTitle"><b>Документтердин папкалары</b><span>{folders.length}</span></div>
        <label className="tfDocsSearch"><Search size={16}/><input placeholder="Документ издөө…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <div className="tfDocsFolderScroll">
          {!folders.length&&<div className="tfDocsEmpty"><FolderOpen size={32}/>Азырынча документ жок</div>}
          {folders.map(folder=><div className="tfDocsFolder" key={folder.name}>
            <button type="button" className={'tfDocsFolderButton '+(expanded===folder.name?'opened':'')} onClick={()=>setExpanded(expanded===folder.name?null:folder.name)}>
              <FolderOpen size={19}/><span>{folder.name}</span><small>{folder.files.length}</small>{expanded===folder.name?<ChevronDown size={17}/>:<ChevronRight size={17}/>}
            </button>
            {expanded===folder.name&&<div className="tfDocsFolderFiles">{folder.files.map(({key,file})=><div className={'tfDocsFileRow '+(preview?.key===key?'active':'')} key={key}>
              <button type="button" className="tfDocsFileOpen" onClick={()=>setPreview({key,file})} title={file.name}><FileText size={16}/><span>{file.name}</span></button>
              {!readOnly&&<button type="button" className="tfDocsFileDelete" disabled={busy} title="Өчүрүү" onClick={()=>setDeleteTarget({key,file})}><Trash2 size={15}/></button>}
            </div>)}</div>}
          </div>)}
        </div>
      </section>
      <section className="tfDocsPreview">
        <div className="tfDocsPreviewHead"><b>{previewFile?.name||'Документти көрүү'}</b>{preview&&<button type="button" aria-label="Жабуу" onClick={()=>setPreview(null)}><X size={19}/></button>}</div>
        {!preview?<div className="tfDocsPreviewEmpty"><FileText size={43}/><b>Документти тандаңыз</b><span>Сол жактагы папканы ачып, файлды басыңыз</span></div>:
          <div className="tfDocsPreviewContent">
            {isImage?<img src={previewFile.url} alt={previewFile.name}/>:
             isPdf?<TenderPdfViewer key={previewFile.url} url={previewFile.url} name={previewFile.name}/>:
             office?<iframe title={previewFile.name} src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewFile.url)}`}/>:
             <div className="tfDocsPreviewEmpty"><FileText size={35}/><b>Бул формат браузерде түз ачылбашы мүмкүн</b><span>Файлды жүктөп алып ачыңыз</span></div>}
          </div>}
        {preview&&<div className="tfDocsPreviewActions"><button type="button" className="downloadBtn" onClick={()=>downloadCloudFile(previewFile.url,previewFile.name)}><Download size={16}/> Скачать</button><button type="button" className="filesBtn" onClick={()=>window.open(previewFile.url,'_blank','noopener,noreferrer')}>Жаңы беттен ачуу</button></div>}
      </section>
    </div>
    {deleteTarget&&!readOnly&&<div className="deleteConfirmShade documentDeleteShade"><div className="deleteConfirmDialog" role="dialog" aria-modal="true">
      <h2>Файлды өчүрөсүзбү?</h2><p>{deleteTarget.file.name}</p>
      <div className="deleteConfirmActions"><button type="button" disabled={busy} onClick={()=>setDeleteTarget(null)}>Жок, калтыр</button><button type="button" className="deleteApproveBtn" disabled={busy} onClick={removeFile}><Trash2 size={16}/>{busy?'Өчүрүлүүдө…':'Ооба, өчүрүү'}</button></div>
    </div></div>}
  </div></div>;
}

function FilePreview({file,close}){
  const[view,setView]=useState(null),[error,setError]=useState(''),[sheet,setSheet]=useState(0);
  const ext=(file.name||'').split('.').pop().toLowerCase();

  const printPreview=()=>{
    if(!view)return;

    // Печать терезесин түз эле click учурунда ачабыз.
    // Бул Chrome/Edge popup блокировкасынан улам "Печать" иштебей калуусун алдын алат.
    if(view.kind==='pdf'){
      const printWindow=window.open(view.url,'_blank');
      if(!printWindow){
        alert('Печать терезеси блоктолду. Браузерден pop-up уруксатын бериңиз.');
        return;
      }
      // PDF браузердин өз viewer'инде ачылат. Көпчүлүк Chrome/Edge версияларында
      // print() PDF viewer жүктөлгөндөн кийин иштейт.
      setTimeout(()=>{
        try{
          printWindow.focus();
          printWindow.print();
        }catch(e){
          // PDF viewer өзү ачылып калат — андагы принтер белгисин басса болот.
        }
      },1200);
      return;
    }

    const printWindow=window.open('','_blank','width=1100,height=800');
    if(!printWindow){
      alert('Печать терезеси блоктолду. Браузерден pop-up уруксатын бериңиз.');
      return;
    }

    const esc=s=>String(s??'')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;');

    let content='';

    if(view.kind==='word'){
      content=view.html;
    }else if(view.kind==='image'){
      content=`<div class="imageWrap"><img src="${view.url}" alt=""></div>`;
    }else if(view.kind==='text'){
      content=`<pre>${esc(view.text)}</pre>`;
    }else if(view.kind==='sheets'){
      const rows=view.sheets[sheet]?.rows||[];
      content=`<table><tbody>${rows.map((row,i)=>
        `<tr><th>${i+1}</th>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`
      ).join('')}</tbody></table>`;
    }else{
      printWindow.close();
      alert('Бул файл форматын түз печать кылуу мүмкүн эмес.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(file.name||'Документ')}</title>
<style>
  @page{margin:12mm}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}
  body{padding:0}
  img{max-width:100%;height:auto}
  .imageWrap{width:100%;text-align:center}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12pt/1.5 Arial,sans-serif;margin:0}
  table{border-collapse:collapse;width:100%;font-size:10pt}
  th,td{border:1px solid #777;padding:6px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
  th{width:42px;background:#f3f3f3}
  p{line-height:1.55}
</style>
</head>
<body>${content}
<script>
window.addEventListener('load',function(){
  setTimeout(function(){
    window.focus();
    window.print();
  },250);
});
<\/script>
</body>
</html>`);
    printWindow.document.close();
  };
  useEffect(()=>{
    let alive=true,objectUrl;const controller=new AbortController();
    const load=async()=>{try{
      if(!file.url)throw new Error('Файлдын дареги жок');
      if(ext==='pdf'||file.type==='application/pdf'){
        if(alive)setView({kind:'pdf',url:file.url});
        return;
      }
      const response=await fetch(file.url,{signal:controller.signal});
      if(!response.ok)throw new Error(`Сервер файлды берген жок (${response.status})`);
      const bytes=await response.arrayBuffer();if(!alive)return;
      if(['docx'].includes(ext)){
        const mammoth=await import('mammoth/mammoth.browser.js');const result=await (mammoth.default||mammoth).convertToHtml({arrayBuffer:bytes});if(alive)setView({kind:'word',html:result.value});
      }else if(['xlsx','xls','csv','ods'].includes(ext)){
        const XLSX=await import('xlsx');const workbook=XLSX.read(bytes,{type:'array'});if(alive)setView({kind:'sheets',sheets:workbook.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:false})}))});
      }else if(false){
      }else if(/^(png|jpg|jpeg|gif|webp|svg|bmp|avif)$/.test(ext)||file.type?.startsWith('image/')){
        objectUrl=URL.createObjectURL(new Blob([bytes],{type:file.type||'image/'+ext}));if(alive)setView({kind:'image',url:objectUrl});
      }else if(/^(txt|json|md|xml|log|html|css|js|ts|yaml|yml)$/.test(ext)||file.type?.startsWith('text/')){if(alive)setView({kind:'text',text:new TextDecoder().decode(bytes)});
      }else if(file.type?.startsWith('audio/')||file.type?.startsWith('video/')){objectUrl=URL.createObjectURL(new Blob([bytes],{type:file.type}));if(alive)setView({kind:file.type.split('/')[0],url:objectUrl});}
      else if(alive)setView({kind:'unsupported'});
    }catch(e){if(alive&&e.name!=='AbortError')setError(e.message);}};load();
    return()=>{alive=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[file.url,file.type,ext]);
  useEffect(()=>{const fn=e=>{if(e.key==='Escape'){e.stopPropagation();close();}};document.addEventListener('keydown',fn);return()=>document.removeEventListener('keydown',fn);},[close]);
  return <div className="previewShade" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section className="filePreview" role="dialog" aria-modal="true" aria-label={file.name}><div className="previewHead"><FileText/><div><b>{file.name}</b><small>{ext.toUpperCase()} · {fileSize(file.size)}</small></div><button className="previewPrintBtn" type="button" disabled={!view||!!error} onClick={printPreview}><Printer size={16}/>Печать</button><button className="downloadBtn" onClick={()=>downloadCloudFile(file.url,file.name)}><Download size={16}/>Жүктөп алуу</button><button aria-label="Көрүүнү жабуу" onClick={close}><X/></button></div><div className="previewBody">
    {error?<div className="docsEmpty" role="alert"><b>Файлды көрсөтүү мүмкүн болгон жок</b><p>{error}</p><small>Файлдын жеткиликтүүлүгүн жана Cloudinary CORS жөндөөсүн текшериңиз.</small></div>:!view?<div className="docsEmpty" role="status">Файл ачылууда…</div>:view.kind==='pdf'?<TenderPdfViewer key={view.url} url={view.url} name={file.name}/>:view.kind==='image'?<img alt={file.name} src={view.url}/>:view.kind==='word'?<iframe title={file.name} sandbox="" srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{font:16px/1.7 system-ui;background:white;padding:35px;max-width:850px;margin:auto;color:#27324a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}img{max-width:100%}</style> </head><body>${view.html}</body></html>`}/>:view.kind==='text'?<pre>{view.text}</pre>:view.kind==='sheets'?<><div className="sheetTabs">{view.sheets.map((s,i)=><button key={s.name} className={sheet===i?'selected':''} onClick={()=>setSheet(i)}>{s.name}</button>)}</div><div className="sheetScroll"><table><tbody>{view.sheets[sheet]?.rows.map((row,i)=><tr key={i}><th>{i+1}</th>{row.map((cell,j)=><td key={j}>{String(cell)}</td>)}</tr>)}</tbody></table></div></>:view.kind==='audio'?<audio controls src={view.url}/>:view.kind==='video'?<video controls src={view.url}/>:<div className="docsEmpty"><FileText/><b>Бул форматтын браузерде алдын ала көрүнүшү жок</b><p>Файлды жүктөп алып, тиешелүү программада ачыңыз. Эски .doc үчүн .docx форматын колдонуңуз.</p></div>}
  </div></section></div>;
}

function Modal({
  children,
  close
}){
  return(
    <div className="overlay" onMouseDown={close}>
      <div className="modal" onMouseDown={e=>e.stopPropagation()}>
        <button className="close" onClick={close}>
          <X/>
        </button>
        {children}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value
}){
  return(
    <div className="stat">
      <div className="statIcon">{icon}</div>
      <div>
        <small>{label}</small>
        <b>{value}</b>
      </div>
    </div>
  );
}

function GuaranteeStat({kind,icon,tenders,activeFilter,onSelect}){
  const relevant=tenders.filter(t=>hasGuarantee(t,kind));
  const paid=relevant.filter(t=>isGuaranteePaid(t,kind)).length;
  const unpaid=relevant.length-paid;
  return <div className="stat guaranteeStat">
    <div className="statIcon">{icon}</div>
    <div className="guaranteeStatBody">
      <small>{guaranteeLabel(kind)}</small>
      <div className="guaranteeStatChoices">
        <button type="button" className={'guaranteeStatChoice paid'+(activeFilter?.kind===kind&&activeFilter.status==='paid'?' active':'')} aria-pressed={activeFilter?.kind===kind&&activeFilter.status==='paid'} onClick={()=>onSelect(kind,'paid')}>
          <span>Төлөнгөн</span><strong>{paid}</strong>
        </button>
        <button type="button" className={'guaranteeStatChoice unpaid'+(activeFilter?.kind===kind&&activeFilter.status==='unpaid'?' active':'')} aria-pressed={activeFilter?.kind===kind&&activeFilter.status==='unpaid'} onClick={()=>onSelect(kind,'unpaid')}>
          <span>Төлөнө элек</span><strong>{unpaid}</strong>
        </button>
      </div>
    </div>
  </div>;
}

