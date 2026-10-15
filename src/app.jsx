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
  const[openExecutorsNav,setOpenExecutorsNav]=useState({});
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
  const[authMode,setAuthMode]=useState('companies');
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
    const unsub=onAuthStateChanged(auth,u=>{
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
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
    const name=String(f.get('company')||'').trim();
    const password=String(f.get('password')||'');
    const repeatPassword=String(f.get('repeatPassword')||'');
    if(!name || !email){setAuthError('Компаниянын аты жана email керек');return;}
    if(password.length<6){setAuthError('Пароль кеминде 6 символ болушу керек');return;}
    if(password!==repeatPassword){setAuthError('Паролдор дал келиши керек');return;}
    setAuthBusy(true);
    try{
      const credential=await createUserWithEmailAndPassword(auth,email,password);
      const company={uid:credential.user.uid,email,name,authType:'password'};
      await Promise.all([
        setDoc(doc(db,'publicCompanies',credential.user.uid),company),
        setDoc(doc(db,'companies',credential.user.uid),company).catch(()=>null)
      ]);
      const next=[...companies.filter(c=>(c.uid||c.docId)!==credential.user.uid),company];
      setCompanies(next);saveCompanyCache(next);setAuthMode('companies');
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
    const secret=String(f.get('password')||'');
    if(!secret){setAuthError('Парольду жазыңыз');return;}
    setAuthBusy(true);
    try{
      await signInWithEmailAndPassword(auth,selectedCompany.email,secret);
    }catch(err){
      setAuthError('Email же пароль туура эмес');
    }finally{setAuthBusy(false)}
  };
  const resetPassword=async()=>{
    if(!selectedCompany?.email)return;
    setAuthBusy(true);setAuthError('');
    try{
      await sendPasswordResetEmail(auth,selectedCompany.email);
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
    const legacy=currentCompany?.authType!=='password';
    if(legacy && !/^\d{8}$/.test(current)){setNotice('Азыркы PIN так 8 цифра болушу керек');return;}
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
      if(err?.code==='auth/invalid-credential'||err?.code==='auth/wrong-password')setNotice(legacy?'Азыркы PIN туура эмес':'Азыркы пароль туура эмес');
      else reportError(err);
    }finally{setBusy(false)}
  };

  const[paymentEditId,setPaymentEditId]=useState(null);
  const[paymentValue,setPaymentValue]=useState('');

  const[editingId,setEditingId]=useState(null);
  const[editDraft,setEditDraft]=useState(null);

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
      const matchesQuery=(t.id+t.org+t.name+(t.executor||''))
        .toLowerCase()
        .includes(q.toLowerCase());

      if(selectedExecutor){
        return matchesQuery && (t.executor||'Аткаруучу көрсөтүлгөн эмес')===selectedExecutor;
      }
      return matchesQuery;
    }));
  },[tenders,q,selectedExecutor]);

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
    ()=>tenders.reduce(
      (a,b)=>a+Number(b.sum||0),
      0
    ),
    [tenders]
  );

  const toggleSelect=id=>{
    setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
    setExecutorsExpanded(false);
  };

  const toggleSelectAll=()=>{
    const visible=filtered.map(t=>tenderKey(t));
    setSelectedIds(prev=>visible.length && visible.every(id=>prev.includes(id))
      ?prev.filter(id=>!visible.includes(id))
      :Array.from(new Set([...prev,...visible])));
    setExecutorsExpanded(false);
  };

  const deleteSelected=()=>{
    if(selectedIds.length===0)return;
    setDeleteConfirmOpen(true);
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
    if(!t.id||!t.name||!t.org||!t.executor){setNotice('Милдеттүү талааларды толтуруңуз');return;}
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
  };

  const startEdit=t=>{
    setPaymentEditId(null);
    setEditingId(tenderKey(t));
    setEditDraft({
      id:t.id,
      org:t.org,
      name:t.name,
      executor:t.executor||'',
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
      setEditingId(null);setEditDraft(null);setNotice('Өзгөртүүлөр сакталды');
    }catch(err){reportError(err)}finally{setBusy(false)}
  };

  const logout=async()=>{
    await signOut(auth);
    setAuthMode('companies');
    setSelectedCompany(null);
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
        <div className="authLoading">TenderFlow жүктөлүүдө...</div>
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
  gridTemplateColumns: '34px 32px minmax(125px,1.3fr) minmax(90px,1fr) minmax(115px,1.25fr) minmax(112px,1.05fr) minmax(110px,1.1fr) 90px 80px 105px 108px 72px 55px',
  alignItems: 'center',
  columnGap: 0,
  width: '100%',
  minWidth: '1250px',
  boxSizing: 'border-box'
};
  return(
    <div className="shell">
      {notice&&<div className="tfToast" role="alert"><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Жабуу"><X size={16}/></button></div>}

      <div className="mobileTopbar">
        <div className="mobileTopbarBrand"><span className="mobileTopbarLogo">TF</span><strong>TenderFlow</strong></div>
        <button type="button" className="mobileMenuTrigger" aria-label="Менюну ачуу" aria-expanded={mobileNavOpen} onClick={()=>setMobileNavOpen(true)}><span>Меню</span><LayoutDashboard size={19}/></button>
      </div>
      {mobileNavOpen && <button type="button" className="mobileNavBackdrop" aria-label="Менюну жабуу" onClick={()=>setMobileNavOpen(false)}/>}
      <aside className={mobileNavOpen ? "mobileNavOpen" : ""}>

        <div className="brand">
          <button type="button" className="mobileNavToggle" aria-expanded={mobileNavOpen} onClick={()=>setMobileNavOpen(v=>!v)}><X size={19}/><span>Жабуу</span></button>
          <div className="logo">TF</div>
          <div>
            <b>TenderFlow</b>
            <small>WORKSPACE / V2</small>
          </div>
        </div>

        <nav>
          <a
            className={page==='tenders' && !selectedExecutor ?'on':''}
            onClick={()=>{
              setPage('tenders');
              setSelectedExecutor(null);
              setQ('');
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
              const isOpen=!!openExecutorsNav[execName];
              const isSelected=selectedExecutor===execName;

              return(
                <div key={execName} style={{marginBottom:'4px'}}>
                  <button
                    type="button"
                    onClick={()=>{
                      setOpenExecutorsNav(prev=>({...prev,[execName]:!prev[execName]}));
                      setSelectedExecutor(execName);
                      setPage('tenders');
                    }}
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
                    {isOpen ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                  </button>

                  {isOpen&&(
                    <div style={{paddingLeft:'20px',display:'flex',flexDirection:'column',gap:'2px',marginTop:'2px'}}>
                      {execTenders.map(t=>(
                        <div
                          key={tenderKey(t)}
                          onClick={()=>{
                            setPage('tenders');
                            setSelectedExecutor(execName);
                            setQ(t.name);
                            setMobileNavOpen(false);
                          }}
                          style={{
                            padding:'6px 8px',
                            borderRadius:'4px',
                            cursor:'pointer',
                            fontSize:'12px',
                            color:'var(--text-secondary)'
                          }}
                        >
                          • {t.name}
                        </div>
                      ))}
                    </div>
                  )}
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
          <div className="deleteConfirmDialog" role="dialog" aria-modal="true" aria-labelledby="deleteConfirmTitle">
            <button type="button" className="deleteConfirmClose" disabled={busy} onClick={()=>setDeleteConfirmOpen(false)} aria-label="Жабуу"><X size={17}/></button>
            <div className="deleteConfirmIcon"><Trash2 size={23}/></div>
            <small>ӨЧҮРҮҮНҮ ЫРАСТОО</small>
            <h2 id="deleteConfirmTitle">{selectedIds.length} тендерди өчүрөсүзбү?</h2>
            <p>Тандалган тендерлер өчүрүлөт. Бул аракетти артка кайтаруу мүмкүн эмес.</p>
            <div className="deleteConfirmActions">
              <button type="button" className="deleteCancelBtn" disabled={busy} onClick={()=>setDeleteConfirmOpen(false)}>Жок, калтыр</button>
              <button type="button" className="deleteApproveBtn" disabled={busy} onClick={confirmDeleteSelected}>
                <Trash2 size={16}/>{busy?'Өчүрүлүүдө...':'Ооба, өчүрүү'}
              </button>
            </div>
          </div>
        </div>
      )}

      {logoutConfirm&&<div className="logoutShade" onMouseDown={e=>{if(e.target===e.currentTarget)setLogoutConfirm(false)}}>
        <div className="logoutDialog" role="dialog" aria-modal="true" aria-labelledby="logoutTitle">
          <div className="logoutDialogIcon"><User size={22}/></div>
          <h2 id="logoutTitle">Аккаунттан чыгасызбы?</h2>
          <p>Кайра кирүү үчүн компанияңызды тандап, пароль же PIN кодуңузду киргизесиз.</p>
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
                label="Тендерлер"
                value={tenders.length}
              />
              <Stat
                icon={<Wallet/>}
                label="Жалпы сумма"
                value={money(total)}
              />
              <Stat
                icon={<PackageCheck/>}
                label="ГОПП төлөнгөн"
                value={tenders.filter(t=>t.gopp&&(t.goppStatus==='paid'||t.goppStatus==='returned'||(!t.goppStatus&&t.goppPaid))).length}
              />
              <Stat
                icon={<FileText/>}
                label="Файлдар"
                value={
                  tenders.reduce(
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

                <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                  {selectedIds.length>0 && (
                    <button
                      type="button"
                      onClick={deleteSelected}
                      style={{
                        background:'#ef4444',
                        color:'#fff',
                        border:'none',
                        padding:'8px 16px',
                        borderRadius:'8px',
                        display:'flex',
                        alignItems:'center',
                        gap:'6px',
                        cursor:'pointer',
                        fontWeight:'600',
                        fontSize:'13px',
                        boxShadow:'0 2px 8px rgba(239,68,68,0.3)'
                      }}
                    >
                      <Trash2 size={15}/> Өчүрүү ({selectedIds.length})
                    </button>
                  )}
                  <span className="count">{filtered.length}</span>
                </div>
              </div>

              {/* ТАБЛИЦА */}
            {/* ТАБЛИЦА БӨЛҮГҮ */}
<div className="bigTable">
  {/* ШАПКАСЫ */}
  <div className="row head" style={tableGridStyle}>
    <span style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
      <input
        type="checkbox"
        checked={filtered.length>0 && filtered.every(t=>selectedIds.includes(tenderKey(t)))}
        onChange={toggleSelectAll}
        title="Тандоону тазалоо"
        style={{cursor:'pointer',width:'14px',height:'14px'}}
      />
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
    <span style={{textAlign:'center'}}>ОҢДОО</span>
  </div>

  {/* СТРОКАЛАРЫ */}
  {filtered.map((t,i)=>{
    const editing=editingId===tenderKey(t);
    const paymentEditing=paymentEditId===tenderKey(t);
    const isChecked=selectedIds.includes(tenderKey(t));

    return(
      <div
        className={'row '+(editing?'editingRow':'')}
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
            <span className="tenderLink">{t.id}</span>
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
          ):(
            t.name
          )}
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
              (t.docs||{})['Таблица цен']
                ?'pill green'
                :'pill gray'
            }
          >
            {(t.docs||{})['Таблица цен']?'✓ Тиркелген':'Жок'}
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

      {payStatusModal&&(
        <PaymentStatusModal
          t={payStatusModal.t}
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
        <div className="emeraldBrand"><div className="emeraldMonogram">TF</div><div><strong>Tender<span>Flow</span></strong><small>BUSINESS WORKSPACE</small></div></div>
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
  const [search,setSearch]=useState('');
  const [remember,setRemember]=useState(false);
  const [visiblePassword,setVisiblePassword]=useState(false);
  const isRegister=mode==='create';
  const panelOpen=Boolean(selected)||isRegister;
  const filtered=companies.filter(c=>`${c.name||''} ${c.email||''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const closePanel=()=>{setSelected(null);setMode('companies');setVisiblePassword(false)};
  const openRegister=()=>{setSelected(null);setMode('create');setVisiblePassword(false)};
  const openLogin=c=>{setMode('companies');setSelected(c);setVisiblePassword(false)};
  return <AuthFrame>
    <div className={`tfSlideRoot ${isRegister ? "tfSlideRegisterOpen" : selected ? "tfSlideLoginOpen" : ""}`}>
      <div className="tfSlideHeader"><span className="tfSlideEyebrow">TENDERFLOW WORKSPACE</span><h2>Компаниялар</h2><p>Компанияңызды тандап, кабинетиңизге кириңиз.</p></div>
      <div className="tfSlideSearch"><Search size={19}/><input aria-label="Компанияны издөө" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Компанияны издөө..."/></div>
      <div className="tfSlideList">{filtered.map(c=><button type="button" className="tfSlideCompany" key={c.uid||c.docId||c.email} onClick={()=>openLogin(c)}><span className="tfSlideAvatar">{(c.name||'К').slice(0,1).toUpperCase()}</span><span className="tfSlideCompanyText"><strong>{c.name}</strong><small>{c.email}</small></span><ChevronRight size={20}/></button>)}{!filtered.length&&<p className="tfSlideEmpty">{companies.length?'Компания табылган жок':'Азырынча компания каттала элек'}</p>}</div>
      <button className="tfSlideAdd" type="button" onClick={openRegister}><Plus size={20}/> Жаңы компания каттоо</button>
      <div className={'tfSlideOverlay '+(panelOpen?'isOpen':'')} aria-hidden={!panelOpen} inert={!panelOpen}>
        <div className="tfSlideOverlayHead"><button type="button" className="tfSlideBack" onClick={closePanel}><ArrowRight size={18}/> Артка</button><span>{isRegister?'КАТТАЛУУ':'КИРҮҮ'}</span></div>
        {isRegister?<div className="tfSlideInner"><div className="tfSlideHeading"><span className="tfSlideRound"><Plus size={24}/></span><h2>Жаңы компания</h2><p>Катталуу үчүн маалыматтарды толтуруңуз.</p></div><form className="tfSlideForm" onSubmit={createAccount}>
          <label>Компаниянын аты<input name="company" required placeholder="Компаниянын аталышы" autoComplete="organization"/></label>
          <label>Email<input name="email" type="email" required placeholder="company@example.com" autoComplete="email"/></label>
          <label>Пароль<SecretField name="password" placeholder="Кеминде 6 символ"/></label>
          <label>Парольду кайталоо<SecretField name="repeatPassword" placeholder="Парольду кайталаңыз"/></label>
          {error&&<p className="tfSlideError" role="alert">{error}</p>}
          <button className="tfSlideSubmit" disabled={busy}>{busy?'Катталууда...':'Катталуу'}<ArrowRight size={19}/></button>
        </form></div>:selected?<div className="tfSlideInner"><div className="tfSlideHeading"><span className="tfSlideRound">{(selected.name||'К').slice(0,1).toUpperCase()}</span><h2>{selected.name}</h2><p>{selected.email}</p></div><form className="tfSlideForm" onSubmit={e=>{localStorage.setItem('tf-remember-company',remember?'yes':'no');login(e)}}>
          <label>Пароль<div className="tfSlidePassword"><input name="password" type={visiblePassword?'text':'password'} autoComplete="current-password" required placeholder="Паролуңузду жазыңыз"/><button type="button" onClick={()=>setVisiblePassword(v=>!v)} aria-label={visiblePassword?'Парольду жашыруу':'Парольду көрсөтүү'}>{visiblePassword?'Жашыруу':'Көрсөтүү'}</button></div></label>
          <div className="tfSlideOptions"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Эсимде сактоо</label><button type="button" disabled={busy} onClick={resetPassword}>Парольду унуттуңузбу?</button></div>
          {error&&<p className="tfSlideError" role="alert">{error}</p>}
          <button className="tfSlideSubmit" disabled={busy}>{busy?'Кирүүдө...':'Кирүү'}<ArrowRight size={19}/></button>
        </form></div>:null}
      </div>
    </div>
  </AuthFrame>;
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
    return(
      <span className="pill gray noGuarantee" title="Сумма көрсөтүлгөн эмес">Жок</span>
    );
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

  const choose=status=>{
    update(tenderKey(t),{
      [type+'Status']:status,
      [type+'Paid']:status==='paid'||status==='returned'
    });
    close();
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
  const legacy=company?.authType!=='password';
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
                      <button className="primary archiveAttach" onClick={()=>openDocs(tender)}><Paperclip size={16}/> Документ тиркөө / башкаруу</button>
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

