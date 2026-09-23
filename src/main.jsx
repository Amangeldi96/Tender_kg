// lucide-react импортуна Pencil жана Save кош
import {
  LayoutDashboard,Briefcase,FileText,Settings,Search,Plus,Upload,
  CalendarDays,Wallet,X,Paperclip,Trash2,CheckCircle2,AlertCircle,
  FolderOpen,Save,Eye,PackageCheck,Pencil
} from 'lucide-react';

function App(){
  const [tenders,setTenders]=useState(read);
  const [active,setActive]=useState(null);
  const [addOpen,setAddOpen]=useState(false);
  const [docsOpen,setDocsOpen]=useState(false);
  const [q,setQ]=useState('');

  // Кайсы сап өзгөртүлүп жатат
  const [editingId,setEditingId]=useState(null);
  const [editDraft,setEditDraft]=useState(null);

  // Төлөнгөн сумма input
  const [paymentEditId,setPaymentEditId]=useState(null);
  const [paymentValue,setPaymentValue]=useState('');

  const filtered=tenders.filter(t =>
    (t.id+t.org+t.name).toLowerCase().includes(q.toLowerCase())
  );

  const total=useMemo(
    ()=>tenders.reduce((a,b)=>a+Number(b.sum||0),0),
    [tenders]
  );

  const update=(id,patch)=>{
    const a=tenders.map(t=>t.id===id?{...t,...patch}:t);
    setTenders(a);
    persist(a);

    setActive(x=>x?.id===id?{...x,...patch}:x);
  };

  const remove=id=>{
    const a=tenders.filter(t=>t.id!==id);
    setTenders(a);
    persist(a);
    setActive(null);
  };

  function add(e){
    e.preventDefault();

    let f=new FormData(e.currentTarget);

    let t={
      id:String(f.get('id')).trim(),
      org:String(f.get('org')).trim(),
      name:String(f.get('name')).trim(),
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
    setAddOpen(false);
    setActive(t);
  }

  // -------------------------
  // ТӨЛӨНГӨН СУММА
  // -------------------------

  const openPayment = t => {
    setPaymentEditId(t.id);
    setPaymentValue(String(t.paid || ''));
  };

  const savePayment = t => {
    let value = Number(paymentValue || 0);

    if(value < 0) value = 0;

    // Жалпы суммадан ашырбайбыз
    if(value > Number(t.sum)){
      value = Number(t.sum);
    }

    update(t.id,{paid:value});

    setPaymentEditId(null);
    setPaymentValue('');
  };

  // -------------------------
  // ТЕНДЕРДИ ИЗМЕНИТЬ
  // -------------------------

  const startEdit = t => {
    setEditingId(t.id);

    setEditDraft({
      id:t.id,
      org:t.org,
      name:t.name,
      sum:t.sum,
      date:t.date,
      gopp:t.gopp || '',
      goik:t.goik || ''
    });
  };

  const changeEdit = (key,value) => {
    setEditDraft(d=>({
      ...d,
      [key]:value
    }));
  };

  const saveEdit = oldId => {
    if(!editDraft) return;

    const newTender={
      ...tenders.find(t=>t.id===oldId),
      ...editDraft,
      sum:Number(editDraft.sum || 0)
    };

    const a=tenders.map(t=>
      t.id===oldId ? newTender : t
    );

    setTenders(a);
    persist(a);

    if(active?.id===oldId){
      setActive(newTender);
    }

    setEditingId(null);
    setEditDraft(null);
  };

  return (
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
            <div className="avatar">КК</div>

            <div>
              <b>Кел кел</b>
              <small>Администратор</small>
            </div>
          </div>
        </div>
      </aside>

      <main>

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
            value={tenders.reduce(
              (a,t)=>a+Object.keys(t.docs||{}).length,
              0
            )}
          />

        </section>

        <div className="panel tablePanel">

          <div className="panelhead">
            <div>
              <small>КАТЫШЫП ЖАТКАН ТЕНДЕРЛЕР</small>
              <h2>Таблица</h2>
            </div>

            <span className="count">
              {filtered.length}
            </span>
          </div>

          <div className="bigTable">

            <div className="row head">
              <span>№</span>
              <span>тендер номер</span>
              <span>Мекемелер</span>
              <span>Lot аталышы</span>
              <span>суммасы</span>
              <span>төлөнгөн суммалар</span>
              <span>ГОПП</span>
              <span>ГОИК</span>
              <span>Таблица цен</span>
              <span>Срок вскрытия</span>
              <span>Файлдар</span>

              {/* Действие деген текст жок */}
              <span></span>
            </div>

            {filtered.map((t,i)=>{
              const editing=editingId===t.id;
              const paymentEditing=paymentEditId===t.id;

              return (
                <div
                  className={'row '+(editing?'editingRow':'')}
                  key={t.id}
                >

                  <span>{i+1}</span>

                  {/* ТЕНДЕР НОМЕР */}
                  <span>
                    {editing ? (
                      <input
                        className="tableInput"
                        value={editDraft.id}
                        onChange={e=>
                          changeEdit('id',e.target.value)
                        }
                      />
                    ):(
                      <span
                        className="tenderLink"
                        onClick={()=>setActive(t)}
                      >
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
                          changeEdit('org',e.target.value)
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
                          changeEdit('name',e.target.value)
                        }
                      />
                    ):(
                      t.name
                    )}
                  </span>

                  {/* СУММА */}
                  <span>
                    {editing ? (
                      <input
                        className="tableInput number"
                        type="number"
                        value={editDraft.sum}
                        onChange={e=>
                          changeEdit('sum',e.target.value)
                        }
                      />
                    ):(
                      money(t.sum)
                    )}
                  </span>

                  {/* ТӨЛӨНГӨН СУММА */}
                  <span>

                    {paymentEditing ? (

                      <div className="paymentEditor">

                        <input
                          type="number"
                          min="0"
                          max={t.sum}
                          autoFocus
                          value={paymentValue}
                          onChange={e=>
                            setPaymentValue(e.target.value)
                          }
                          onKeyDown={e=>{
                            if(e.key==='Enter'){
                              savePayment(t);
                            }

                            if(e.key==='Escape'){
                              setPaymentEditId(null);
                            }
                          }}
                        />

                        <button
                          className="paymentSave"
                          onClick={()=>savePayment(t)}
                        >
                          <Save/>
                        </button>

                      </div>

                    ):(
                      <PaidAmount
                        t={t}
                        onClick={()=>openPayment(t)}
                      />
                    )}

                  </span>

                  {/* ГОПП */}
                  <span>
                    {editing ? (
                      <input
                        className="tableInput"
                        value={editDraft.gopp}
                        placeholder="ГОПП жок"
                        onChange={e=>
                          changeEdit('gopp',e.target.value)
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
                        placeholder="ГОИК жок"
                        onChange={e=>
                          changeEdit('goik',e.target.value)
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
                        (t.docs||{})['Таблица цен']
                          ? 'pill green'
                          : 'pill gray'
                      }
                    >
                      {(t.docs||{})['Таблица цен']
                        ? '✓ Тиркелген'
                        : 'Жок'}
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
                          changeEdit('date',e.target.value)
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
                      ({Object.keys(t.docs||{}).length})
                    </button>
                  </span>

                  {/* КАРАНДАШ / SAVE */}
                  <span>

                    {editing ? (

                      <button
                        className="rowSaveBtn"
                        title="Сохранить"
                        onClick={()=>saveEdit(t.id)}
                      >
                        <Save/>
                      </button>

                    ):(

                      <button
                        className="editBtn"
                        title="Изменить"
                        onClick={()=>startEdit(t)}
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

      {/* Сенин калган Modal / Detail / Documents
          бөлүктөрүң ушул бойдон калат */}

    </div>
  );
}


// ====================================
// ТӨЛӨНГӨН СУММАНЫН ТҮСҮ
// ====================================

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

  return (
    <button
      className={'paidAmount '+state}
      onClick={onClick}
      title="Төлөнгөн сумманы киргизүү"
    >
      {text}
    </button>
  );
}