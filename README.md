# Тендер База — оңдолгон долбоор

React + Vite + Firebase Authentication/Firestore + Cloudinary + Vercel API.

## Кайсы каталар оңдолду?

- Firestore Rules мурда башка аккаунттардын тендерлерин окууга тыюу салган. Азыр кирген бардык аккаунттар бирдиктүү `tenders` тизмесин көрө алышат.
- Мурда жаңы документти сактоодо `id == Firestore document ID` деген ката шарт болгон. Бир тендерде бир нече лот болушу үчүн `recordId` өзүнчө сакталат.
- `publicCompanies` профилдерине эреже жок болчу — эми ар аккаунт өз профилин окуп/өзгөртөт.
- «Не состоялся» жана башка аткаруучунун файлдарын өчүргөндө эски API `ownerUid` боюнча бөгөттөп жаткан. Эми файлдар үчүн Firebase кирген колдонуучу текшерилет жана Cloudinary ресурсу коопсуз тазаланат.
- Аткаруучуну «Изменить / Удалить» басканда локалдык Vite сервери `/api` ордуна `index.html` кайтарса, сайт жалган «ийгиликтүү» дебейт; түшүнүктүү ката көрсөтөт.
- Серверди туура эмес Firebase долбоору же Cloudinary аккаунтуна туташтыруудан коргоо кошулду.

## 1. Файлдар

Негизги файлдар:

```text
api/delete-file.js
api/manage-executor.js
src/app.jsx
src/style.css
src/firebase.js
firestore.rules
firebase.json
vercel.json
package.json
```

`api` папкасы `src` ичинде эмес, долбоордун түбүндө болушу керек.

## 2. Firebase Rules'ти милдеттүү түрдө жаңыртуу

**GitHub'га `git push` жасоо Firebase Rules'ти өзүнөн өзү жаңыртпайт!**

Тандоолордун бири:

1. [Firebase Console](https://console.firebase.google.com/project/tender-cb6c2/firestore/rules) → Firestore Database → Rules → бул ZIP'теги `firestore.rules` файлын толугу менен көчүрүп салыңыз → **Publish**.
2. Же долбоор папкасынан `npx firebase-tools deploy --only firestore:rules --project tender-cb6c2` иштетиңиз (Firebase'ге кирген аккаунтуңузда уруксат болушу керек).

Эреже бардык аутентификацияланган аккаунттарга тендерлерди окуу, өзгөртүү жана өчүрүү укугун берет, анткени бул сайтта кызматкерди Firebase UID менен байлоо азыр жок. **Бул ички, ишенимдүү колдонуучулар үчүн гана ылайыктуу.** Тыштан каалаган киши каттала алса, кызматкерлер үчүн өзүнчө ролдор жана каттоого чектөө талап кылынат.

## 3. Vercel'деги 5 Environment Variables

Vercel → Tender_kg → Settings → Environment Variables → Production:

| Ачкыч | Маани |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → Project settings → Service accounts → Generate new private key деген жерден алынган **tender-cb6c2** долбоорунун толук JSON'у |
| `TENDER_ADMIN_UIDS` | Настройки → Аккаунт маалыматы → UID (бир нече админ болсо `uid1,uid2`) |
| `CLOUDINARY_CLOUD_NAME` | `dqzgtlvlu` |
| `CLOUDINARY_API_KEY` | Cloudinary Dashboard → API Keys |
| `CLOUDINARY_API_SECRET` | Cloudinary Dashboard → API Keys → жашыруун ачкыч |

Кошкондон кийин **Vercel Redeploy** кылыңыз. Бул өзгөрмөлөр жок болсо `manage-executor.js` жана `delete-file.js` толук иштебейт. Жашыруун ачкычтарды GitHub'га, `src` ичине, чатка же ZIPке салбаңыз.

## 4. Локалдык текшерүү жана GitHub

```powershell
npm install
npm run build
git status
git add src/app.jsx src/style.css src/firebase.js api/delete-file.js api/manage-executor.js firestore.rules firebase.json README.md
git commit -m "fix: restore shared Firebase tenders and executor management"
git push origin main
```

`npm run dev` аркылуу `localhost:5173` **frontend гана** иштейт. `api/manage-executor.js` Vercel'де иштеген сервердик функция; аны Vercel'ге деплой болгондон кийин текшериңиз. Локалда сервердик API иштетүү үчүн `vercel dev` керек.

## 5. Текшерүү тартиби

1. Бир аккаунт менен тендер кошуңуз. Башка аккаунттан кирип **«Тендерлер»** тизмесинен көрүнүшүн текшериңиз.
2. Сол жактан аткаруучуну тандаганда анын тендерлери гана жана өзгөртүү баскычтары көрүнүшү керек.
3. **Настройки → Управление пользователями / Аткаруучулар → Изменить**: жаңы ат ошол аткаруучунун бардык тендерлерине жазылат.
4. **Удалить**: өз аккаунтуңуздун паролун сурайт. Жөн гана PIN/пароль формасы эмес, Firebase кайра аутентификация жасайт; сервер ошондой эле администратор UID'син жана акыркы кирүү убактысын текшерет.
5. Өчүрүүдөн мурун **Firestore экспорт/камдык көчүрмө** алыңыз. Эгер Cloudinary файлдары толук өчпөсө, Firestore'догу тендерлерди өчүрүү токтотулат. Бирок эки кызматтын ортосунда абсолюттук транзакция жок.
6. Файл кошуу/өчүрүүнү «Не состоялся» бөлүмүнөн жана башка компьютерден текшериңиз.

### Маанилүү айырмачылык

Аткаруучулар `executor` деген ат менен тендерлерге байланган. Бул функция ошол аткаруучунун тендерлерин жана Cloudinary файлдарын өчүрөт, **Firebase Authentication'дагы электрондук почта аккаунттарын өчүрбөйт**.

### Чектөө

Тендердин кадимки «Өчүрүү» (бир же бир нече лот) баскычы учурда Firestore документин гана өчүрөт. Cloudinary файлдарын толук тазалоочу сервердик операция атайын **«Настройки → Аткаруучуну өчүрүү»** функциясына кошулган. Файлдары бар тендерди өзүнчө өчүрөрдөн мурда ушул айырманы эске алыңыз.
