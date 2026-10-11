# TenderFlow PRO — оңдолгон версия

## Иштетүү
1. `npm install`
2. `npm run build` (Vercel: Build Command `npm run build`, Output `dist`, Framework `Vite`)
3. Firebase Console → Authentication → Email/Password күйгүзүү.
4. Firestore → Rules → `firestore.rules` мазмунун коюп Publish басуу.
5. Cloudinary параметрлери керек болсо `.env.example` көчүрүп `.env` түзүп толтуруңуз; Vercel үчүн Environment Variables.
6. Firebase Auth → Authorized domains ичинде Vercel домени болсун.

## Маанилүү: эски тендерлер
Эски тендер документтеринде `ownerUid` жок болушу мүмкүн. Бул версия башка компаниялардын тендерлерин көрбөө үчүн `ownerUid == auth.uid` менен гана окуйт. Эски жазууларды жоготпоңуз: **алгач Firestore export/backup алыңыз**. Эски тендерлерге Firebase Console же ишенимдүү админ скрипт аркылуу тиешелүү компаниянын UID'син `ownerUid` катары киргизүү керек. Бул программа эски жазууларды автоматтык түрдө өчүрбөйт же көчүрбөйт.

## Өзгөртүүлөр
- Бирдиктүү grid өлчөмү, горизонталдуу скролл, мобилдик стилдер
- Тендер кошуу, өзгөртүү, өчүрүү Firebase сактоосу аяктаганда гана UI жаңыланат
- Firestore realtime `onSnapshot`, каталар көрсөтүлөт
- Компания каттоо, PIN кирүү, reset email функциялары туташтырылды
- Документтер кызматкер → тендер → файл иретинде

## Чектөөлөр
- Бул чөйрөдө npm пакеттерин толук жүктөө мүмкүн болгон жок; Vercel build иштешин жандуу текшерүү керек.
- Cloudinary'ге файл жүктөө үчүн туура unsigned upload preset талап кылынат.
- 8 цифралык PIN — коопсуздук жагынан узун сырсөздөн алсыз; Firebase Authentication rate-limit жана кошумча коргоону караңыз.
- Компаниялар тизмеси үчүн `companies` документтериндеги аты жана email'и жалпыга окулат; жеке маалымат кошпоңуз.
