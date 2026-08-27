# Kako deluje zaledje — pregled

Ta dokument je kratek zemljevid: kateri modeli obstajajo, kaj vsak dela in kako
so med sabo povezani. Podrobnosti so v angleških dokumentih 01–06; tu je samo
bistvo.

## Velika slika

Backend je **en Flask strežnik** (`backend/app.py`) + **MongoDB** (slike v
GridFS, metapodatki + CLIP vektorji v `image_metadata`). Frontend govori samo z
REST API-jem, nikoli direktno z bazo ali modelom.

Ključna ideja: **skoraj nič se ne računa v živo**. Ko naložiš arhiv, poženeš
*pipeline* (F1, F2, F5, F6), ki rezultate izračuna vnaprej in jih shrani —
v Mongo (F1, F2) ali v JSON datoteke (F5, F6). Sceni v aplikaciji potem samo
bereta te shranjene rezultate. Edina izjema v živo sta semantično iskanje (F1)
in klasifikacija posamezne slike (F2 `/classify`).

```
 upload arhiva ──▶ F1 pipeline: CLIP embedding za vsako sliko ──▶ Mongo
                        │
                        ├──▶ F2 pipeline: klasifikator (stil/žanr/avtor) ──▶ Mongo (features.f2)
                        │
                        ├──▶ F5 pipeline: CLIP vektorji → PCA zemljevid + letnice ──▶ JSON
                        │         └──▶ frontend iz tega izpelje F3 (creativity) in F4 (influence)
                        │
                        └──▶ F6 pipeline: 6 klasičnih CV kanalov ──▶ JSON
```

## Vsi modeli na enem mestu

| Model | Kje teče | Kaj dela | Kdo ga uporablja |
|---|---|---|---|
| **CLIP ViT-B/32** (OpenAI, splošen) | backend, v živo + pipeline | slika ali besedilo → 512-d vektor pomena | F1 iskanje, osnova za F5, rezerva za F2 |
| **F2 multi-task ViT-L/336** (tvoj, natreniran na FRIDI) | backend, pipeline + `/classify` | slika → **27 stilov / 10 žanrov / 25 avtorjev** | F2 Logbook |
| **Vmesni model 1: letnica/obdobje** | backend, del F5 pipeline-a | določi leto vsake slike (glej spodaj) | F5 časovnica, F3, F4 |
| **Vmesni model 2: creativity** | **frontend** (`historicalAnalysis.js`) | iz F5 podatkov izračuna oceno izvirnosti | F3 Creativity Currents |
| **Vmesni model 3: influence** | **frontend** (`historicalAnalysis.js`) | iz F5 podatkov zgradi usmerjene povezave vpliva | F4 Influence Routes |
| **MediaPipe Pose, RetinaFace, OpenCV (barve, Hough)** | backend, F6 pipeline | 4 ločeni atributni kanali | F6 Captain's Quarters |

Pomembno: F3 in F4 **nimata svojega naučenega modela** — sta izpeljanki
(formuli) nad izhodom F5. Zato ju v backend mapah ni; živita v
`frontend/src/utils/historicalAnalysis.js`.

## Po featurjih

### F1 — Star Atlas (semantično iskanje)
- Pipeline F1 vsaki sliki izračuna CLIP vektor in ga shrani v Mongo.
- Ob iskanju se tvoj tekst ("stormy sea at night") pretvori v CLIP vektor in
  primerja s shranjenimi (kosinusna podobnost). Najboljše slike = najsvetlejše zvezde.
- En model (CLIP), nič treniranega tvojega — a njegovi vektorji so surovina za F5.

### F2 — Logbook (stil / žanr / avtor)
- Tvoj glavni natreniran model: fino nastavljen CLIP ViT-L/14 @ 336 px s tremi
  linearnimi glavami. Razredi: **27 stilov, 10 žanrov, 25 avtorjev** (točni
  seznami: `data/f2_dataset_hires/f2_labels.json`, endpoint `/api/f2/labels`).
- Klasificirajo se samo slike, ki so prišle **brez pravega imena** (heuristika
  `_needs_logbook_classification` v `pipeline_api.py`).
- Veriga robustnosti: tvoj model → CLIP zero-shot → determinističen naključni
  fallback. API nikoli ne vrne napake.
- **Neznan avtor (open-set):** glava za avtorja pozna samo 25 slikarjev, softmax
  pa vedno predlaga enega od njih. Zato backend zavrne napoved, če je najvišja
  verjetnost pod kalibriranim pragom (**0.49** za ViT-L/336): oznaka postane
  `"Unknown artist"` (`known: false`), najbližji znani avtor pa se hrani ločeno
  kot `closest`. Frontend to pokaže kot *"Not among the 25 known artists
  (closest: …)"* v `LogbookGallery.jsx`.

### F5 — Chart Table (zemljevid zgodovine umetnosti)
Pipeline (`f5_history_map/run_pipeline.py`) naredi po vrsti:
1. vzame **CLIP vektorje** slik (iz Monga; če jih ni, jih izračuna; skrajna
   rezerva so ročno izračunani deskriptorji),
2. **PCA** projekcija v 2D + **k-means** gruče + kosinusni sosedi,
3. **letnica za vsako sliko** (vmesni model 1 — glej spodaj),
4. za vsako sliko izračuna še `distinctiveness` (oddaljenost od centra svoje
   gruče) in `bridge_score` (koliko slika "premošča" med gručami),
5. zapiše `coords.json / index.json / summary.json`, ki jih streže `/api/f5`.

### Vmesni model 1 — letnica/obdobje (backend, znotraj F5)
Veriga od najbolj do najmanj zanesljivega vira:
1. leto iz **metapodatkov** slike (`year`, `creation_year`, …),
2. leto iz **imena datoteke**,
3. **WikiArt** lookup (leto dokončanja; sicer ocena iz let življenja avtorja),
4. če nič od tega: **naučeni year head** (`f5_history_map/year_head.py`) — MLP
   nad CLIP embeddingom slike, natreniran na 137.646 WikiArt slikah z znano
   letnico (`backend/training/f5_year_head/train_year_head.py`, artefakt
   `data/f5_year_head/f5_year_head.pt`). Napoveduje pričakovano vrednost čez
   desetletne koše 1300–2029. Izmerjena natančnost na testu z **ločenimi
   avtorji**: MAE ≈ 31 let, mediana ≈ 19 let, 85 % napovedi znotraj ±50 let
   (naivna osnova: 73 let). Vir: `year_source: "model_estimate"`.
5. če model ni na voljo (ni datoteke/torcha): stara **linearna regresija**
   *PCA koordinate → leto* na slikah arhiva (`year_source: "estimated"`).
Frontend oba tipa ocene označi oranžno. Leto nato določi tudi obdobje/ero
(`_era_for_year`).

### F3 — Creativity Currents (vmesni model 2, frontend)
Za vsako sliko iz F5 podatkov (`buildCreativityReadings`):
- **izvirnost** po izbrani dimenziji: *color* in *composition* iz odstopanja
  vizualnih lastnosti od povprečja, *subject* iz `bridge_score`, *overall* =
  0.62·distinctiveness + 0.38·bridge,
- **vpliv** = koliko *kasnejših* slik je vizualno blizu tej sliki,
- **creativity = 0.56·izvirnost + 0.44·vpliv** — poenostavljena, interaktivna
  različica ideje Elgammal & Saleh (kreativnost = izvirnost + vpliv), brez
  PageRank omrežja.

### F4 — Influence Routes (vmesni model 3, frontend)
`buildInfluenceNetwork` poveže vizualno podobne slike (F5 sosedi) in puščico
vedno usmeri **od starejše k novejši** (letnice iz vmesnega modela 1). Rezultat
so verjetne poti vizualnega vpliva skozi zbirko.

> Posledica te odvisnosti: če so letnice ocenjene (korak 4 zgoraj), so tudi F3
> in F4 zgrajeni na ocenah — zato oznaka "estimated" ni kozmetika.

### F6 — Captain's Quarters (4 atributni filtri + poreklo)
Pipeline požene štiri neodvisne kanale, vsak s svojim modelom, in vse združi v
en `index.json` (ločen po bazi):

| Kanal | Model | Rezultat |
|---|---|---|
| Poses | MediaPipe Pose | tri drže rok (dvignjene / razprte / spuščene) |
| Colors | OpenCV k-means | šest barvnih družin + tretjinska pasova nasičenosti in svetlosti |
| Hough | OpenCV Canny+Hough | gostota in smer črt (navpična / poševna / vodoravna tretjina) |
| Portrait pose | RetinaFace, 5 obraznih točk | pet sektorjev pogleda portretiranca |

Poleg teh štirih kanalov globus filtrira po poreklu: `run_pipeline.py` narodnost
avtorja iz `data/WikiArt_dataset/WikiArt.parquet` preslika v celino
(`NATION_TO_REGION`). Kanala za čustva (DeepFace) in objekte (YOLOv8) sta bila
odstranjena 26. 8. 2026.

V sceni se nič ne računa — filtri samo kombinirajo vnaprej izračunane JSON-e.

## Kako je vse povezano (odvisnosti)

```
CLIP embeddingi (F1 pipeline)
   ├── F1 iskanje (v živo)
   └── F5 zemljevid ── letnice (vmesni model 1)
                          ├── F3 creativity (vmesni model 2, frontend)
                          └── F4 influence  (vmesni model 3, frontend)

F2 klasifikator ── neodvisen (bere slike direktno iz GridFS)
F6 kanali      ── neodvisni (vsak bere slike direktno)
```

Praktična posledica: **F5 pipeline moraš pognati po F1** (sicer nima shranjenih
CLIP vektorjev in jih računa sam), F3/F4 pa ne potrebujeta nobenega pipeline-a —
samo svež F5 izhod.

## Zakaj "Unknown artist" še nisi videl na frontendu

Koda za prikaz obstaja in je pravilna. Razloga sta najverjetneje dva:
1. **Open-set logika je bila dodana šele 8. 7. 2026** (commit `e7b39b1`, hkrati
   backend in frontend). Logbook najprej bere **shranjene** rezultate iz Monga
   (`features.f2`) in v živo klasificira samo slike brez njih. Vsi rezultati,
   zapisani pred tem datumom, polja `known` sploh nimajo → frontend jih vedno
   šteje za znane. **Rešitev: ponovno poženi F2 pipeline** — ta vse "neimenovane"
   slike klasificira znova in prepiše `features.f2`.
2. Če je arhiv WikiArt slik avtorjev iz top-25, je `known: true` pravilen
   rezultat. Za test naloži sliko avtorja, ki ni med 25 (npr. Vermeer, Klimt).

Manjša luknja: skrajni naključni fallback (`_predict_fallback`) open-set praga
ne uporablja, torej brez modela in brez CLIP-a "Unknown artist" nikoli ne nastane.
