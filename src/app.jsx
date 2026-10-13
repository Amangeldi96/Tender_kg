import React,{useEffect,useMemo,useRef,useState} from 'react';
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
        setAuthError('Бул PIN-калыбына келтирүү шилтемеси жараксыз же мөөнөтү бүткөн.');
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
    const isPassword=selectedCompany?.authType==='password';
    const secret=String(f.get(isPassword?'password':'pin')||'');
    if(isPassword){
      if(!secret){setAuthError('Парольду жазыңыз');return;}
    }else if(!/^\d{8}$/.test(secret)){
      setAuthError('PIN так 8 цифра болушу керек');return;
    }
    setAuthBusy(true);
    try{
      await signInWithEmailAndPassword(auth,selectedCompany.email,secret);
    }catch(err){
      setAuthError(isPassword?'Email же пароль туура эмес':'PIN туура эмес');
    }finally{setAuthBusy(false)}
  };
  const resetPassword=async()=>{
    if(!selectedCompany?.email)return;
    setAuthBusy(true);setAuthError('');
    try{
      await sendPasswordResetEmail(auth,selectedCompany.email);
      setAuthError('Пароль/PIN алмаштыруу шилтемеси email дарегине жөнөтүлдү.');
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

  const deleteSelected=async()=>{
    if(selectedIds.length===0)return;
    if(!window.confirm(`Тандалган ${selectedIds.length} тендерди өчүрүүнү каалайсызбы?`))return;

    setBusy(true);
    try{await Promise.all(selectedIds.map(id=>deleteDoc(doc(db,'tenders',id))));setSelectedIds([]);setNotice('Тандалган тендерлер өчүрүлдү');}
    catch(err){reportError(err)}finally{setBusy(false)}
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
    const isPassword=switchCompany.authType==='password';
    if(!isPassword && !/^\d{8}$/.test(switchSecret)){
      setSwitchError('PIN так 8 цифра болушу керек');
      return;
    }
    if(isPassword && !switchSecret){
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
      setSwitchError(isPassword?'Пароль туура эмес':'PIN туура эмес');
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
                    <h2>Тендерлер {headerExecutorTitle ? `— ${headerExecutorTitle}` : ''}</h2>
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

      {active&&docsOpen&&
        <Documents
          t={active}
          update={update}
          close={()=>setDocsOpen(false)}
        />
      }

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

function ResetPinPage({verified,email,error,busy,save}){
  return(
    <div className="authScreen">
      <div className="loginCard resetPinCard">
        <div className="authLogo">TF</div>
        <small>ПАРОЛДУ КАЛЫБЫНА КЕЛТИРҮҮ</small>
        <h1>Жаңы пароль</h1>
        <p>{verified ? `${email} үчүн жаңы пароль жазыңыз.` : 'Шилтеме текшерилип жатат...'}</p>
        {verified&&(
          <form onSubmit={save} className="authForm">
            <label>Жаңы пароль<input name="password" type="password" minLength="6" required autoFocus autoComplete="new-password"/></label>
            <label>Парольду кайталаңыз<input name="repeatPassword" type="password" minLength="6" required autoComplete="new-password"/></label>
            <small className="pinHint">Кеминде 6 символ. Тамга, цифра жана башка символдорду колдонсоңуз болот.</small>
            {error&&<div className="authError">{error}</div>}
            <button className="primary authSubmit" disabled={busy}>{busy?'Сакталууда...':'Парольду сактоо'}</button>
          </form>
        )}
        {!verified&&error&&<div className="authError resetError">{error}</div>}
      </div>
    </div>
  );
}

function CompanyAuth({
  companies,
  mode,
  setMode,
  selected,
  setSelected,
  error,
  busy,
  createAccount,
  login,
  resetPassword
}){
  if(selected){
    return(
      <div className="authScreen">
        <div className="loginCard compactLogin">
          <button className="authBack" onClick={()=>setSelected(null)}>
            ← Артка
          </button>

          <div className="authLogo">TF</div>
          <small>КОМПАНИЯГА КИРҮҮ</small>
          <h1>{selected.name}</h1>
          <p>{selected.authType==='password'?'Кирүү үчүн паролуңузду жазыңыз':'Кирүү үчүн 8 цифралык PIN-кодуңузду жазыңыз'}</p>

          <form onSubmit={login} className="authForm">
            <label>
              {selected.authType==='password'?'Пароль':'PIN-код'}
              {selected.authType==='password'
                ? <input name="password" type="password" required autoFocus autoComplete="current-password" placeholder="Пароль"/>
                : <PinInput name="pin" length={8} autoFocus/>}
            </label>

            {error&&<div className="authError">{error}</div>}

            <button
              className="pinArrowSubmit"
              disabled={busy}
              aria-label="Кирүү"
              title="Кирүү"
            >
              {busy ? <span className="pinArrowSpinner"/> : <ArrowRight/>}
            </button>

            <button
              type="button"
              className="forgotBtn"
              onClick={resetPassword}
            >
              {selected.authType==='password'?'Забыли пароль?':'Забыли PIN-код?'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if(mode==='create'){
    return(
      <div className="authScreen">
        <div className="loginCard">
          <button className="authBack" onClick={()=>setMode('companies')}>
            ← Артка
          </button>

          <div className="authLogo">TF</div>
          <small>ЖАҢЫ АККАУНТ</small>
          <h1>Создать аккаунт</h1>
          <p>Компанияңыз үчүн TenderFlow аккаунтун түзүңүз</p>

          <form onSubmit={createAccount} className="authForm">
            <label>
              Компаниянын аты
              <input name="company" required placeholder="Мисалы: АлаТоо групп"/>
            </label>

            <label>
              Email
              <input name="email" type="email" required placeholder="company@email.com"/>
            </label>

            <label>
              Пароль
              <input name="password" type="password" minLength="6" required autoComplete="new-password" placeholder="Кеминде 6 символ"/>
            </label>
            <label>
              Парольду кайталаңыз
              <input name="repeatPassword" type="password" minLength="6" required autoComplete="new-password" placeholder="Парольду кайра жазыңыз"/>
              <small className="pinHint">Жаңы аккаунттар кадимки пароль менен кирет.</small>
            </label>

            {error&&<div className="authError">{error}</div>}

            <button className="primary authSubmit" disabled={busy}>
              {busy?'Түзүлүүдө...':'Создать аккаунт'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return(
    <div className="authScreen">
      <div className="companyPicker">
        <div className="authLogo">TF</div>
        <small>TENDERFLOW</small>
        <h1>Компаниялар</h1>
        <p>Кирүү үчүн компанияңызды тандаңыз</p>

        <div className="companyList">
          {companies.map(company=>(
            <button
              key={company.uid||company.docId}
              className="companyCard"
              onClick={()=>setSelected(company)}
            >
              <span className="companyAvatar">
                {(company.name||'К').slice(0,2).toUpperCase()}
              </span>
              <span>
                <b>{company.name}</b>
                <small>Аккаунтка кирүү</small>
              </span>
              <strong>›</strong>
            </button>
          ))}

          {companies.length===0&&(
            <div className="noCompanies">
              Азырынча компания каттала элек
            </div>
          )}
        </div>

        <button
          className="primary createCompanyBtn"
          onClick={()=>setMode('create')}
        >
          <Plus/>
          Создать аккаунт
        </button>
      </div>
    </div>
  );
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

function Documents({t,update,close}){
  const[drafts,setDrafts]=useState(t.docs||{});
  const[term,setTerm]=useState('');
  const[categoryTerm,setCategoryTerm]=useState('');
  const[selected,setSelected]=useState(DOCS.find(k=>!t.docs?.[k])||DOCS[0]);
  const[custom,setCustom]=useState('');
  const[busy,setBusy]=useState(false);
  const[saving,setSaving]=useState(false);
  const[error,setError]=useState('');
  const[preview,setPreview]=useState(null);
  const picker=useRef(null);
  const uploadLock=useRef(false);
  const category=selected==='Другие документы'&&custom.trim() ? custom.trim() : selected;
  const attach=async(file,name=category)=>{
    if(!file||!name||uploadLock.current)return;
    uploadLock.current=true;setBusy(true);setError('');
    try{const uploaded=await uploadToCloudinary(file,t.id,name);setDrafts(d=>({...d,[name]:uploaded}));}
    catch(e){setError('Жүктөө ишке ашкан жок: '+e.message);}
    finally{uploadLock.current=false;setBusy(false);if(picker.current)picker.current.value='';}
  };
  const save=async()=>{setSaving(true);setError('');try{const ok=await update(tenderKey(t),{docs:drafts});if(ok)close();else setError('Сактоо ишке ашкан жок. Кайра аракет кылыңыз.');}catch(e){setError(e.message);}finally{setSaving(false);}};
  const entries=Object.entries(drafts).filter(([k,v])=>matches(k+' '+v?.name,term));
  return <div className="drawerShade"><div className="docsModal" role="dialog" aria-modal="true" aria-label="Тендердин документтери">
    <button className="close" aria-label="Жабуу" disabled={busy||saving} onClick={close}><X/></button>
    <small>ДОКУМЕНТТЕР • {t.id}</small><h2>Документтерди тиркөө</h2><p className="tenderContext">{t.name}</p><p className="modalSub">Аткаруучу: {t.executor||'—'} · Өзгөртүүлөрдү сактоону унутпаңыз</p>
    <div className="documentWorkspace"><section className="categoryPanel"><h3><span>1</span> Документтин түрүн тандаңыз</h3>
      <input aria-label="Документтин түрүн издөө" placeholder="Документтин түрүн издөө…" value={categoryTerm} onChange={e=>setCategoryTerm(e.target.value)}/>
      <div className="categoryList">{Object.entries(DOC_GROUPS).map(([group,names])=>{const filtered=names.filter(n=>matches(n,categoryTerm));return filtered.length>0&&<div key={group}><h4>{group}</h4>{filtered.map(name=><button type="button" key={name} className={'categoryChoice '+(selected===name?'selected':'')} disabled={busy} onClick={()=>setSelected(name)}><FileText size={15}/><span>{name}</span>{drafts[name]&&<CheckCircle2 size={15}/>}</button>)}</div>;})}</div>
    </section><section className="uploadPanel"><h3><span>2</span> Файлды тиркеңиз</h3><b className="selectedCategory">{category}</b>
      {selected==='Другие документы'&&<input aria-label="Документтин аталышы" placeholder="Өзүңүздүн документтин аталышы" value={custom} onChange={e=>setCustom(e.target.value)}/>}
      <input ref={picker} type="file" hidden onChange={e=>attach(e.target.files?.[0])}/>
      <button type="button" className="dropZone" disabled={busy||saving} onClick={()=>picker.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!saving)attach(e.dataTransfer.files?.[0]);}}><Upload size={32}/><b>{busy?'Файл жүктөлүүдө…':'Файлды тандаңыз же ушул жерге таштаңыз'}</b><span>PDF · Word · Excel · сүрөт · башка форматтар</span><strong className="browsePill">Компьютерден файл тандоо</strong><small>{drafts[category]?'Бул түрдөгү мурдагы файл алмаштырылат':'Бир түргө бир файл тиркелет'}</small></button>
      {error&&<p className="authError" role="alert">{error}</p>}
      <label className="librarySearch"><Search size={16}/><input aria-label="Тиркелген файлдарды издөө" placeholder="Тиркелген файлдарды издөө…" value={term} onChange={e=>setTerm(e.target.value)}/></label>
      <h3 className="attachedHeading">Тиркелген документтер <span>{Object.keys(drafts).length}</span></h3><div className="docList">{entries.length===0?<div className="docsEmpty"><FolderOpen/><b>{term?'Файл табылган жок':'Документ тиркеле элек'}</b></div>:entries.map(([name,file])=><div className="docItem ready" key={name}><div className="docState"><FileText/></div><div className="docName"><b>{name}</b><small>{file.name} · {fileSize(file.size)}</small></div><button className="filesBtn" disabled={!file.url} onClick={()=>setPreview(file)}>Ачуу</button><button className="downloadBtn" onClick={()=>downloadCloudFile(file.url,file.name)} aria-label="Жүктөп алуу"><Download size={16}/></button><button className="miniDel" disabled={busy||saving} aria-label="Документти өчүрүү" onClick={()=>setDrafts(d=>{const n={...d};delete n[name];return n;})}><Trash2 size={16}/></button></div>)}</div>
    </section></div><div className="docsFooter"><span>{Object.keys(drafts).length} документ тиркелген</span><button className="primary saveBtn" disabled={busy||saving} onClick={save}><Save size={17}/>{saving?'Сакталууда…':'Өзгөртүүлөрдү сактоо'}</button></div>
    {preview&&<FilePreview file={preview} close={()=>setPreview(null)}/>}
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
      const response=await fetch(file.url,{signal:controller.signal});if(!response.ok)throw new Error(`Сервер файлды берген жок (${response.status})`);
      const bytes=await response.arrayBuffer();if(!alive)return;
      if(['docx'].includes(ext)){
        const mammoth=await import('mammoth/mammoth.browser.js');const result=await (mammoth.default||mammoth).convertToHtml({arrayBuffer:bytes});if(alive)setView({kind:'word',html:result.value});
      }else if(['xlsx','xls','csv','ods'].includes(ext)){
        const XLSX=await import('xlsx');const workbook=XLSX.read(bytes,{type:'array'});if(alive)setView({kind:'sheets',sheets:workbook.SheetNames.map(name=>({name,rows:XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:false})}))});
      }else if(ext==='pdf'||file.type==='application/pdf'){
        objectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));if(alive)setView({kind:'pdf',url:objectUrl});
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
    {error?<div className="docsEmpty" role="alert"><b>Файлды көрсөтүү мүмкүн болгон жок</b><p>{error}</p><small>Файлдын жеткиликтүүлүгүн жана Cloudinary CORS жөндөөсүн текшериңиз.</small></div>:!view?<div className="docsEmpty" role="status">Файл ачылууда…</div>:view.kind==='pdf'?<iframe title={file.name} src={view.url}/>:view.kind==='image'?<img alt={file.name} src={view.url}/>:view.kind==='word'?<iframe title={file.name} sandbox="" srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{font:16px/1.7 system-ui;background:white;padding:35px;max-width:850px;margin:auto;color:#27324a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}img{max-width:100%}</style> </head><body>${view.html}</body></html>`}/>:view.kind==='text'?<pre>{view.text}</pre>:view.kind==='sheets'?<><div className="sheetTabs">{view.sheets.map((s,i)=><button key={s.name} className={sheet===i?'selected':''} onClick={()=>setSheet(i)}>{s.name}</button>)}</div><div className="sheetScroll"><table><tbody>{view.sheets[sheet]?.rows.map((row,i)=><tr key={i}><th>{i+1}</th>{row.map((cell,j)=><td key={j}>{String(cell)}</td>)}</tr>)}</tbody></table></div></>:view.kind==='audio'?<audio controls src={view.url}/>:view.kind==='video'?<video controls src={view.url}/>:<div className="docsEmpty"><FileText/><b>Бул форматтын браузерде алдын ала көрүнүшү жок</b><p>Файлды жүктөп алып, тиешелүү программада ачыңыз. Эски .doc үчүн .docx форматын колдонуңуз.</p></div>}
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

