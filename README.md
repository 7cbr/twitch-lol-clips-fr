# Twitch LoL Clips FR

Agrégateur de clips Twitch francophones pour **League of Legends**. Récupère automatiquement tous les clips FR des 3 derniers jours via l'API Twitch Helix.

## Fonctionnalités

- **Tous les clips FR** des 3 derniers jours, récupérés en parallèle
- **Player intégré** Twitch avec liste défilante
- **Filtres** par date, par streamer (multi-sélection avec autocomplete)
- **Groupes de streamers** sauvegardés en localStorage
- **Tri** par nombre de vues ou par date
- **Téléchargement** individuel ou en masse (ZIP)
- **Sélection par checkbox** pour télécharger une sélection précise
- **Durée** affichée pour chaque clip
- Interface responsive (desktop + mobile)

## Stack

- **Next.js 15** (App Router) + TypeScript
- **Tailwind CSS v4**
- **JSZip** pour le téléchargement en masse
- **Vercel** pour l'hébergement

## Installation

```bash
git clone https://github.com/7cbr/twitch-lol-clips-fr.git
cd twitch-lol-clips-fr
npm install
```

Créer un fichier `.env.local` à la racine :

```env
TWITCH_CLIENT_ID=ton_client_id
TWITCH_CLIENT_SECRET=ton_client_secret
```

> Les identifiants s'obtiennent sur [dev.twitch.tv/console](https://dev.twitch.tv/console) en créant une application.

```bash
npm run dev
```

L'app tourne sur [http://localhost:3000](http://localhost:3000).

## Déploiement Vercel

1. Push le repo sur GitHub
2. Importe le projet sur [vercel.com](https://vercel.com)
3. Ajoute les variables d'environnement `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET`
4. Deploy

Chaque push sur `main` déclenche un redéploiement automatique.

## Structure

```
src/
├── app/
│   ├── page.tsx              # Page principale (player + liste clips)
│   └── api/
│       ├── clips/route.ts    # GET /api/clips - tous les clips FR LoL
│       └── download/route.ts # GET /api/download - proxy téléchargement MP4
├── components/
│   └── StreamerFilter.tsx    # Multi-select streamers + groupes
├── lib/
│   ├── twitch.ts             # Client API Twitch (OAuth + fetch clips)
│   └── constants.ts          # Game ID LoL, nombre de jours
└── types/
    └── twitch.ts             # Types TypeScript
```
