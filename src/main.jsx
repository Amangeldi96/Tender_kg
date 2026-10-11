import React,{useMemo,useRef,useState} from 'react';
import{createRoot}from'react-dom/client';
import{collection,deleteDoc,doc,getDocs,setDoc}from'firebase/firestore';
import{db}from'./firebase';
import{
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset
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
  ArrowRight,
  ChevronDown,
  ChevronRight,
  User
}from'lucide-react';
import'./style.css';

const DOCS=[
  'Таблица цен',
  'Техническая спецификация',
  'Коммерческое предложение',
  'Сертификат соответствия',
  'Декларация соответствия',
  'Гарантийное письмо',
  'Реквизиты компании',
  'Справка об отсутствии задолженности',
  'Лицензия / разрешительные документы',
  'Другие документы'
];

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

const auth=getAuth();

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
    return JSON.parse(localStorage.getItem('tf-v3'))||seed
  }catch{
    return seed
  }
};

const persist=v=>
  localStorage.setItem('tf-v3',JSON.stringify(v));

const niceDate=v=>v||'—';

const CLOUDINARY_CLOUD_NAME='tender';
const CLOUDINARY_UPLOAD_PRESET='tender';

async function uploadToCloudinary(file,tenderId,docName){
  const form=new FormData();
  form.append('file',file);
  form.append('upload_preset',CLOUDINARY_UPLOAD_PRESET);
  form.append('folder',`tenderflow/${tenderId}`);

  const res=await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`,
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

function App(){

  const[tenders,setTenders]=useState(read);
  const[active,setActive]=useState(null);
  const[addOpen,setAddOpen]=useState(false);
  const[docsOpen,setDocsOpen]=useState(false);
  const[q,setQ]=useState('');
  const[page,setPage]=useState('tenders');
  const[payStatusModal,setPayStatusModal]=useState(null);

  const[selectedExecutor,setSelectedExecutor]=useState(null);
  const[selectedIds,setSelectedIds]=useState([]);
  const[openAccordionMap,setOpenAccordionMap]=useState({});
  const[openExecutorsNav,setOpenExecutorsNav]=useState({});

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

    getDocs(collection(db,'companies'))
      .then(snap=>{
        const remote=snap.docs.map(d=>({docId:d.id,...d.data()}));
        const remoteCompanies=remote.filter(company=>company?.email);
        setCompanies(remoteCompanies);
        saveCompanyCache(remoteCompanies);
      })
      .catch(err=>{
        console.error('Companies load error:',err);
        setCompanies(cached);
      });
  },[authReady,user]);

  React.useEffect(()=>{
    if(!user)return;

    let alive=true;

    (async()=>{
      try{
        const snap=await getDocs(collection(db,'tenders'));
        const remote=snap.docs.map(d=>d.data());

        if(alive && remote.length>0){
          const localData=read();
          const merged=[...remote];
          localData.forEach(item=>{
            if(!merged.some(m=>m.id===item.id)){
              merged.push(item);
            }
          });
          setTenders(merged);
          persist(merged);
        }
      }catch(err){
        console.error('Firebase load error:',err);
      }
    })();

    return()=>{alive=false};
  },[user]);

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
    return map;
  },[tenders]);

  const filtered=useMemo(()=>{
    return tenders.filter(t=>{
      const matchesQuery=(t.id+t.org+t.name+(t.executor||''))
        .toLowerCase()
        .includes(q.toLowerCase());

      if(selectedExecutor){
        return matchesQuery && (t.executor||'Аткаруучу көрсөтүлгөн эмес')===selectedExecutor;
      }
      return matchesQuery;
    });
  },[tenders,q,selectedExecutor]);

  const selectedTenders=useMemo(()=>{
    return tenders.filter(t=>selectedIds.includes(t.id));
  },[tenders,selectedIds]);

  const selectedExecutorsSet=useMemo(()=>{
    const set=new Set();
    selectedTenders.forEach(t=>set.add(t.executor||'Аткаруучу көрсөтүлгөн эмес'));
    return Array.from(set);
  },[selectedTenders]);

  const headerExecutorTitle=useMemo(()=>{
    if(selectedExecutor) return selectedExecutor;
    if(selectedExecutorsSet.length>0) return selectedExecutorsSet.join(', ');
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
    setSelectedIds(prev=>
      prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]
    );
  };

  const toggleSelectAll=()=>{
    if(selectedIds.length===filtered.length){
      setSelectedIds([]);
    }else{
      setSelectedIds(filtered.map(t=>t.id));
    }
  };

  const deleteSelected=()=>{
    if(selectedIds.length===0)return;
    if(!window.confirm(`Тандалган ${selectedIds.length} тендерди өчүрүүнү каалайсызбы?`))return;

    const a=tenders.filter(t=>!selectedIds.includes(t.id));
    setTenders(a);
    persist(a);

    selectedIds.forEach(id=>{
      deleteDoc(doc(db,'tenders',id)).catch(err=>console.error('Delete error:',err));
    });

    setSelectedIds([]);
  };

  const update=(id,patch)=>{
    const a=tenders.map(t=>
      t.id===id
        ?{...t,...patch}
        :t
    );

    setTenders(a);
    persist(a);

    const changed=a.find(t=>t.id===id);
    if(changed){
      setDoc(doc(db,'tenders',id),changed)
        .catch(err=>console.error('Firebase save error:',err));
    }

    setActive(x=>
      x?.id===id
        ?{...x,...patch}
        :x
    );
  };

  function add(e){
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

    let a=[t,...tenders];

    setTenders(a);
    persist(a);
    setDoc(doc(db,'tenders',t.id),t)
      .catch(err=>console.error('Firebase add error:',err));

    setAddOpen(false);
  }

  const startPayment=t=>{
    setPaymentEditId(t.id);
    setPaymentValue(
      t.paid>0
        ?String(t.paid)
        :''
    );
  };

  const savePayment=t=>{
    let value=Number(paymentValue||0);
    if(value<0)value=0;
    if(value>Number(t.sum))value=Number(t.sum);

    update(t.id,{paid:value});
    setPaymentEditId(null);
    setPaymentValue('');
  };

  const startEdit=t=>{
    setPaymentEditId(null);
    setEditingId(t.id);
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

  const saveEdit=oldId=>{
    if(!editDraft)return;

    const oldTender=tenders.find(t=>t.id===oldId);
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

    const a=tenders.map(t=>t.id===oldId?newTender:t);

    setTenders(a);
    persist(a);

    setDoc(doc(db,'tenders',newTender.id),newTender)
      .then(()=>{
        if(newTender.id!==oldId){
          return deleteDoc(doc(db,'tenders',oldId));
        }
      })
      .catch(err=>console.error('Firebase edit error:',err));

    if(active?.id===oldId){
      setActive(newTender);
    }

    setEditingId(null);
    setEditDraft(null);
  };

  const logout=async()=>{
    await signOut(auth);
    setAuthMode('companies');
    setSelectedCompany(null);
    setAuthError('');
  };

  if(!authReady){
    return(
      <div className="authScreen">
        <div className="authLoading">TenderFlow жүктөлүүдө...</div>
      </div>
    );
  }

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
        createAccount={()=>{}}
        login={()=>{}}
        resetPassword={()=>{}}
      />
    );
  }

  // ТАБЛИЦА СТАКТАЛГАН ТОЛУК СТИЛЬ КОЛОНКАЛАРЫ
  const tableGridStyle = {
    gridTemplateColumns: '40px 35px 140px 110px minmax(180px, 1fr) 110px 110px 90px 85px 95px 100px 80px 50px'
  };

  return(
    <div className="shell">

      <aside>
        <div className="brand">
          <div className="logo">TF</div>
          <div>
            <b>TenderFlow</b>
            <small>PROCUREMENT</small>
          </div>
        </div>

        <nav>
          <a
            className={page==='tenders' && !selectedExecutor ?'on':''}
            onClick={()=>{
              setPage('tenders');
              setSelectedExecutor(null);
              setQ('');
            }}
          >
            <LayoutDashboard/>
            Тендерлер
          </a>

          <div className="navAccordionSection" style={{marginTop:'8px',paddingLeft:'8px',paddingRight:'8px'}}>
            <div style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:'700',marginBottom:'6px',letterSpacing:'0.5px'}}>
              АТКАРУУЧУЛАР
            </div>
            {Object.entries(executorsGroup).map(([execName, execTenders])=>{
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
                          key={t.id}
                          onClick={()=>{
                            setPage('tenders');
                            setSelectedExecutor(execName);
                            setQ(t.name);
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

          <a
            className={page==='files'?'on':''}
            onClick={()=>{
              setPage('files');
              setSelectedExecutor(null);
            }}
            style={{marginTop:'8px'}}
          >
            <FileText/>
            Файлдар
          </a>

          <a>
            <Settings/>
            Настройки
          </a>
        </nav>

        <div className="navbottom">
          <div className="user">
            <div className="avatar">
              {(user.email||'A').slice(0,2).toUpperCase()}
            </div>
            <div className="loggedUserText">
              <b>{companies.find(c=>c.email===user.email)?.name||'Компания'}</b>
              <small>Администратор</small>
            </div>
            <button className="logoutBtn" onClick={logout} title="Выйти">
              <X/>
            </button>
          </div>
        </div>
      </aside>

      <main>
        {page==='tenders' ? (
          <>
            <header>
              <div>
                <small>ТЕНДЕР БАШКАРУУ</small>
                <h1>Тендерлер</h1>
                <p>Тендер, төлөм жана документтер бир жерде</p>
              </div>

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
                value={tenders.filter(t=>t.gopp&&t.goppPaid).length}
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
                  <h2>
                    Таблица {headerExecutorTitle ? `— ${headerExecutorTitle}` : ''}
                  </h2>
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

              {/* ГАРМОШКА - СЕКЦИЯСЫ ТАНДАЛГАН ТЕНДЕРЛЕР БАР БОЛГОНДО ГАНА КӨРҮНӨТ */}
              {selectedExecutorsSet.length>0 && (
                <div style={{
                  margin:'12px 16px 16px 16px',
                  padding:'16px',
                  background:'rgba(241, 245, 249, 0.8)',
                  borderRadius:'12px',
                  border:'1px solid #e2e8f0',
                  boxShadow:'0 2px 6px rgba(0,0,0,0.02)'
                }}>
                  <div style={{fontSize:'11px',fontWeight:'800',color:'#64748b',marginBottom:'10px',letterSpacing:'0.5px'}}>
                    ТАНДАЛГАН ТЕНДЕРЛЕРДИН АТКАРУУЧУЛАРЫ (ГАРМОШКА)
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                    {selectedExecutorsSet.map(execName=>{
                      const isOpen=!!openAccordionMap[execName];
                      const execTenders=selectedTenders.filter(t=>(t.executor||'Аткаруучу көрсөтүлгөн эмес')===execName);

                      return(
                        <div key={execName} style={{
                          border:'1px solid #cbd5e1',
                          borderRadius:'8px',
                          overflow:'hidden',
                          background:'#ffffff'
                        }}>
                          <button
                            type="button"
                            onClick={()=>setOpenAccordionMap(prev=>({...prev,[execName]:!prev[execName]}))}
                            style={{
                              width:'100%',
                              padding:'10px 14px',
                              background:'#ffffff',
                              border:'none',
                              display:'flex',
                              justifyContent:'space-between',
                              alignItems:'center',
                              cursor:'pointer',
                              fontWeight:'600',
                              fontSize:'13px',
                              color:'var(--text-main)'
                            }}
                          >
                            <span style={{display:'flex',alignItems:'center',gap:'8px'}}>
                              <User size={15} color="#475569"/>
                              <b>{execName}</b>
                              <span style={{
                                background:'#e2e8f0',
                                padding:'2px 8px',
                                borderRadius:'12px',
                                fontSize:'11px',
                                color:'#475569'
                              }}>
                                {execTenders.length} тендер
                              </span>
                            </span>
                            {isOpen ? <ChevronDown size={15} color="#475569"/> : <ChevronRight size={15} color="#475569"/>}
                          </button>

                          {isOpen&&(
                            <div style={{padding:'10px 14px',background:'#f8fafc',borderTop:'1px solid #f1f5f9',fontSize:'12px'}}>
                              {execTenders.map(t=>(
                                <div key={t.id} style={{padding:'6px 0',display:'flex',justifyContent:'space-between',borderBottom:'1px dashed #e2e8f0'}}>
                                  <span><b>№ {t.id}</b> — {t.name} ({t.org})</span>
                                  <b style={{color:'var(--primary)'}}>{money(t.sum)}</b>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ТАБЛИЦА */}
              <div className="bigTable" style={{minWidth:'1250px'}}>
                <div className="row head" style={tableGridStyle}>
                  <span style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <input
                      type="checkbox"
                      checked={filtered.length>0 && selectedIds.length===filtered.length}
                      onChange={toggleSelectAll}
                      style={{cursor:'pointer',width:'14px',height:'14px'}}
                    />
                  </span>
                  <span>№</span>
                  <span>Тендер номер</span>
                  <span>Мекемелер</span>
                  <span>Lot аталышы</span>
                  <span>Суммасы</span>
                  <span>Төлөнгөн суммалар</span>
                  <span>ГОПП</span>
                  <span>ГОИК</span>
                  <span>Таблица цен</span>
                  <span>Срок вскрытия</span>
                  <span>Файлдар</span>
                  <span style={{textAlign:'center'}}>Оңдоо</span>
                </div>

                {filtered.map((t,i)=>{
                  const editing=editingId===t.id;
                  const paymentEditing=paymentEditId===t.id;
                  const isChecked=selectedIds.includes(t.id);

                  return(
                    <div
                      className={'row '+(editing?'editingRow':'')}
                      key={t.id}
                      style={tableGridStyle}
                    >
                      {/* ЧЕКБОКС */}
                      <span style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={()=>toggleSelect(t.id)}
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
                      <span>
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
                      <span style={{fontWeight:'500'}}>
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
                              <Save/>
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
                      <span style={{whiteSpace:'nowrap',fontSize:'11px',color:'#475569'}}>
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
                            onClick={()=>saveEdit(t.id)}
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
        ) : (
          <FilesPage
            tenders={tenders}
            openDocs={t=>{
              setActive(t);
              setDocsOpen(true);
            }}
          />
        )}
      </main>

      {/* ТЕНДЕР КОШУУ МОДАЛКАСЫ */}
      {addOpen&&
        <Modal close={()=>setAddOpen(false)}>
          <form onSubmit={add}>
            <small>ЖАҢЫ ТЕНДЕР</small>
            <h2>Тендер кошуу</h2>

            <div className="fields">
              <label>
                Тендер номер *
                <input name="id" required/>
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
                Товардын / Lot аталышы *
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

            <button className="primary submit">
              <Plus/>
              Добавить
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

function PinInput({name,autoFocus=false}){
  const[value,setValue]=useState('');
  const inputRef=useRef(null);

  const change=e=>{
    setValue(e.target.value.replace(/\D/g,'').slice(0,8));
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
        maxLength="8"
        autoComplete="off"
        autoFocus={autoFocus}
      />
      <div className="pinBoxes">
        {Array.from({length:8}).map((_,i)=>(
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
        <small>PIN-КОДДУ КАЛЫБЫНА КЕЛТИРҮҮ</small>
        <h1>Жаңы PIN-код</h1>
        <p>
          {verified
            ?'Жаңы 8 цифралык PIN-кодду эки жолу жазыңыз.'
            :'Шилтеме текшерилип жатат...'}
        </p>

        {verified&&(
          <form onSubmit={save} className="authForm">
            <label>
              Жаңы PIN-код
              <PinInput name="pin" autoFocus/>
            </label>

            <label>
              PIN-кодду кайталаңыз
              <PinInput name="repeatPin"/>
            </label>

            {error&&<div className="authError">{error}</div>}

            <button className="primary authSubmit" disabled={busy}>
              {busy?'Сакталууда...':'Сохранить PIN'}
            </button>
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
          <p>Кирүү үчүн пароль гана жазыңыз</p>

          <form onSubmit={login} className="authForm">
            <label>
              PIN-код
              <PinInput name="pin" autoFocus/>
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
              Забыли PIN-код?
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
              PIN-код
              <PinInput name="pin"/>
              <small className="pinHint">Так 8 цифра</small>
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
      <button
        type="button"
        className="pill red clickable"
        onClick={openStatus}
      >
        ✕ Жок
      </button>
    );
  }

  const status=
    t[type+'Status'] ||
    (t[type+'Paid']?'paid':'unpaid');

  const meta={
    unpaid:{label:'Төлөнө элек',cls:'red'},
    waiting:{label:'Күтүлүүдө',cls:'yellow'},
    paid:{label:'Төлөндү',cls:'green'}
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
    update(t.id,{
      [type+'Status']:status,
      [type+'Paid']:status==='paid'
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
          <button
            type="button"
            className={'statusChoice red '+(current==='unpaid'?'selected':'')}
            onClick={()=>choose('unpaid')}
          >
            <span className="statusDot"/>
            <div>
              <b>Төлөнө элек</b>
              <small>Төлөм жасала элек</small>
            </div>
          </button>

          <button
            type="button"
            className={'statusChoice yellow '+(current==='waiting'?'selected':'')}
            onClick={()=>choose('waiting')}
          >
            <span className="statusDot"/>
            <div>
              <b>Күтүлүүдө</b>
              <small>Төлөм текшерилип же күтүлүп жатат</small>
            </div>
          </button>

          <button
            type="button"
            className={'statusChoice green '+(current==='paid'?'selected':'')}
            onClick={()=>choose('paid')}
          >
            <span className="statusDot"/>
            <div>
              <b>Төлөндү</b>
              <small>Төлөм толук аткарылды</small>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function FilesPage({tenders,openDocs}){
  const[openTenderDocs,setOpenTenderDocs]=useState({});

  const toggleTenderDocs=tenderId=>{
    setOpenTenderDocs(prev=>({...prev,[tenderId]:!prev[tenderId]}));
  };

  const totalFilesCount=tenders.reduce(
    (a,t)=>a+Object.keys(t.docs||{}).length,
    0
  );

  return(
    <>
      <header>
        <div>
          <small>ДОКУМЕНТТЕР БАЗАСЫ</small>
          <h1>Файлдар</h1>
          <p>Ар бир тендердин документтери гармошка стилинде</p>
        </div>
      </header>

      <section className="stats">
        <Stat icon={<FileText/>} label="Бардык файлдар" value={totalFilesCount}/>
        <Stat
          icon={<Briefcase/>}
          label="Документи бар тендер"
          value={tenders.filter(t=>Object.keys(t.docs||{}).length>0).length}
        />
      </section>

      <div className="panel tablePanel filesPagePanel">
        <div className="panelhead">
          <div>
            <small>ТЕНДЕРЛЕР ЖАНА ДОКУМЕНТТЕР</small>
            <h2>Документтер (Гармошка)</h2>
          </div>
          <span className="count">{tenders.length} тендер</span>
        </div>

        {tenders.length===0 ? (
          <div className="docsEmpty filesPageEmpty">
            <FolderOpen/>
            <b>Азырынча тендер жок</b>
          </div>
        ) : (
          <div className="accordionContainer">
            {tenders.map(tender=>{
              const isTenderOpen=!!openTenderDocs[tender.id];
              const docEntries=Object.entries(tender.docs||{});

              return(
                <div className="tenderAccordionSubGroup" key={tender.id}>
                  <button
                    type="button"
                    className="tenderAccordionHeader"
                    onClick={()=>toggleTenderDocs(tender.id)}
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
                              onClick={()=>openDocs(tender)}
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
    </>
  );
}

function Documents({
  t,
  update,
  close
}){

  const[drafts,setDrafts]=useState(t.docs||{});
  const[adding,setAdding]=useState(false);
  const[selectedDoc,setSelectedDoc]=useState('');
  const inputs=useRef({});

  const attach=async(name,file)=>{
    if(!file)return;

    try{
      const uploaded=await uploadToCloudinary(file,t.id,name);
      setDrafts(d=>({...d,[name]:uploaded}));
      setAdding(false);
      setSelectedDoc('');
    }catch(err){
      console.error(err);
      alert("Файлды Cloudinary'ге жүктөөдө ката: "+err.message);
    }
  };

  const del=async name=>{
    setDrafts(d=>{
      const n={...d};
      delete n[name];
      return n;
    });
  };

  const save=()=>{
    update(t.id,{docs:drafts});
    close();
  };

  const addedDocs=Object.keys(drafts);
  const availableDocs=DOCS.filter(name=>!drafts[name]);

  return(
    <div className="drawerShade">
      <div className="docsModal">
        <button className="close" onClick={close}>
          <X/>
        </button>

        <small>ТЕНДЕР: {t.name} (АТКАРУУЧУ: {t.executor||'Жок'})</small>
        <h2>Документтер</h2>
        <p className="modalSub">
          Бул жерде тендерге кошулган документтер башкарылат.
        </p>

        <div className="docList">
          {addedDocs.length===0 ? (
            <div className="docsEmpty">
              <FileText/>
              <b>Документ кошула элек</b>
              <small>Төмөнкү «Добавить документ» кнопкасы менен документ кошуңуз.</small>
            </div>
          ) : (
            addedDocs.map(name=>{
              const doc=drafts[name];

              return(
                <div className="docItem ready" key={name}>
                  <div className="docState">
                    <CheckCircle2/>
                  </div>

                  <div className="docName">
                    <b>{name}</b>
                    <small>{doc.name}</small>
                  </div>

                  <input
                    ref={el=>inputs.current[name]=el}
                    type="file"
                    hidden
                    onChange={e=>attach(name,e.target.files?.[0])}
                  />

                  <button
                    type="button"
                    className="downloadBtn"
                    title="Скачать"
                    onClick={()=>downloadCloudFile(doc.url,doc.name)}
                  >
                    <Download/>
                    Скачать
                  </button>

                  <button
                    type="button"
                    className="replace"
                    onClick={()=>inputs.current[name]?.click()}
                  >
                    <Upload/>
                    Алмаштыруу
                  </button>

                  <button
                    type="button"
                    className="miniDel"
                    title="Өчүрүү"
                    onClick={()=>del(name)}
                  >
                    <Trash2/>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {adding&&(
          <div className="addDocumentBox">
            <div className="addDocumentHead">
              <div>
                <small>ЖАҢЫ ДОКУМЕНТ</small>
                <b>Кайсы документти кошосуз?</b>
              </div>

              <button
                type="button"
                className="cancelAddDoc"
                onClick={()=>{
                  setAdding(false);
                  setSelectedDoc('');
                }}
              >
                <X/>
              </button>
            </div>

            {availableDocs.length===0 ? (
              <div className="allDocsAdded">
                <CheckCircle2/>
                Бардык документтер кошулган
              </div>
            ) : (
              <>
                <select
                  className="documentSelect"
                  value={selectedDoc}
                  onChange={e=>setSelectedDoc(e.target.value)}
                >
                  <option value="">Документти тандаңыз</option>
                  {availableDocs.map(name=>(
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>

                <input
                  ref={el=>{
                    if(selectedDoc){
                      inputs.current['__new__']=el;
                    }
                  }}
                  type="file"
                  hidden
                  onChange={e=>{
                    if(selectedDoc){
                      attach(selectedDoc,e.target.files?.[0]);
                    }
                  }}
                />

                <button
                  type="button"
                  className="chooseDocumentFile"
                  disabled={!selectedDoc}
                  onClick={()=>inputs.current['__new__']?.click()}
                >
                  <Paperclip/>
                  Файлды тандап кошуу
                </button>
              </>
            )}
          </div>
        )}

        <button
          type="button"
          className="addDocumentBtn"
          onClick={()=>setAdding(v=>!v)}
        >
          <Plus/>
          Добавить документ
        </button>

        <div className="docsFooter">
          <span>{addedDocs.length} документ кошулган</span>
          <button className="primary saveBtn" onClick={save}>
            <Save/>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
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

createRoot(
  document.getElementById('root')
).render(
  <App/>
);