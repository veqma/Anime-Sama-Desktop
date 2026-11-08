# Anime-Sama Desktop

Anime-Sama Desktop ouvre Anime-Sama dans une fenêtre dédiée sous Windows. Le projet est indépendant et n'est pas affilié à l'équipe d'Anime-Sama.

## Fonctionnalités

- Présence Discord pour les épisodes, les films et les scans.
- Réglages accessibles depuis le menu de l'icône dans la zone de notification : Discord Rich Presence, lancement avec Windows, AD Block, plein écran et minimisation dans la zone de notification à la fermeture.
- Une nouvelle ouverture de l'application ramène à la fenêtre déjà lancée.
- Écran de démarrage et raccourci `F11` pour le plein écran.


## Utilisation

Téléchargez `anime-sama desktop.exe` depuis les releases GitHub, puis lancez-le.

## Lancer depuis les sources

Installez [Node.js](https://nodejs.org/), puis exécutez :

```bash
npm install
npm start
```

Pour créer la version portable Windows 64 bits :

```bash
npm run build:win
```

Le fichier est généré dans `dist`.
