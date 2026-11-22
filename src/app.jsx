import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import{collection,deleteDoc,doc,getDocs,setDoc,query,where,onSnapshot}from'firebase/firestore';
import { db, auth } from "./firebase";
import{
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  inMemoryPersistence,
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
  FileText,
  Settings,
  Search,
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

const COMPANY_CACHE_KEY='tf-companies';
const REMEMBERED_EMAIL_KEY='tf-remembered-email';

// Бул түзмөктө email гана сакталат. Пароль сакталбайт жана ар жаңы ачууда суралат.
const getRememberedEmail=()=>{
  try{
    const remembered=String(localStorage.getItem(REMEMBERED_EMAIL_KEY)||'').trim().toLowerCase();
    if(remembered)return remembered;
    // Мурунку версиядан бир эле аккаунт болсо, кайра каттатпай ошол email'ди колдонобуз.
    const cached=JSON.parse(localStorage.getItem(COMPANY_CACHE_KEY)||'[]');
    return Array.isArray(cached)&&cached.length===1?String(cached[0]?.email||'').trim().toLowerCase():'';
  }
  catch{return '';}
};
const rememberEmail=email=>{
  try{localStorage.setItem(REMEMBERED_EMAIL_KEY,String(email||'').trim().toLowerCase());}
  catch{/* Жеке режимде localStorage жеткиликсиз болушу мүмкүн. */}
};
const isNotHeld=t=>t?.status==='not_held';

const readCompanyCache=()=>{
  try{
    return JSON.parse(localStorage.getItem(COMPANY_CACHE_KEY))||[];
  }catch{
    return [];
  }
};

const saveCompanyCache=list=>{
  localStorage.setItem(COMPANY_CACHE_KEY,JSON.stringify(list));
};



const seed=[{
  id:'26091627861269',
  org:'ГСИН',
  name:'Кафель',
  executor:'Аскаров Б.',
  sum:778300,
  paid:0,
  gopp:'15600',
  goik:'',
  goppPaid:true,
  goikPaid:false,
  date:'2026-09-23',
  docs:{
    'Таблица цен':{
      name:'Таблица цен.xlsx',
      size:24560
    }
  }
}];

const money=n=>
  new Intl.NumberFormat('ru-RU').format(Number(n)||0)+' сом';

const read=()=>{
  try{
    return JSON.parse(localStorage.getItem('tf-v3'))||[]
  }catch{
    return []
  }
};

const persist=v=>
  localStorage.setItem('tf-v3',JSON.stringify(v));

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

  const[tenders,setTenders]=useState(read);
  const[active,setActive]=useState(null);
  const[addOpen,setAddOpen]=useState(false);
  const[addFiles,setAddFiles]=useState([]);
  const[addFileError,setAddFileError]=useState('');
  const[docsOpen,setDocsOpen]=useState(false);
  const[q,setQ]=useState('');
  const[page,setPage]=useState('tenders');
  const[payStatusModal,setPayStatusModal]=useState(null);

  const[selectedExecutor,setSelectedExecutor]=useState(null);
  const[executorQuery,setExecutorQuery]=useState('');
  const[selectedIds,setSelectedIds]=useState([]);
  const[openAccordionMap,setOpenAccordionMap]=useState({});
  const[executorsExpanded,setExecutorsExpanded]=useState(false);
  const[logoutConfirm,setLogoutConfirm]=useState(false);
  const[deleteConfirmOpen,setDeleteConfirmOpen]=useState(false);
  const[accountMenuOpen,setAccountMenuOpen]=useState(false);
  const[switchCompany,setSwitchCompany]=useState(null);
  const[switchSecret,setSwitchSecret]=useState('');
  const[switchError,setSwitchError]=useState('');
  const[switchBusy,setSwitchBusy]=useState(false);
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
  const[companies,setCompanies]=useState(readCompanyCache);
  const[authMode,setAuthMode]=useState(()=>getRememberedEmail()?'login':'create');
  const[selectedCompany,setSelectedCompany]=useState(()=>{
    const email=getRememberedEmail();
    return email?{email,name:email.split('@')[0]}:null;
  });
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
        // Firebase'дин туруктуу сеансын өчүрөбүз: жаңы ачканда сөзсүз пароль керек.
        await setPersistence(auth,inMemoryPersistence);
      }catch(err){console.error('Auth persistence:',err);}
      try{
        if(auth.authStateReady)await auth.authStateReady();
        if(auth.currentUser)await signOut(auth);
      }catch(err){console.error('Auth initialization:',err);}
      if(mounted)unsubscribe=onAuthStateChanged(auth,u=>{
        setUser(u);
        setAuthReady(true);
      });
    })();
    return()=>{mounted=false;unsubscribe();};
  },[]);

  React.useEffect(()=>{
    if(!authReady || user)return;

    const cached=readCompanyCache();
    setCompanies(cached);

    // Эски localStorage тизмесин Firestore'догу компаниялар менен БИРИКТИРЕБИЗ.
    // Мурда remoteCompanies setCompanies(...) менен cache'ти толук алмаштырып,
    // Firestore'до жок эски аккаунттарды экрандан жоготуп жаткан.
    Promise.all([
      getDocs(collection(db,'publicCompanies')).catch(err=>{console.warn('publicCompanies load:',err);return null;}),
      getDocs(collection(db,'companies')).catch(err=>{console.warn('companies load:',err);return null;})
    ])
      .then(snap=>{
        const remote=[...(snap[0]?.docs||[]),...(snap[1]?.docs||[])]
          .map(d=>({docId:d.id,...d.data()}))
          .filter(company=>company?.email);

        // Биринчи cache, анан Firestore: бир эле аккаунт болсо Firestore'догу жаңы маалымат үстүнөн жазат.
        const mergedMap=new Map();
        [...cached,...remote].forEach(company=>{
          if(!company?.email)return;
          const key=company.uid||company.docId||company.email.toLowerCase();
          const previous=mergedMap.get(key)||{};
          mergedMap.set(key,{...previous,...company});
        });

        // UID/docId өзгөрүп калган эски жазуулар email боюнча да кайталанбасын.
        const byEmail=new Map();
        Array.from(mergedMap.values()).forEach(company=>{
          const key=String(company.email).trim().toLowerCase();
          const previous=byEmail.get(key)||{};
          byEmail.set(key,{...previous,...company});
        });

        const allCompanies=Array.from(byEmail.values());
        setCompanies(allCompanies);
        saveCompanyCache(allCompanies);
      })
      .catch(err=>{
        console.error('Companies load error:',err);
        setCompanies(cached);
      });
  },[authReady,user]);

  React.useEffect(()=>{
    if(!user){setTenders([]);return;}
    const q=query(collection(db,'tenders'),where('ownerUid','==',user.uid));
    const unsub=onSnapshot(q,snap=>{
      const items=snap.docs.map(d=>({...d.data(),recordId:d.id,id:d.data().id||d.id}));
      setTenders(items);
    },err=>{console.error('Firestore sync:',err);setNotice('Firebase окуу катасы: '+err.message);});
    return unsub;
  },[user]);

  const[notice,setNotice]=useState('');
  // Ар бир жаңы билдирүү 3 секунддан кийин автоматтык жабылат.
  useEffect(()=>{
    if(!notice)return;
    const timer=window.setTimeout(()=>setNotice(''),3000);
    return ()=>window.clearTimeout(timer);
  },[notice]);
  const[busy,setBusy]=useState(false);
  const saveRemote=async (recordId,record)=>{
    await setDoc(doc(db,'tenders',recordId),{...record,recordId,ownerUid:user.uid});
  };
  const reportError=(err)=>{console.error(err);setNotice('Firebase катасы: '+(err?.message||String(err)));};

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
      rememberEmail(email);
      setSelectedCompany(company);
      await Promise.all([
        setDoc(doc(db,'publicCompanies',credential.user.uid),company),
        setDoc(doc(db,'companies',credential.user.uid),company).catch(()=>null)
      ]);
      const next=[...companies.filter(c=>(c.uid||c.docId)!==credential.user.uid),company];
      setCompanies(next);saveCompanyCache(next);setAuthMode('login');
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
      rememberEmail(email);
      setSelectedCompany({email,name:email.split('@')[0]});
    }catch(err){
      setAuthError('Email же пароль туура эмес');
    }finally{setAuthBusy(false)}
  };
  const resetPassword=async(emailOverride='')=>{
    const email=String(emailOverride||selectedCompany?.email||getRememberedEmail()).trim().toLowerCase();
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
      setCompanies(next);saveCompanyCache(next);setNotice('Компаниянын аты өзгөртүлдү');
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
      setCompanies(list);saveCompanyCache(list);e.currentTarget.reset();setNotice('Пароль ийгиликтүү өзгөртүлдү');
    }catch(err){
      if(['auth/invalid-credential','auth/wrong-password','auth/invalid-login-credentials'].includes(err?.code))setNotice('Firebase азыркы парольду кабыл алган жок. Кирүүдө колдонгон парольду кайра текшериңиз же төмөнкү email аркылуу калыбына келтирүүнү колдонуңуз.');
      else if(err?.code==='auth/too-many-requests')setNotice('Көп аракет жасалды. Бир аздан кийин кайталаңыз же email аркылуу калыбына келтириңиз.');
      else if(err?.code==='auth/requires-recent-login')setNotice('Коопсуздук үчүн аккаунтка кайра кирип, парольду өзгөртүңүз.');
      else reportError(err);
    }finally{setBusy(false)}
  };

  const[paymentEditId,setPaymentEditId]=useState(null);
  const[paymentValue,setPaymentValue]=useState('');

  const[editingId,setEditingId]=useState(null);
  const[editDraft,setEditDraft]=useState(null);
  const[mobileEditOpen,setMobileEditOpen]=useState(false);
  const[mobilePaymentTender,setMobilePaymentTender]=useState(null);

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

  const filtered=useMemo(()=>{
    return sortTendersByDate(tenders.filter(t=>{
      const matchesQuery=[t.id,t.org,t.name,t.executor,t.partnerCompany].join(' ')
        .toLowerCase()
        .includes(q.toLowerCase());

      if(selectedExecutor){
        return matchesQuery && (t.executor||'Аткаруучу көрсөтүлгөн эмес')===selectedExecutor;
      }
      return matchesQuery;
    }));
  },[tenders,q,selectedExecutor]);

  // Жалпы тизмеде бирдей номердеги лоттор бир сапта; кызматкер бөлүмүндө өзүнчө.
  const [activeLotByTender,setActiveLotByTender]=useState({});
  const [openLotTender,setOpenLotTender]=useState(null);
  const [lotMenuPosition,setLotMenuPosition]=useState(null);
  const toggleLotMenu=(event,key)=>{
    if(openLotTender===key){setOpenLotTender(null);return;}
    const r=event.currentTarget.getBoundingClientRect();
    const menuHeight=Math.min(300,Math.max(90,window.innerHeight-24));
    const availableBelow=window.innerHeight-r.bottom-12;
    const availableAbove=r.top-12;
    const above=availableBelow<Math.min(230,menuHeight) && availableAbove>availableBelow;
    const maxHeight=Math.max(85,Math.min(menuHeight,above?availableAbove:availableBelow));
    const width=Math.min(360,Math.max(260,r.width),window.innerWidth-16);
    setLotMenuPosition({top:above?Math.max(8,r.top-5-maxHeight):r.bottom+5,left:Math.max(8,Math.min(r.left,window.innerWidth-width-8)),width,maxHeight});
    setOpenLotTender(key);
  };
  useEffect(()=>{
    if(!openLotTender)return;
    const close=e=>{if(!e.target.closest('.tfLotTrigger, .tfLotDropdown'))setOpenLotTender(null)};
    const scroll=()=>setOpenLotTender(null);
    document.addEventListener('pointerdown',close);
    window.addEventListener('resize',scroll);
    window.addEventListener('scroll',scroll,true);
    return ()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('resize',scroll);window.removeEventListener('scroll',scroll,true)};
  },[openLotTender]);
  const groupedLots=useMemo(()=>{
    const groups=new Map();
    filtered.forEach(t=>{
      const number=String(t.id||'').trim();
      const key=number || `single:${tenderKey(t)}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(t);
    });
    return groups;
  },[filtered]);
  const displayGroups=useMemo(()=>{
    if(selectedExecutor)return filtered.map(t=>({t,lots:[t],groupKey:`single:${tenderKey(t)}`}));
    return Array.from(groupedLots.entries()).map(([groupKey,lots])=>({
      groupKey,lots,t:lots.find(x=>tenderKey(x)===activeLotByTender[groupKey])||lots[0]
    }));
  },[filtered,groupedLots,selectedExecutor,activeLotByTender]);
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

  const total=useMemo(
    ()=>(selectedExecutor?tenders.filter(t=>(t.executor||'Аткаруучу көрсөтүлгөн эмес')===selectedExecutor):tenders).reduce(
      (a,b)=>a+Number(b.sum||0),
      0
    ),
    [tenders,selectedExecutor]
  );
  const scopeTenders=useMemo(()=>selectedExecutor
    ?tenders.filter(t=>(t.executor||'Аткаруучу көрсөтүлгөн эмес')===selectedExecutor)
    :tenders,[tenders,selectedExecutor]);

  const toggleSelect=id=>{
    setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
    setExecutorsExpanded(false);
  };

  const toggleSelectAll=()=>{
    const visible=displayFiltered.map(t=>tenderKey(t));
    setSelectedIds(prev=>visible.length && visible.every(id=>prev.includes(id))
      ?prev.filter(id=>!visible.includes(id))
      :Array.from(new Set([...prev,...visible])));
    setExecutorsExpanded(false);
  };

  const deleteSelected=()=>{
    if(selectedIds.length===0)return;
    setDeleteConfirmOpen(true);
  };

  const markNotHeld=async()=>{
    if(!selectedIds.length)return;
    setBusy(true);
    try{
      await Promise.all(selectedIds.map(id=>{
        const tender=tenders.find(t=>tenderKey(t)===id);
        return tender&&!isNotHeld(tender)?saveRemote(id,{...tender,status:'not_held'}):Promise.resolve();
      }));
      setSelectedIds([]);setDeleteConfirmOpen(false);
      setNotice('Тендерлер «Не состоялся» деп белгиленди');
    }catch(err){reportError(err)}finally{setBusy(false)}
  };
  const restoreTenders=async()=>{
    if(!selectedIds.length)return;
    setBusy(true);
    try{
      await Promise.all(selectedIds.map(id=>{
        const tender=tenders.find(t=>tenderKey(t)===id);
        return tender&&isNotHeld(tender)?saveRemote(id,{...tender,status:'active'}):Promise.resolve();
      }));
      setSelectedIds([]);setDeleteConfirmOpen(false);
      setNotice('Тендерлер кайра активдештирилди');
    }catch(err){reportError(err)}finally{setBusy(false)}
  };

  const confirmDeleteSelected=async()=>{
    if(selectedIds.length===0){setDeleteConfirmOpen(false);return;}
    setBusy(true);
    try{
      await Promise.all(selectedIds.map(id=>deleteDoc(doc(db,'tenders',id))));
      setSelectedIds([]);
      setDeleteConfirmOpen(false);
      setNotice('Тандалган тендерлер өчүрүлдү');
    }catch(err){reportError(err)}
    finally{setBusy(false)}
  };

  const update=async(id,patch)=>{
    const old=tenders.find(t=>tenderKey(t)===id);if(!old)return;
    const allowed=new Set(['goppStatus','goppPaid','goikStatus','goikPaid']);
    if(isNotHeld(old)&&Object.keys(patch).some(key=>!allowed.has(key))){
      setNotice('Бул тендер токтотулган: ГОПП жана ГОИК гана өзгөртүлөт');return false;
    }
    try{await saveRemote(id,{...old,...patch});setActive(x=>x&&tenderKey(x)===id?{...x,...patch}:x);return true;}
    catch(err){reportError(err);return false;}
  };

  async function add(e){
    e.preventDefault();

    let f=new FormData(e.currentTarget);

    let t={
      id:String(f.get('id')).trim(),
      org:String(f.get('org')).trim(),
      name:String(f.get('name')).trim(),
      executor:String(f.get('executor')||'Аткаруучу').trim(),
      partnerCompany:String(f.get('partnerCompany')||'').trim(),
      sum:+f.get('sum'),
      paid:0,
      gopp:String(f.get('gopp')||'').trim(),
      goik:String(f.get('goik')||'').trim(),
      goppPaid:false,
      goikPaid:false,
      date:f.get('date'),
      docs:{}
    };

    if(tenders.some(x=>x.id===t.id && x.name.trim().toLocaleLowerCase()===t.name.trim().toLocaleLowerCase())){setNotice('Бул тендерде мындай лот мурунтан бар! Башка лот аталышын киргизиңиз.');return;}
    if(!t.id||!t.name||!t.org||!t.executor||!t.partnerCompany){setNotice('Милдеттүү талааларды толтуруңуз');return;}
    setBusy(true);
    setAddFileError('');
    try{
      const recordId=crypto.randomUUID();
      const uploadedDocs={};
      for(const [index,file] of addFiles.entries()){
        const docName=`Тиркелген файл ${index+1} — ${file.name}`;
        uploadedDocs[docName]=await uploadToCloudinary(file,recordId,docName);
      }
      await saveRemote(recordId,{...t,recordId,docs:uploadedDocs});
      setAddOpen(false);
      setAddFiles([]);
      setNotice('Лот жана файлдар ийгиликтүү кошулду');
    }catch(err){setAddFileError('Сактоо ишке ашкан жок: '+(err?.message||String(err)));reportError(err)}
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

    const oldTender=tenders.find(t=>tenderKey(t)===oldId);
    if(!oldTender)return;
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
    if(tenders.some(t=>tenderKey(t)!==oldId && t.id===newId && t.name.trim().toLocaleLowerCase()===newTender.name.toLocaleLowerCase())){setNotice('Бул тендерде мындай лот мурунтан бар');return;}
    setBusy(true);
    try{
      await saveRemote(oldId,newTender);
      setEditingId(null);setEditDraft(null);setMobileEditOpen(false);setNotice('Өзгөртүүлөр сакталды');
    }catch(err){reportError(err)}finally{setBusy(false)}
  };

  const logout=async()=>{
    await signOut(auth);
    setAuthMode('login');
    const email=getRememberedEmail();
    setSelectedCompany(email?{email,name:email.split('@')[0]}:null);
    setAuthError('');
  };

  const openAccountSwitch=company=>{
    if(!company || company.email===user?.email)return;
    setAccountMenuOpen(false);
    setSwitchCompany(company);
    setSwitchSecret('');
    setSwitchError('');
  };

  const submitAccountSwitch=async e=>{
    e.preventDefault();
    if(!switchCompany)return;
    if(!switchSecret){
      setSwitchError('Парольду жазыңыз');
      return;
    }
    setSwitchBusy(true);
    setSwitchError('');
    try{
      await signInWithEmailAndPassword(auth,switchCompany.email,switchSecret);
      rememberEmail(switchCompany.email);
      setSelectedCompany(switchCompany);
      setSwitchCompany(null);
      setSwitchSecret('');
      setPage('tenders');
      setSelectedExecutor(null);
      setNotice(`${switchCompany.name||'Компания'} аккаунтуна өттүңүз`);
    }catch(err){
      setSwitchError('Пароль туура эмес');
    }finally{
      setSwitchBusy(false);
    }
  };

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
  gridTemplateColumns: '34px 32px minmax(125px,1.3fr) minmax(130px,1.2fr) minmax(90px,1fr) minmax(115px,1.25fr) minmax(112px,1.05fr) minmax(110px,1.1fr) 90px 80px 105px 108px 72px 55px',
  alignItems: 'center',
  columnGap: 0,
  width: '100%',
  minWidth: '1410px',
  boxSizing: 'border-box'
};
  return(
    <div className="shell">
      {notice&&<div className="tfToast" role="alert"><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Жабуу"><X size={16}/></button></div>}

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
              setSelectedIds([]);
              setMobileNavOpen(false);
            }}
          >
            <LayoutDashboard/>
            Тендерлер
          </a>

          <div className="navAccordionSection" style={{marginTop:'8px',paddingLeft:'8px',paddingRight:'8px'}}>
            <div style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:'700',marginBottom:'6px',letterSpacing:'0.5px'}}>
              АТКАРУУЧУЛАР
            </div>
            <label className="executorSearch"><Search size={15}/><input aria-label="Аткаруучуларды издөө" placeholder="Аткаруучуну издөө…" value={executorQuery} onChange={e=>setExecutorQuery(e.target.value)}/></label>
            <div className="executorScrollable" aria-label="Аткаруучулардын тизмеси">
            {!Object.keys(executorsGroup).some(name=>matches(name,executorQuery))&&<p className="searchEmpty">Аткаруучу табылган жок</p>}
            {Object.entries(executorsGroup).filter(([name])=>matches(name,executorQuery)).map(([execName, execTenders])=>{
              const isSelected=selectedExecutor===execName;

              return(
                <div key={execName} style={{marginBottom:'4px'}}>
                  <button
                    type="button"
                    onClick={()=>{
                      setSelectedExecutor(execName);
                      setPage('tenders');
                      setQ('');
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

        <div className="navbottom accountSwitcher">
          {accountMenuOpen&&(
            <div className="accountSwitchMenu">
              <div className="accountSwitchMenuHead">
                <span>АККАУНТТАР</span>
                <small>{companies.length}</small>
              </div>
              <div className="accountSwitchList">
                {companies.map(company=>{
                  const current=company.email===user.email;
                  return(
                    <button
                      type="button"
                      className={"accountSwitchItem"+(current?" current":"")}
                      key={company.uid||company.docId||company.email}
                      onClick={()=>current?setAccountMenuOpen(false):openAccountSwitch(company)}
                    >
                      <span className="accountMiniAvatar">{(company.name||company.email||'A').slice(0,2).toUpperCase()}</span>
                      <span className="accountSwitchText">
                        <b>{company.name||'Компания'}</b>
                        <small>{current?'Азыркы аккаунт':company.email}</small>
                      </span>
                      {current?<CheckCircle2 size={16}/>:<ChevronRight size={16}/>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="user">
            <div className="avatar">
              {(currentCompany?.name||user.email||'A').slice(0,2).toUpperCase()}
            </div>
            <button
              type="button"
              className="loggedUserText accountSwitchTrigger"
              onClick={()=>setAccountMenuOpen(v=>!v)}
              aria-expanded={accountMenuOpen}
              title="Башка аккаунтка өтүү"
            >
              <span>
                <b>{currentCompany?.name||'Компания'}</b>
                <small>Администратор</small>
              </span>
              <ChevronDown className={accountMenuOpen?'rotated':''} size={17}/>
            </button>
            <button className="logoutBtn" onClick={()=>setLogoutConfirm(true)} title="Аккаунттан чыгуу" aria-label="Аккаунттан чыгуу">
              <X/>
            </button>
          </div>
        </div>
      </aside>

      {switchCompany&&(
        <div className="accountSwitchShade" onMouseDown={e=>{if(e.target===e.currentTarget&&!switchBusy)setSwitchCompany(null)}}>
          <div className="accountSwitchDialog" role="dialog" aria-modal="true">
            <button type="button" className="accountSwitchClose" onClick={()=>!switchBusy&&setSwitchCompany(null)} aria-label="Жабуу"><X size={17}/></button>
            <div className="accountSwitchLogo">{(switchCompany.name||'A').slice(0,2).toUpperCase()}</div>
            <small>АККАУНТТУ АЛМАШТЫРУУ</small>
            <h2>{switchCompany.name||'Компания'}</h2>
            <p>{switchCompany.authType==='password'?'Бул аккаунттун паролун жазыңыз.':'Бул аккаунттун 8 цифралык PIN-кодун жазыңыз.'}</p>
            <form onSubmit={submitAccountSwitch} className="accountSwitchForm">
              {switchCompany.authType==='password'?(
                <input
                  type="password"
                  value={switchSecret}
                  onChange={e=>setSwitchSecret(e.target.value)}
                  placeholder="Пароль"
                  autoFocus
                  autoComplete="current-password"
                />
              ):(
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={switchSecret}
                  onChange={e=>setSwitchSecret(e.target.value.replace(/\D/g,'').slice(0,8))}
                  placeholder="8 цифралык PIN"
                  autoFocus
                  autoComplete="current-password"
                />
              )}
              {switchError&&<div className="accountSwitchError">{switchError}</div>}
              <button type="submit" className="accountSwitchSubmit" disabled={switchBusy}>
                {switchBusy?'Текшерилүүдө...':'Бул аккаунтка өтүү'}
                <ArrowRight size={17}/>
              </button>
            </form>
          </div>
        </div>
      )}

      {deleteConfirmOpen&&(
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
        {page==='tenders' ? (
          <>
            <header className="tenderTopbar">
              <h1>Тендерлерди <em>оңой башкарыңыз.</em></h1>
              <div className="actions">
                <div className="search">
                  <Search/>
                  <input
                    value={q}
                    onChange={e=>setQ(e.target.value)}
                    placeholder="Тендер номер, мекеме, товар..."
                  />
                </div>

                <button
                  className="primary"
                  onClick={()=>setAddOpen(true)}
                >
                  <Plus/>
                  Тендер кошуу
                </button>
              </div>
            </header>

            <section className="stats">
              <Stat
                icon={<Briefcase/>}
                label={selectedExecutor?'Аткаруучунун тендерлери':'Тендерлер'}
                value={scopeTenders.length}
              />
              <Stat
                icon={<Wallet/>}
                label={selectedExecutor?'Аткаруучунун жалпы суммасы':'Жалпы сумма'}
                value={money(total)}
              />
              <Stat
                icon={<PackageCheck/>}
                label="ГОПП төлөнгөн"
                value={scopeTenders.filter(t=>t.gopp&&(t.goppStatus==='paid'||t.goppStatus==='returned'||(!t.goppStatus&&t.goppPaid))).length}
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
                  <small>КАТЫШЫП ЖАТКАН ТЕНДЕРЛЕР</small>
                  <div className="tableTitleRow">
                    <h2>Таблица {headerExecutorTitle ? `— ${headerExecutorTitle}` : ''}</h2>
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
                  {selectedIds.length>0 && <>
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

              <div className="tfMobileTenderList">
                {displayGroups.map(({t,lots,groupKey})=>{
                  const key=tenderKey(t);
                  const paid=Number(t.paid||0);
                  const status=(kind)=>{
                    const val=t[kind];
                    const state=t[kind+'Status'];
                    return state==='returned'?'Кайтарылды':state==='waiting'?'Күтүлүүдө':state==='unpaid'?'Төлөнө элек':state==='paid'||(!state&&t[kind+'Paid'])?'Төлөндү':Number(String(val||'').replace(/\s/g,''))>0?'Төлөнө элек':'Жок';
                  };
                  const failed=isNotHeld(t);
                  return <article className={'tfMobileTenderCard'+(failed?' tfTenderFailed':'')} key={key}>
                    <div className="tfCardHead">
                      <input type="checkbox" className="tfCardSelect" aria-label={`Тендер ${t.id} тандоо`} checked={selectedIds.includes(key)} onChange={()=>toggleSelect(key)}/>
                      <div className="tfCardNumber"><FileText size={15}/> <span>Тендер №: {t.id}</span></div>
                      <span className="tfCardDate">{t.date||'—'}</span>
                      <button type="button" className="tfCardEdit" aria-label="Тендерди оңдоо" disabled={failed} onClick={()=>{startEdit(t);setMobileEditOpen(true);}}><Pencil size={16}/></button>
                    </div>
                    {failed&&<span className="tfFailedBadge">Тендер не состоялся</span>}
                    <div className="tfCardInfo org"><small>КОМПАНИЯ:</small><strong>{t.partnerCompany||'—'}</strong></div>
                    <div className="tfCardInfo org"><small>МЕКЕМЕ:</small><strong>{t.org}</strong></div>
                    <div className="tfCardInfo lot"><small>ЛОТ АТАЛЫШЫ:</small>{lots.length>1?<select className="tfLotMobileSelect" value={key} onChange={e=>selectLot(groupKey,e.target.value)}>{lots.map(item=><option key={tenderKey(item)} value={tenderKey(item)}>{item.name}</option>)}</select>:<strong>{t.name}</strong>}</div>
                    <div className="tfCardAmounts"><div><small>Бюджет (Суммасы):</small><strong>{money(t.sum)}</strong></div><div role={failed?undefined:'button'} tabIndex={failed?-1:0} className={failed?'tfFailedInactive':''} onClick={()=>{if(!failed){startPayment(t);setMobilePaymentTender(t)}}} onKeyDown={e=>{if(!failed&&e.key==='Enter'){startPayment(t);setMobilePaymentTender(t)}}}><small>Төлөнгөн сумма: {failed?'':'✎'}</small><strong className={paid>0?'positive':'negative'}>{paid>0?'✓ ':'× '}{money(paid)}</strong></div></div>
                    <div className="tfCardGuarantees">{['gopp','goik'].map(kind=><div key={kind}><small>{kind.toUpperCase()}:</small><button type="button" className={'tfCardGuarantee '+(status(kind)==='Төлөндү'?'blue':status(kind)==='Кайтарылды'?'green':status(kind)==='Күтүлүүдө'?'yellow':status(kind)==='Жок'?'gray':'red')} onClick={()=>setPayStatusModal({t,type:kind})}>{status(kind)}{t[kind]?' · '+t[kind]+' сом':''}</button></div>)}</div>
                    <div className="tfCardPrice"><span>Таблица цен:</span><b className={hasPriceTable(t.docs)?'attached':'missing'}>{hasPriceTable(t.docs)?'✓ Тиркелген':'Жок'}</b></div>
                    <button type="button" className="tfCardFiles" disabled={failed} onClick={()=>{setActive(t);setDocsOpen(true)}}><FolderOpen size={16}/> Файлдар <span><Paperclip size={13}/> {Object.keys(t.docs||{}).length} файл</span></button>
                  </article>;
                })}
              </div>

              {/* ТАБЛИЦА */}
            {/* ТАБЛИЦА БӨЛҮГҮ */}
<div className="bigTable">
  {/* ШАПКАСЫ */}
  <div className="row head" style={tableGridStyle}>
    <span style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
      <input
        type="checkbox"
        checked={displayFiltered.length>0 && displayFiltered.every(t=>selectedIds.includes(tenderKey(t)))}
        onChange={toggleSelectAll}
        title="Тандоону тазалоо"
        style={{cursor:'pointer',width:'14px',height:'14px'}}
      />
    </span>
    <span>№</span>
    <span>ТЕНДЕР НОМЕР</span>
    <span>КАЙСЫ КОМПАНИЯ МЕНЕН</span>
    <span>МЕКЕМЕЛЕР</span>
    <span>LOT АТАЛЫШЫ</span>
    <span>СУММАСЫ</span>
    <span>ТӨЛӨНГӨН СУММАЛАР</span>
    <span>ГОПП</span>
    <span>ГОИК</span>
    <span>ТАБЛИЦА ЦЕН</span>
    <span>СРОК ВСКРЫТИЯ</span>
    <span>ФАЙЛДАР</span>
    <span style={{textAlign:'center'}}>ОҢДОО</span>
  </div>

  {/* СТРОКАЛАРЫ */}
  {displayGroups.map(({t,lots,groupKey},i)=>{
    const editing=editingId===tenderKey(t);
    const paymentEditing=paymentEditId===tenderKey(t);
    const isChecked=selectedIds.includes(tenderKey(t));
    const failed=isNotHeld(t);

    return(
      <div
        className={'row '+(editing?'editingRow':'')+(failed?' tfTenderFailed':'')}
        key={tenderKey(t)}
        style={tableGridStyle}
      >
        {/* ЧЕКБОКС */}
        <span style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={()=>toggleSelect(tenderKey(t))}
            style={{cursor:'pointer',width:'14px',height:'14px'}}
          />
        </span>

        <span>{i+1}</span>

        {/* ТЕНДЕР НОМЕР */}
        <span>
          {editing ? (
            <input
              className="tableInput"
              value={editDraft.id}
              onChange={e=>changeEdit('id',e.target.value)}
            />
          ):(
            <span className="tenderLink" title={failed?'Тендер не состоялся':t.id}>{t.id}{failed&&<small className="tfFailedBadge">Не состоялся</small>}</span>
          )}
        </span>

        {/* КАЙСЫ КОМПАНИЯ МЕНЕН АТКАРДЫ */}
        <span className="tfCompanyCell" title={t.partnerCompany||''}>
          {editing?<input className="tableInput" value={editDraft.partnerCompany||''} onChange={e=>changeEdit('partnerCompany',e.target.value)}/>:t.partnerCompany||'—'}
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
          ):(lots.length>1 && !selectedExecutor ? (
            <div className="tfLotPicker">
              <button type="button" className="tfLotTrigger" aria-expanded={openLotTender===groupKey} onClick={e=>toggleLotMenu(e,groupKey)} title="Ушул тендердин лотторун тандоо">
                <span>{t.name}</span><span className="tfLotCount">{lots.length}</span><ChevronDown size={15}/>
              </button>
              {openLotTender===groupKey && lotMenuPosition && createPortal(<div className="tfLotDropdown" style={{position:"fixed",top:lotMenuPosition.top,left:lotMenuPosition.left,width:lotMenuPosition.width,maxHeight:`${lotMenuPosition.maxHeight}px`}}>
                {lots.map(item=><button type="button" key={tenderKey(item)} className={'tfLotOption '+(tenderKey(item)===tenderKey(t)?'selected':'')} onClick={()=>selectLot(groupKey,tenderKey(item))}>
                  <span>{item.name}</span><small>{money(item.sum)}</small>
                </button>)}
              </div>,document.body)}
            </div>
          ) : t.name)}
        </span>

        {/* ЖАЛПЫ СУММА */}
        <span style={{fontWeight:'700'}}>
          {editing ? (
            <input
              className="tableInput"
              type="number"
              min="0"
              value={editDraft.sum}
              onChange={e=>changeEdit('sum',e.target.value)}
            />
          ):(
            money(t.sum)
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
            <button type="button" className="paidAmount red tfFailedInactive" disabled>Жеткиликсиз</button>
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
              t={t}
              onClick={()=>startPayment(t)}
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
            disabled={failed}
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
          {editing ? (
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
            busy={busy}
            updateCompanyName={updateCompanyName}
            changeAccountPassword={changeAccountPassword}
            sendReset={async()=>{
              try{await sendPasswordResetEmail(auth,user.email);setNotice('Пароль алмаштыруу шилтемеси email дарегине жөнөтүлдү');}
              catch(err){reportError(err)}
            }}
            logout={()=>setLogoutConfirm(true)}
          />
        )}
      </main>

      {/* ТЕНДЕР КОШУУ МОДАЛКАСЫ */}
      {addOpen&&
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
                <input name="executor" required placeholder="Мисалы: Аскаров Б."/>
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
          t={active}
          update={update}
          close={()=>setDocsOpen(false)}
        />, document.body
      )}

      {mobileEditOpen && editDraft && (
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
      {mobilePaymentTender && (
        <Modal close={()=>setMobilePaymentTender(null)}>
          <div className="tfMobileEditDialog"><small>ТӨЛӨМДҮ ОҢДОО</small><h2>Төлөнгөн сумма</h2>
            <form onSubmit={async e=>{e.preventDefault();const t=tenders.find(x=>tenderKey(x)===tenderKey(mobilePaymentTender))||mobilePaymentTender;const ok=await savePayment(t);if(ok)setMobilePaymentTender(null)}}>
              <label>Сумма (сом)<input autoFocus type="number" min="0" max={mobilePaymentTender.sum} value={paymentValue} onChange={e=>setPaymentValue(e.target.value)}/></label>
              <div className="tfMobileEditActions"><button type="button" onClick={()=>setMobilePaymentTender(null)}>Жок</button><button type="submit" className="primary"><Save size={16}/> Сактоо</button></div>
            </form>
          </div>
        </Modal>
      )}
      {payStatusModal&&(
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
function PaidAmount({t,onClick}){
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

function PayPill({t,type,openStatus}){
  const val=t[type];

  if(!val){
    return <button type="button" className="pill gray clickable noGuarantee" onClick={openStatus} title="Статусту өзгөртүү">Жок</button>;
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

        <small>{type.toUpperCase()} СТАТУСУ</small>
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

function SettingsPage({user,company,busy,updateCompanyName,changeAccountPassword,sendReset,logout}){
  const legacy=company?.authType==='pin';
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
      <section className="settingsCard dangerSettings">
        <div className="settingsCardTitle"><X/><div><h2>Сеанс</h2><p>Бул түзмөктөгү аккаунттан чыгуу</p></div></div>
        <button type="button" className="settingsLogout" onClick={logout}>Аккаунттан чыгуу</button>
      </section>
    </div>
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
                      <button className="primary archiveAttach" disabled={isNotHeld(tender)} title={isNotHeld(tender)?'Бул тендер токтотулган':''} onClick={()=>openDocs(tender)}><Paperclip size={16}/> Документ тиркөө / башкаруу</button>
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

function Documents({t,update,close}){
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
        const key=`${name}__${crypto.randomUUID()}`;
        next={...next,[key]:{...uploaded,docName:name}};
        const ok=await update(tenderKey(t),{docs:next});
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
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||`Өчүрүү катасы (${response.status})`);
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
    <form className="tfDocsForm" onSubmit={saveFiles}>
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
    </form>
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
              <button type="button" className="tfDocsFileDelete" disabled={busy} title="Өчүрүү" onClick={()=>setDeleteTarget({key,file})}><Trash2 size={15}/></button>
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
    {deleteTarget&&<div className="deleteConfirmShade documentDeleteShade"><div className="deleteConfirmDialog" role="dialog" aria-modal="true">
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

