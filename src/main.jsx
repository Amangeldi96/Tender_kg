import React,{useMemo,useRef,useState} from 'react';
import{createRoot}from'react-dom/client';
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
  Download
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

const seed=[{
  id:'26091627861269',
  org:'ГСИН',
  name:'Кафель',
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



// Тиркелген файлдардын өзүн браузерде сактайбыз.
// IndexedDB колдонулгандыктан баракты жаңырткандан кийин да скачать кылса болот.
const DB_NAME='tenderflow-files';
const DB_STORE='files';

function openFileDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(DB_STORE)){
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function saveRealFile(key,file){
  const db=await openFileDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(file,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

async function deleteRealFile(key){
  const db=await openFileDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

async function downloadRealFile(key,fileName){
  const db=await openFileDB();
  const file=await new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readonly');
    const req=tx.objectStore(DB_STORE).get(key);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });

  if(!file){
    alert('Бул файлдын өзү браузерде табылган жок. Файлды кайра тиркеңиз.');
    return;
  }

  const url=URL.createObjectURL(file);
  const a=document.createElement('a');
  a.href=url;
  a.download=fileName||file.name||'document';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function App(){

  const[tenders,setTenders]=useState(read);
  const[active,setActive]=useState(null);
  const[addOpen,setAddOpen]=useState(false);
  const[docsOpen,setDocsOpen]=useState(false);
  const[q,setQ]=useState('');

  // Төлөнгөн сумманы өзгөртүү
  const[paymentEditId,setPaymentEditId]=useState(null);
  const[paymentValue,setPaymentValue]=useState('');

  // Таблицадагы тендерди өзгөртүү
  const[editingId,setEditingId]=useState(null);
  const[editDraft,setEditDraft]=useState(null);

  const filtered=tenders.filter(t=>
    (t.id+t.org+t.name)
      .toLowerCase()
      .includes(q.toLowerCase())
  );

  const total=useMemo(
    ()=>tenders.reduce(
      (a,b)=>a+Number(b.sum||0),
      0
    ),
    [tenders]
  );


  const update=(id,patch)=>{

    const a=tenders.map(t=>
      t.id===id
        ?{...t,...patch}
        :t
    );

    setTenders(a);
    persist(a);

    setActive(x=>
      x?.id===id
        ?{...x,...patch}
        :x
    );
  };


  const remove=id=>{

    const a=tenders.filter(
      t=>t.id!==id
    );

    setTenders(a);
    persist(a);
    setActive(null);
  };


  function add(e){

    e.preventDefault();

    let f=new FormData(
      e.currentTarget
    );

    let t={
      id:String(f.get('id')).trim(),
      org:String(f.get('org')).trim(),
      name:String(f.get('name')).trim(),
      sum:+f.get('sum'),
      paid:0,
      gopp:String(
        f.get('gopp')||''
      ).trim(),
      goik:String(
        f.get('goik')||''
      ).trim(),
      goppPaid:false,
      goikPaid:false,
      date:f.get('date'),
      docs:{}
    };

    let a=[t,...tenders];

    setTenders(a);
    persist(a);

    setAddOpen(false);
  }


  // =========================
  // ТӨЛӨНГӨН СУММА
  // =========================

  const startPayment=t=>{

    setPaymentEditId(t.id);

    setPaymentValue(
      t.paid>0
        ?String(t.paid)
        :''
    );
  };


  const savePayment=t=>{

    let value=Number(
      paymentValue||0
    );

    if(value<0){
      value=0;
    }

    // Тендердин жалпы суммасынан
    // көп төлөм киргизилбейт
    if(value>Number(t.sum)){
      value=Number(t.sum);
    }

    update(t.id,{
      paid:value
    });

    setPaymentEditId(null);
    setPaymentValue('');
  };


  // =========================
  // ИЗМЕНИТЬ
  // =========================

  const startEdit=t=>{

    // төлөм input ачык болсо жабабыз
    setPaymentEditId(null);

    setEditingId(t.id);

    setEditDraft({
      id:t.id,
      org:t.org,
      name:t.name,
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

    const oldTender=tenders.find(
      t=>t.id===oldId
    );

    if(!oldTender)return;

    const newId=
      String(editDraft.id||'').trim();

    const newSum=
      Math.max(
        0,
        Number(editDraft.sum)||0
      );

    let newPaid=
      Math.max(
        0,
        Number(editDraft.paid)||0
      );

    if(newPaid>newSum){
      newPaid=newSum;
    }

    const newTender={
      ...oldTender,
      ...editDraft,

      id:newId,
      org:String(
        editDraft.org||''
      ).trim(),

      name:String(
        editDraft.name||''
      ).trim(),

      sum:newSum,
      paid:newPaid,

      gopp:String(
        editDraft.gopp||''
      ).trim(),

      goik:String(
        editDraft.goik||''
      ).trim(),

      date:editDraft.date||''
    };


    // ГОПП өчүрүлсө статус дагы reset
    if(!newTender.gopp){
      newTender.goppPaid=false;
    }

    // ГОИК өчүрүлсө статус дагы reset
    if(!newTender.goik){
      newTender.goikPaid=false;
    }


    const a=tenders.map(t=>
      t.id===oldId
        ?newTender
        :t
    );

    setTenders(a);
    persist(a);


    if(active?.id===oldId){
      setActive(newTender);
    }


    setEditingId(null);
    setEditDraft(null);
  };


  return(
    <div className="shell">

      <aside>

        <div className="brand">

          <div className="logo">
            TF
          </div>

          <div>
            <b>TenderFlow</b>
            <small>
              PROCUREMENT
            </small>
          </div>

        </div>


        <nav>

          <a className="on">
            <LayoutDashboard/>
            Тендерлер
          </a>

          <a>
            <FileText/>
            Документтер
          </a>

          <a>
            <Settings/>
            Настройки
          </a>

        </nav>


        <div className="navbottom">

          <div className="user">

            <div className="avatar">
              КК
            </div>

            <div>
              <b>Кел кел</b>
              <small>
                Администратор
              </small>
            </div>

          </div>

        </div>

      </aside>


      <main>

        <header>

          <div>
            <small>
              ТЕНДЕР БАШКАРУУ
            </small>

            <h1>
              Тендерлер
            </h1>

            <p>
              Тендер, төлөм жана документтер бир жерде
            </p>
          </div>


          <div className="actions">

            <div className="search">

              <Search/>

              <input
                value={q}
                onChange={e=>
                  setQ(e.target.value)
                }
                placeholder="Тендер номер, мекеме, товар..."
              />

            </div>


            <button
              className="primary"
              onClick={()=>
                setAddOpen(true)
              }
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
            value={
              tenders.filter(
                t=>
                  t.gopp&&
                  t.goppPaid
              ).length
            }
          />

          <Stat
            icon={<FileText/>}
            label="Файлдар"
            value={
              tenders.reduce(
                (a,t)=>
                  a+
                  Object.keys(
                    t.docs||{}
                  ).length,
                0
              )
            }
          />

        </section>


        <div className="panel tablePanel">

          <div className="panelhead">

            <div>
              <small>
                КАТЫШЫП ЖАТКАН ТЕНДЕРЛЕР
              </small>

              <h2>
                Таблица
              </h2>
            </div>

            <span className="count">
              {filtered.length}
            </span>

          </div>


          <div className="bigTable">

            <div className="row head">

              <span>№</span>

              <span>
                тендер номер
              </span>

              <span>
                Мекемелер
              </span>

              <span>
                Lot аталышы
              </span>

              <span>
                суммасы
              </span>

              <span>
                төлөнгөн суммалар
              </span>

              <span>
                ГОПП
              </span>

              <span>
                ГОИК
              </span>

              <span>
                Таблица цен
              </span>

              <span>
                Срок вскрытия
              </span>

              <span>
                Файлдар
              </span>

              {/* Действие деген текст жок */}
              <span></span>

            </div>


            {filtered.map((t,i)=>{

              const editing=
                editingId===t.id;

              const paymentEditing=
                paymentEditId===t.id;


              return(

                <div
                  className={
                    'row '+
                    (
                      editing
                        ?'editingRow'
                        :''
                    )
                  }
                  key={t.id}
                >

                  {/* № */}
                  <span>
                    {i+1}
                  </span>


                  {/* ТЕНДЕР НОМЕР */}
                  <span>

                    {editing ? (

                      <input
                        className="tableInput"
                        value={editDraft.id}
                        onChange={e=>
                          changeEdit(
                            'id',
                            e.target.value
                          )
                        }
                      />

                    ):(

                      <span className="tenderLink">
                        {t.id}
                      </span>

                    )}

                  </span>


                  {/* МЕКЕМЕ */}
                  <span>

                    {editing ? (

                      <input
                        className="tableInput"
                        value={editDraft.org}
                        onChange={e=>
                          changeEdit(
                            'org',
                            e.target.value
                          )
                        }
                      />

                    ):(
                      t.org
                    )}

                  </span>


                  {/* LOT */}
                  <span>

                    {editing ? (

                      <input
                        className="tableInput"
                        value={editDraft.name}
                        onChange={e=>
                          changeEdit(
                            'name',
                            e.target.value
                          )
                        }
                      />

                    ):(
                      t.name
                    )}

                  </span>


                  {/* ЖАЛПЫ СУММА */}
                  <span>

                    {editing ? (

                      <input
                        className="tableInput"
                        type="number"
                        min="0"
                        value={editDraft.sum}
                        onChange={e=>
                          changeEdit(
                            'sum',
                            e.target.value
                          )
                        }
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
                        onChange={e=>
                          changeEdit(
                            'paid',
                            e.target.value
                          )
                        }
                      />

                    ):paymentEditing ? (

                      <div className="paymentEditor">

                        <input
                          type="number"
                          min="0"
                          max={t.sum}
                          autoFocus
                          value={paymentValue}
                          onChange={e=>
                            setPaymentValue(
                              e.target.value
                            )
                          }
                          onKeyDown={e=>{

                            if(
                              e.key==='Enter'
                            ){
                              savePayment(t);
                            }

                            if(
                              e.key==='Escape'
                            ){
                              setPaymentEditId(
                                null
                              );
                            }

                          }}
                        />


                        <button
                          className="paymentSave"
                          title="Сохранить"
                          onClick={()=>
                            savePayment(t)
                          }
                        >
                          <Save/>
                        </button>

                      </div>

                    ):(

                      <PaidAmount
                        t={t}
                        onClick={()=>
                          startPayment(t)
                        }
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
                        onChange={e=>
                          changeEdit(
                            'gopp',
                            e.target.value
                          )
                        }
                      />

                    ):(

                      <PayPill
                        t={t}
                        type="gopp"
                        update={update}
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
                        onChange={e=>
                          changeEdit(
                            'goik',
                            e.target.value
                          )
                        }
                      />

                    ):(

                      <PayPill
                        t={t}
                        type="goik"
                        update={update}
                      />

                    )}

                  </span>


                  {/* ТАБЛИЦА ЦЕН */}
                  <span>

                    <b
                      className={
                        (t.docs||{})[
                          'Таблица цен'
                        ]
                          ?'pill green'
                          :'pill gray'
                      }
                    >
                      {
                        (t.docs||{})[
                          'Таблица цен'
                        ]
                          ?'✓ Тиркелген'
                          :'Жок'
                      }
                    </b>

                  </span>


                  {/* СРОК */}
                  <span>

                    {editing ? (

                      <input
                        className="tableInput"
                        type="date"
                        value={editDraft.date}
                        onChange={e=>
                          changeEdit(
                            'date',
                            e.target.value
                          )
                        }
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
                      <FolderOpen/>

                      (
                        {
                          Object.keys(
                            t.docs||{}
                          ).length
                        }
                      )
                    </button>

                  </span>


                  {/* ИЗМЕНИТЬ / SAVE */}
                  <span>

                    {editing ? (

                      <button
                        className="rowSaveBtn"
                        title="Сохранить"
                        onClick={()=>
                          saveEdit(t.id)
                        }
                      >
                        <Save/>
                      </button>

                    ):(

                      <button
                        className="editBtn"
                        title="Изменить"
                        onClick={()=>
                          startEdit(t)
                        }
                      >
                        <Pencil/>
                      </button>

                    )}

                  </span>

                </div>

              );

            })}

          </div>

        </div>

      </main>


      {/* =========================
          ТЕНДЕР КОШУУ
      ========================== */}

      {addOpen&&

        <Modal
          close={()=>
            setAddOpen(false)
          }
        >

          <form onSubmit={add}>

            <small>
              ЖАҢЫ ТЕНДЕР
            </small>

            <h2>
              Тендер кошуу
            </h2>


            <div className="fields">

              <label>
                Тендер номер *

                <input
                  name="id"
                  required
                />
              </label>


              <label>
                Организация *

                <input
                  name="org"
                  required
                />
              </label>


              <label className="full">
                Товардын / Lot аталышы *

                <input
                  name="name"
                  required
                />
              </label>


              <label>
                Суммасы *

                <input
                  name="sum"
                  type="number"
                  required
                />
              </label>


              <label>
                Срок вскрытия *

                <input
                  name="date"
                  type="date"
                  required
                />
              </label>


              <label>
                ГОПП
                <em>
                  жок болсо бош калтыр
                </em>

                <input
                  name="gopp"
                  placeholder="мисалы 15 600"
                />
              </label>


              <label>
                ГОИК
                <em>
                  жок болсо бош калтыр
                </em>

                <input
                  name="goik"
                  placeholder="мисалы 8 000"
                />
              </label>

            </div>


            <button
              className="primary submit"
            >
              <Plus/>
              Добавить
            </button>

          </form>

        </Modal>
      }


      {/* =========================
          DOCUMENTS
      ========================== */}

      {active&&docsOpen&&

        <Documents
          t={active}
          update={update}
          close={()=>
            setDocsOpen(false)
          }
        />
      }

    </div>
  );
}


// ========================================
// ТӨЛӨНГӨН СУММА
// ========================================

function PaidAmount({t,onClick}){

  const paid=Number(t.paid||0);
  const total=Number(t.sum||0);

  let state='red';
  let text='✕ 0 сом';

  // Жарым төлөнгөн
  if(paid>0 && paid<total){

    state='yellow';
    text=money(paid);

  }

  // Толук төлөнгөн
  if(total>0 && paid>=total){

    state='green';
    text='✓ '+money(paid);

  }

  return(
    <button
      type="button"
      className={
        'paidAmount '+state
      }
      title="Төлөнгөн сумманы өзгөртүү"
      onClick={onClick}
    >
      {text}
    </button>
  );
}


// ========================================
// ГОПП / ГОИК
// ========================================

function PayPill({
  t,
  type,
  update
}){

  const val=t[type];

  const paid=
    t[type+'Paid'];

  if(!val){

    return(
      <b className="pill red">
        ✕ 0 сом
      </b>
    );

  }

  return(
    <button
      type="button"
      title="Басып төлөндү/төлөнө элек деп өзгөртүңүз"
      className={
        'pill clickable '+
        (
          paid
            ?'green'
            :'red'
        )
      }
      onClick={()=>
        update(
          t.id,
          {
            [type+'Paid']:!paid
          }
        )
      }
    >
      {paid?'✓ ':'✕ '}
      {money(val)}
    </button>
  );
}


// ========================================
// DOCUMENTS
// ========================================

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

    const fileKey=`${t.id}::${name}`;
    await saveRealFile(fileKey,file);

    setDrafts(d=>({
      ...d,
      [name]:{
        name:file.name,
        size:file.size,
        type:file.type,
        fileKey
      }
    }));

    setAdding(false);
    setSelectedDoc('');
  };

  const del=async name=>{
    const meta=drafts[name];

    if(meta?.fileKey){
      await deleteRealFile(meta.fileKey);
    }

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

        <button
          className="close"
          onClick={close}
        >
          <X/>
        </button>

        <small>
          ТЕНДЕР № {t.id}
        </small>

        <h2>
          Документтер
        </h2>

        <p className="modalSub">
          Бул жерде тендерге кошулган документтер гана көрсөтүлөт.
        </p>

        <div className="docList">

          {addedDocs.length===0 ? (
            <div className="docsEmpty">
              <FileText/>
              <b>Документ кошула элек</b>
              <small>
                Төмөнкү «Добавить документ» кнопкасы менен документ кошуңуз.
              </small>
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
                    onClick={()=>downloadRealFile(
                      doc.fileKey||`${t.id}::${name}`,
                      doc.name
                    )}
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
                  <option value="">
                    Документти тандаңыз
                  </option>

                  {availableDocs.map(name=>(
                    <option key={name} value={name}>
                      {name}
                    </option>
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
                      attach(
                        selectedDoc,
                        e.target.files?.[0]
                      );
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

          <span>
            {addedDocs.length} документ кошулган
          </span>

          <button
            className="primary saveBtn"
            onClick={save}
          >
            <Save/>
            Сохранить
          </button>

        </div>

      </div>
    </div>
  );
}


// ========================================
// MODAL
// ========================================

function Modal({
  children,
  close
}){

  return(
    <div
      className="overlay"
      onMouseDown={close}
    >

      <div
        className="modal"
        onMouseDown={e=>
          e.stopPropagation()
        }
      >

        <button
          className="close"
          onClick={close}
        >
          <X/>
        </button>

        {children}

      </div>

    </div>
  );
}


// ========================================
// STAT
// ========================================

function Stat({
  icon,
  label,
  value
}){

  return(
    <div className="stat">

      <div className="statIcon">
        {icon}
      </div>

      <div>

        <small>
          {label}
        </small>

        <b>
          {value}
        </b>

      </div>

    </div>
  );
}


createRoot(
  document.getElementById('root')
).render(
  <App/>
);
