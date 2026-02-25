# Eigida Atostogų Grafikas

Vidinė web platforma darbuotojų atostogų planavimui su vizualiu Ganto tipo kalendoriumi, persidengimų indikatoriumi ir vadovo patvirtinimo srautu.

## Įgyvendinta

- Bendra darbuotojų nuoroda be registracijos (`/`).
- Kairėje pusėje padalinio pasirinkimas: **Gamyba** / **Administracija**.
- Gamybos ir administracijos grafikai yra atskirti (duomenys nemaišomi).
- Kairysis meniu su mygtuku **„Pridėti atostogas“**.
- Prašymo forma: vardas/pavardė + pradžios/pabaigos data.
- Nauji prašymai grafike rodomi kaip **laukiantys patvirtinimo** (pusiau skaidrūs, su brūkšniniu rėmeliu).
- Ganto tipo horizontalus kalendorius su **mėnesio/metų režimu**.
- Persidengimų juosta (**„Persidengimai“**) rodo kiek žmonių atostogauja tą pačią dieną.
- Užvedus ant bloko rodoma tiksli informacija (`tooltip`).
- Vadovo slapti maršrutai:
  - `/manager/administracija/<token>` – pagrindinė vadovo nuoroda (valdo gamybą ir administraciją).
  - `/manager/gamyba/<token>` – papildoma nuoroda, veikia tik gamybos padaliniui.
- Vadovo veiksmai:
  - Patvirtinti / atmesti prašymus.
  - Redaguoti vardą ir datas.
  - Pažymėti ar gautas pasirašytas atostogų prašymas (tik administracijos vadovas).
  - Keisti datas tiesiogiai grafike (drag-and-drop horizontaliai).
- Automatinė kontrolė dėl pasirašyto prašymo:
  - jei iki patvirtintų atostogų liko ≤ 14 dienų ir prašymas negautas, įrašas pažymimas įspėjimu;
  - jei atostogų pradžia jau atėjo, bet prašymas negautas, įrašas rodomas kaip negalimas atostogauti.
- El. laiškų pranešimai vadovui:
  - kai pateikiamas naujas atostogų prašymas;
  - kai iki patvirtintų atostogų lieka ≤ 14 dienų ir pasirašytas prašymas negautas.
  - el. laiške pateikiama tiesioginė nuoroda į konkretų prašymą.
- Duomenys saugomi `SQLite`, todėl po perkrovimo neišnyksta.
- Stiliai pritaikyti pagal „Eigida“ brand kryptį:
  - pagrindinės spalvos `#008649`, `#006536`, akcentas `#F5A416`;
  - logotipas;
  - „Proxima Nova/Avenir Next“ prioritetinė šriftų šeima.

## Struktūra

- `/frontend` – React + Vite UI.
- `/backend` – Express API + SQLite (`better-sqlite3`).
- `/backend/data/vacations.sqlite` – duomenų bazė (automatiškai sukuriama).

## Paleidimas

Reikalinga `Node.js` 20+ ir `npm`.

1. Įdiegti priklausomybes:

```bash
npm install
```

2. Paleisti backend + frontend kartu:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

3. Backend paleidimo metu konsolėje bus parodyta:

- Darbuotojų nuoroda (bendra).
- Pagrindinė vadovo nuoroda administracijai (valdo abu padalinius).
- Papildoma vadovo nuoroda gamybai (tik gamybai).

Pastaba: kūrimo režime jos bus nukreiptos į `http://localhost:5173`. Jei naudojate kitą UI adresą, nustatykite `FRONTEND_URL` backend aplinkoje.

## Produkcinis scenarijus

1. Sukurti frontend build:

```bash
npm run build
```

2. Paleisti tik backend:

```bash
npm start
```

Backend aptiks `frontend/dist` ir aptarnaus UI iš to paties serverio.

## Konfigūracija

`backend/.env.example`:

- `PORT` – API portas.
- `MANAGER_TOKEN_GAMYBA` – pasirinktinis stabilus vadovo token gamybai.
- `MANAGER_TOKEN_ADMINISTRACIJA` – pasirinktinis stabilus vadovo token administracijai.
- `MANAGER_TOKEN` – senas fallback kintamasis (taikomas gamybai).
- `DB_PATH` – pasirinktinai, DB failo kelias.
- `FRONTEND_URL` – viešas aplikacijos adresas (naudojamas el. laiškų nuorodoms).
- `MANAGER_NOTIFICATION_EMAIL` – gavėjo el. paštas (numatytas: `modestas@eigida.lt`).
- `EMAIL_NOTIFICATIONS_ENABLED` – `true/false`, ar siųsti el. laiškus.
- `EMAIL_PROVIDER` – `auto` (numatytas), `resend` arba `smtp`.
- `RESEND_API_KEY`, `RESEND_FROM` – rekomenduojamas email siuntimo būdas per Resend API.
- `RESEND_API_BASE` – pasirinktinai, API URL (numatytas: `https://api.resend.com`).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` – SMTP siuntimo nustatymai.
- `SMTP_ALLOW_INTERNAL_INTERFACES` – konteineriams skirtas DNS fallback (`true` rekomenduojama Railway aplinkoje).
- `SIGNED_REQUEST_REMINDER_INTERVAL_MS` – kaip dažnai tikrinti 14 d. priminimus (numatyta: 1 val.).
