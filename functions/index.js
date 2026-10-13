const {onCall,HttpsError}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const bcrypt=require('bcryptjs');
const crypto=require('crypto');
admin.initializeApp();
const store=admin.firestore();
const validPin=v=>typeof v==='string' && /^\d{4}$/.test(v);
const error=(message,code='invalid-argument')=>{throw new HttpsError(code,message)};
const normalize=e=>String(e||'').trim().toLowerCase();
const attempts=async(uid,kind)=>{
  const ref=store.doc(`pinAttempts/${uid}_${kind}`);
  const now=Date.now();
  await store.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    const data=snap.data()||{};
    const active=(data.until||0)>now;
    if(active && (data.count||0)>=5)error('Өтө көп аракет. 15 мүнөттөн кийин кайталаңыз.','resource-exhausted');
    tx.set(ref,{count:active?(data.count||0)+1:1,until:active?data.until:now+15*60*1000});
  });
};
const clearAttempts=async(uid,kind)=>store.doc(`pinAttempts/${uid}_${kind}`).delete().catch(()=>{});
const options={region:'us-central1',maxInstances:20};
exports.tfRegisterCompany=onCall(options,async request=>{
  const {name,pin,recoveryPin}=request.data||{};
  const email=normalize(request.data?.email);
  if(!email.includes('@')||email.length>254||typeof name!=='string'||!name.trim()||name.length>150||!validPin(pin)||!validPin(recoveryPin)||pin===recoveryPin)error('Компания, email жана эки башка 4 цифралуу PIN керек.');
  const password=crypto.randomBytes(48).toString('base64url');
  let user;
  try{
    user=await admin.auth().createUser({email,password,displayName:name.trim()});
    const [pinHash,recoveryHash]=await Promise.all([bcrypt.hash(pin,12),bcrypt.hash(recoveryPin,12)]);
    await store.doc(`companies/${user.uid}`).create({uid:user.uid,name:name.trim(),email,pinVersion:2,pinHash,recoveryHash,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    await store.doc(`publicCompanies/${user.uid}`).set({uid:user.uid,name:name.trim(),email,pinVersion:2});
    const token=await admin.auth().createCustomToken(user.uid);
    return {uid:user.uid,token};
  }catch(e){
    if(user)await admin.auth().deleteUser(user.uid).catch(()=>{});
    if(e.code==='auth/email-already-exists')error('Бул email мурда катталган.','already-exists');
    throw e;
  }
});
exports.tfLoginCompany=onCall(options,async request=>{
  const {uid,pin}=request.data||{};
  if(typeof uid!=='string'||uid.length>128||!validPin(pin))error('Компания жана 4 цифралуу PIN керек.');
  const snap=await store.doc(`companies/${uid}`).get();
  const data=snap.data();
  if(!data||data.pinVersion!==2||!data.pinHash)error('Аккаунт табылган жок.','not-found');
  await attempts(uid,'login');
  if(!await bcrypt.compare(pin,data.pinHash))error('PIN туура эмес.','permission-denied');
  await clearAttempts(uid,'login');
  return {token:await admin.auth().createCustomToken(uid)};
});
exports.tfRecoverCompanyPin=onCall(options,async request=>{
  const {uid,recoveryPin,newPin}=request.data||{};
  if(typeof uid!=='string'||uid.length>128||!validPin(recoveryPin)||!validPin(newPin)||recoveryPin===newPin)error('Эки башка 4 цифралуу PIN керек.');
  const ref=store.doc(`companies/${uid}`);
  const snap=await ref.get();const data=snap.data();
  if(!data||data.pinVersion!==2||!data.recoveryHash)error('Аккаунт табылган жок.','not-found');
  await attempts(uid,'recover');
  if(!await bcrypt.compare(recoveryPin,data.recoveryHash))error('Калыбына келтирүү PIN туура эмес.','permission-denied');
  const pinHash=await bcrypt.hash(newPin,12);
  await ref.update({pinHash,pinUpdatedAt:admin.firestore.FieldValue.serverTimestamp()});
  await clearAttempts(uid,'recover');
  await admin.auth().revokeRefreshTokens(uid);
  return {ok:true};
});
