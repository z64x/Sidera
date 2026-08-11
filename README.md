# Sidera

Sidera este o aplicatie desktop Electron care ruleaza local si permite interactiunea cu un asistent AI capabil sa foloseasca unelte, sa gestioneze fisiere, sa lucreze cu agenti/profiluri, sa retina cunostinte in LanceDB si sa raspunda optional prin WhatsApp.

Aplicatia foloseste interfata principala `renderer` si un backend local in procesul principal Electron. Configuratia si datele aplicatiei sunt stocate local, dar continutul necesar unei functii poate fi trimis catre servicii externe configurate sau activate de utilizator, precum providerii AI, serviciile de embeddings, Google Search, Open-Meteo, Meta/Twilio ori ngrok.

## Functionalitati

- Chat AI din aplicatia desktop, cu raspunsuri streamuite in interfata si procesare prin providerul AI configurat.
- Suport pentru providerii Gemini, OpenAI, DeepSeek si Claude.
- Mod de conectare direct sau prin proxy compatibil cu providerul ales.
- Configurare separata pentru model principal si model secundar.
- Agentul Sidera, cu subagenti ascunsi pentru planificare, implementare si review.
- Profiluri/Agenti personalizati, fiecare cu instructiuni, avatar si unelte proprii.
- Tool calling pentru fisiere, memorie LanceDB, cautare web, monitorizare sistem si control aplicatii.
- Confirmari pentru actiuni riscante precum stergere fisiere, oprire/pornire aplicatii sau stergere din memorie.
- Knowledge/RAG cu fisiere text, PDF si DOCX indexate in LanceDB.
- Integrare WhatsApp prin Meta Business Cloud sau Twilio.
- Webhook local, cu integrare ngrok gestionata de aplicatie sau URL public Cloudflare/custom configurat manual.
- Allowlist pentru numere WhatsApp autorizate.
- Loguri persistente pentru consola main/renderer, vizibile ulterior in aplicatie.
- Arhivare si restaurare conversatii.
- Speech-to-text optional prin OpenAI Whisper.

## Tehnologii

- **Desktop:** Electron 28
- **Frontend:** React 19, Vite, LobeHub UI, Ant Design, lucide-react
- **Backend local:** Node.js/TypeScript in procesul principal Electron
- **AI providers:** Google Gemini, OpenAI, DeepSeek, Claude
- **Memorie vectoriala:** LanceDB embedded
- **Webhook:** Express
- **Persistenta config:** electron-store
- **Teste:** Vitest
- **Build distributie:** electron-builder

## Structura proiectului

```text
.
+-- src/
|   +-- main/
|   |   +-- ai/              provideri AI, tool calling, politici, Sidera/subagenti
|   |   +-- app-resolver/    cautare si pornire aplicatii locale
|   |   +-- config/          configuratie, profiluri, backup
|   |   +-- functions/       implementari pentru unelte: fisiere, DB, sistem, conectivitate
|   |   +-- lancedb/         client LanceDB, embeddings, procesare knowledge files
|   |   +-- ngrok/           integrare ngrok
|   |   +-- whatsapp/        Business Cloud, Twilio, autorizare numere
|   |   +-- index.ts         boot Electron, IPC, conversatii, webhook, orchestration
|   |   +-- preload.ts       API securizat expus catre renderer
|   +-- renderer/
|   |   +-- app/             providers si shell-ul aplicatiei
|   |   +-- pages/           Chat, Agenti, Setari, Setup, About
|   |   +-- styles/          stiluri globale pentru UI
|   |   +-- theme/           tema monocroma/accent colors
|   |   +-- App.tsx          router/shell principal pentru UI
|   |   +-- index.tsx        entrypoint React
|   +-- shared/
|       +-- types.ts         tipuri comune main/renderer
|       +-- toolCatalog.ts   catalogul de unelte disponibile
|       +-- sidera.ts        constante pentru Sidera
|       +-- conversationScope.ts
+-- tests/                    teste Vitest pentru main, renderer si codul shared
```

## Cerinte

- Node.js 20.19+, 22.12+ sau 24+ (o versiune LTS este recomandata)
- npm
- Git
- Windows recomandat pentru functiile de control aplicatii locale

Pe Windows, pachete precum LanceDB si keytar folosesc binare native. Daca nu exista un binar precompilat compatibil si instalarea incearca un build din surse prin `node-gyp`, sunt necesare Python 3 si Visual Studio Build Tools cu componenta **Desktop development with C++**.

## Instalare

```bash
git clone https://github.com/z64x/Sidera.git
cd Sidera
npm install --legacy-peer-deps
```

Optiunea `--legacy-peer-deps` este necesara cu versiunile fixate in lockfile-ul curent, deoarece unele pachete declara intervale de peer dependencies care se suprapun incomplet (in special LanceDB/Apache Arrow si pachetele LobeHub). Foloseste aceeasi optiune si la o reinstalare curata cu `npm ci`.

## Pornire in dezvoltare

```bash
npm run dev
```

Comanda porneste in paralel:

- `npm run dev:renderer` - serverul Vite pentru `renderer` pe portul `5174`
- `npm run dev:electron` - compileaza TypeScript si porneste Electron

Poti porni doar renderer-ul cu:

```bash
npm run dev:renderer
```

## Build si testare

```bash
npm run build:main
npm run build:renderer
npm test
```

Build complet cu installer:

```bash
npm run build
```

Output-ul pentru distributie este generat in `release/`.

Pe Windows, electron-builder poate avea nevoie de dreptul de a crea symbolic links atunci cand extrage utilitarele `winCodeSign`. Activeaza Windows Developer Mode sau ruleaza terminalul cu drepturi de Administrator. Pentru un installer local nesemnat, fara editarea executabilului, poate fi folosita alternativa:

```bash
npm run build:main
npm run build:renderer
npx electron-builder --win nsis --config.win.signAndEditExecutable=false
```

## Setup initial

La prima pornire, aplicatia blocheaza shell-ul pana cand configuratia minima este completa:

1. Alege providerul AI.
2. Seteaza cheia API pentru modul direct sau cheia/proxy-ul pentru modul proxy.
3. Alege modelul activ.
4. Alege `databasePath`, folderul in care aplicatia tine datele locale controlate de utilizator.

`databasePath` este folosit pentru:

- baza LanceDB;
- atasamente cache;
- fisiere knowledge ale agentilor;
- alte date locale dependente de proiect.

Unele date Electron, cum ar fi configuratia `electron-store`, avatarurile copiate in storage-ul aplicatiei si logurile consolei, sunt pastrate in folderul `userData` al aplicatiei.

## Provideri AI si modele

Aplicatia poate folosi:

- Gemini
- OpenAI
- DeepSeek
- Claude

Pentru fiecare provider exista selectii de model. Modelul principal genereaza raspunsul vizibil, iar modelul secundar este folosit de subagentii Sidera cand orchestration-ul este disponibil.

### Direct vs Proxy

- **Direct:** aplicatia trimite cereri direct la API-ul providerului.
- **Proxy:** aplicatia trimite cereri catre un endpoint compatibil configurat de utilizator.

Proxy-ul este util pentru management centralizat al cheilor, logging, rate limiting sau compatibilitate cu provideri expusi printr-un API similar.

## Agenti, Sidera si unelte

Profilurile de agent definesc:

- nume si descriere;
- instructiuni de sistem;
- avatar;
- fisiere knowledge;
- unelte permise.

Uneltele disponibile sunt definite in `src/shared/toolCatalog.ts`. Activarea efectiva se calculeaza prin intersectia dintre setarile globale si uneltele permise pe profil.

Sidera este agentul coordonator al aplicatiei. El poate folosi subagenti ascunsi pentru planificare, cod si review, dar raspunsul final ramane sintetizat de Sidera.

## Knowledge si LanceDB

Fisierele adaugate la un agent sunt copiate in zona de date a aplicatiei, extrase ca text, impartite in chunk-uri si indexate in LanceDB.

Formate suportate pentru indexare text:

- `.txt`
- `.md`
- `.json`
- `.csv`
- `.pdf`
- `.docx`

Embeddings pot fi generate prin providerul configurat pentru embeddings sau automat, in functie de configuratie.

Nota: memoria/database-ul LanceDB are nevoie de embeddings OpenAI sau Google/Gemini. Daca aplicatia este configurata doar cu DeepSeek sau Claude, chat-ul poate functiona, dar adaugarea si cautarea semantica in database/knowledge nu vor merge pana cand nu este configurata o cheie sau un proxy OpenAI/Gemini.

## WhatsApp si webhook

Aplicatia poate primi si trimite mesaje WhatsApp prin:

- Meta Business Cloud API
- Twilio

Webhook-ul local ruleaza prin Express. Aplicatia poate porni si gestiona tunelul ngrok. Pentru Cloudflare Tunnel sau un alt serviciu, tunelul se configureaza separat, iar URL-ul public se introduce manual in setari.

Optiunile disponibile in interfata sunt:

- Cloudflare tunnel
- ngrok
- URL custom

Numerele autorizate sunt gestionate prin allowlist. Mesajele de la numere neautorizate sunt respinse implicit, cu optiune separata pentru raspuns catre expeditorii neautorizati.

Pentru Meta Business Cloud sunt necesare urmatoarele valori:

```env
WHATSAPP_ACCESS_TOKEN=your_access_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_VERIFY_TOKEN=your_verify_token_here
```

Fisierul `.env.example` le documenteaza ca referinta, dar versiunea curenta a aplicatiei nu incarca automat un fisier `.env`. Configuratia runtime se introduce si se salveaza prin pagina de setari.

## Loguri si diagnostic

Aplicatia captureaza loguri din:

- procesul principal Electron;
- renderer;
- evenimente relevante din integrare si AI.

Logurile pot fi vazute din interfata de setari. Ele sunt utile pentru debugging, demo si analiza erorilor aparute anterior.

## Securitate si confidentialitate

- Nu comite fisiere `.env` reale.
- Cheile API si URL-urile private de proxy nu trebuie puse in cod.
- Configuratia, inclusiv cheile API introduse in aplicatie, este persistata local prin `electron-store`. In implementarea curenta, aceste valori nu sunt mutate automat intr-un credential vault al sistemului de operare; protejeaza accesul la profilul local al utilizatorului.
- Tool-urile riscante cer confirmare unde este cazul.
- WhatsApp foloseste allowlist pentru control de la distanta.
- Renderer-ul acceseaza capabilitatile native doar prin `preload.ts` si `window.electronAPI`.
- Fisierele expuse catre renderer sunt limitate la radacini controlate de aplicatie.

## Comenzi utile

```bash
npm run dev
npm run build:main
npm run build:renderer
npm run build
npm test
npm run test:watch
```

## Depanare

**Aplicatia porneste in Setup si nu lasa acces la restul UI-ului**

Completeaza providerul AI, cheia/API proxy, modelul si `databasePath`.

**Providerul raspunde lent**

Verifica daca folosesti proxy. Modul proxy poate adauga latenta prin hop suplimentar, rate limiting sau procesare intermediara.

**Knowledge file nu se indexeaza**

Verifica formatul fisierului, daca textul poate fi extras si daca providerul de embeddings este configurat corect.

**WhatsApp nu raspunde**

Verifica metoda activa, token-urile, URL-ul public de webhook, portul local si allowlist-ul numerelor autorizate.

**Build-ul esueaza pe Windows**

Ruleaza `npm run build:main` separat pentru erori TypeScript si verifica dependentele native. Daca `node-gyp` compileaza din surse, verifica instalarea Python 3 si Visual Studio Build Tools cu **Desktop development with C++**. Daca electron-builder raporteaza `A required privilege is not held by the client` la crearea unui symbolic link, activeaza Windows Developer Mode, ruleaza terminalul ca Administrator sau foloseste comanda pentru installer local nesemnat prezentata in sectiunea de build.

**`npm install` esueaza cu `ERESOLVE`**

Ruleaza `npm install --legacy-peer-deps`. Conflictul provine din intervalele de peer dependencies declarate de versiunile curente ale LanceDB/Apache Arrow si ale unor pachete LobeHub, nu din lipsa unui pachet Python.

## Licenta

Proiectul este distribuit sub licenta MIT. Vezi fisierul [LICENSE](LICENSE).
