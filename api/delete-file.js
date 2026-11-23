import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import cloudinary from 'cloudinary';

const { v2: cloud } = cloudinary;

function initializeServer() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || 'null');
  if (!serviceAccount?.project_id || !serviceAccount?.private_key || !serviceAccount?.client_email) {
    throw Object.assign(new Error('Vercel: FIREBASE_SERVICE_ACCOUNT_JSON конфигурациясы жок же туура эмес'), { status: 503 });
  }
  if (serviceAccount.project_id !== 'tender-cb6c2') {
    throw Object.assign(new Error('Firebase Admin башка долбоорго туташкан. tender-cb6c2 service account керек.'), { status: 503 });
  }
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
    if (!process.env[key]) throw Object.assign(new Error(`Vercel: ${key} конфигурациясы жок`), { status: 503 });
  }
  if (process.env.CLOUDINARY_CLOUD_NAME !== 'dqzgtlvlu')
    throw Object.assign(new Error('Cloudinary cloud name сайттагы dqzgtlvlu менен дал келиши керек'), { status: 503 });
  cloud.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST гана колдонулат' });
  }
  try {
    initializeServer();
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: 'Аккаунтка кайра кириңиз' });
    await getAuth().verifyIdToken(match[1], true);
    const { tenderId, docName } = req.body || {};
    if (typeof tenderId !== 'string' || tenderId.length > 180 || !tenderId ||
        typeof docName !== 'string' || docName.length > 300 || !docName) {
      return res.status(400).json({ error: 'Тендер же документ туура эмес' });
    }

    const db = getFirestore();
    const ref = db.collection('tenders').doc(tenderId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Тендер табылган жок' });
    const tender = snap.data();
    // Тендерлер жалпы база: ownerUid файлды ким биринчи жүктөгөнүн гана көрсөтөт.
    // Сайттагы аткаруучунун/«Не состоялся» бөлүмүндө башка аккаунт да иштей алат.
    const file = tender.docs?.[docName];
    if (!file) return res.status(404).json({ error: 'Файл мурун өчүрүлгөн же табылган жок' });
    if (!file.publicId || !['image', 'raw', 'video'].includes(file.resourceType)) {
      return res.status(409).json({ error: 'Бул эски файлдын Cloudinary publicId/resourceType маалыматы жок. Адегенде кайра жүктөңүз.' });
    }
    if (typeof file.url === 'string' && file.url.startsWith('https://res.cloudinary.com/')) {
      const actualCloud = new URL(file.url).pathname.split('/')[1];
      if (actualCloud !== process.env.CLOUDINARY_CLOUD_NAME)
        return res.status(409).json({ error: 'Файл башка Cloudinary аккаунтунда. Коопсуз өчүрүү токтотулду.' });
    }
    const result = await cloud.uploader.destroy(file.publicId, {
      resource_type: file.resourceType,
      invalidate: true
    });
    if (!['ok', 'not found'].includes(result.result)) {
      return res.status(502).json({ error: 'Cloudinary файлды өчүргөн жок', detail: result.result });
    }

    await db.runTransaction(async tx => {
      const latest = await tx.get(ref);
      if (!latest.exists) throw new Error('Тендер ошол учурда өчүрүлгөн');
      const docs = { ...(latest.data().docs || {}) };
      if (!docs[docName]) return;
      if (docs[docName].publicId !== file.publicId) throw new Error('Файл ошол учурда алмаштырылган. Баракты жаңыртыңыз');
      delete docs[docName];
      tx.update(ref, { docs });
    });
    return res.status(200).json({ ok: true, cloudinary: result.result });
  } catch (err) {
    console.error('delete-file:', err);
    const status = err?.status || (err?.code?.startsWith?.('auth/') ? 401 : 500);
    return res.status(status).json({ error: status === 401 ? 'Сессия бүттү. Кайра кириңиз' : (err.message || 'Өчүрүүдө сервер катасы') });
  }
}
