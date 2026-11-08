# Anime-Sama Desktop

Interface Electron qui affiche le site anime sama depuis une application.

Anime-Sama Desktop est une application non officiel et je ne suis pas allier avec l'equipe d'anime-sama pour realiser ce projet.

## Utilisation

Téléchargez et lancez `Anime-Sama Desktop-1.0.0-portable.exe`.

## Feature
- `F11` : activer ou quitter le plein écran.
- Un anti pop up est inclu dans l'application.
- Un bloqueur de publicités et de traqueurs est activé au démarrage. Quelques éléments publicitaires de la page sont également masqués.

## Lancer depuis les sources

Il faut avoir [Node.js](https://nodejs.org/) et npm installés.

```bash
npm install
npm start
```

Pour créer la version portable Windows 64 bits :

```bash
npm run build:win
```

Le fichier généré se trouve dans le dossier `dist`.
