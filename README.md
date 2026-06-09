# Assistant Redirections Apache / AzDO

Interface web guidée pour auditer et déployer des redirections Apache dans un repo Azure DevOps cloné localement.

## Démarrage plug-and-play

```bash
git clone <url-du-repo-interface>
cd interface
chmod +x init.sh
./init.sh
```

Au **premier lancement** :
1. `config.env` est créé depuis `config.env.example`
2. Vous renseignez `REPO_PATH` (chemin vers votre clone AzDO) si vide
3. L'image Podman est construite
4. L'interface démarre sur http://localhost:3100

Éditez `config.env` pour fixer org/projet/repo/branche/dossier une fois pour toute l'équipe (valeurs partagées), et `REPO_PATH` par machine.

### Prérequis

| Prérequis | Détail |
|-----------|--------|
| **Node.js** | Aucun Python requis sur l'hôte pour `./scripts/dev.sh` |
| **Clone local AzDO** | Repo déjà cloné, remote `origin` configuré |
| **PAT** | Saisi dans l'UI — scope **Code (Read & Write)** — jamais dans git |

### Fichier `config.env`

| Variable | Description |
|----------|-------------|
| `AZDO_ORG` | Organisation Azure DevOps |
| `AZDO_PROJECT` | Projet |
| `AZDO_REPO` | Dépôt |
| `DEFAULT_BRANCH` | Branche de base (`main`, …) |
| `TARGET_FOLDER` | Dossier redirections Apache dans le repo |
| `REPO_PATH` | Chemin **absolu** vers le clone local (par machine) — **entre guillemets** si espaces |
| `PORT` | Port HTTP (défaut `3100`) |
| `IMAGE_NAME` | Nom image Podman |

> **Ne jamais** mettre de PAT dans `config.env`.

Exemple :

```bash
cp config.env.example config.env
# Éditer AZDO_* et REPO_PATH (guillemets si espaces dans le chemin)
# Linux/macOS :  REPO_PATH="/home/user/Mes Projets/mon-repo"
# Windows :      REPO_PATH="/c/Users/Vous/Mes Projets/mon-repo"
./init.sh
```

### Chemins Windows

- Utilisez **Git Bash** ou **WSL** pour lancer `./init.sh`
- Mettez `REPO_PATH` **entre guillemets doubles**
- Préférez le format `/c/Users/...` plutôt que `C:\Users\...` (évite les erreurs de parsing ligne 17)

### Scripts utilitaires

| Script | Usage |
|--------|-------|
| `./init.sh` | 1er lancement ou setup complet (config + build + run) |
| `./scripts/start.sh` | Redémarrer sans rebuild |
| `./scripts/build.sh` | Reconstruire l'image seule |
| `./scripts/run.sh` | Build + run (config.env requis) |
| `./scripts/dev.sh` | Dev hors conteneur (Node.js local) |

Variables utiles :

```bash
SKIP_BUILD=1 ./init.sh      # Pas de rebuild
PORT=3101 ./scripts/start.sh    # Autre port si 3100 occupé
```

## Fonctionnalités

- **Hub** : connexion PAT + choix Extraction / Déploiement
- **Extraction** : analyse progressive des URLs, export TXT
- **Déploiement** : preview, pipeline Git (branche → commit → push)
- **Logs** : drawer latéral filtrable
- Session éphémère — aucune persistance client

## Format déploiement

```
/source /cible [ajout]
/old /gone [suppression]
/source /new-cible [modification]
```

## Architecture

- **Backend** : Node.js 22, Express (léger)
- **Frontend** : React, Vite, React Router
- **Conteneur** : Node Alpine + Git, frontend buildé en statique
- **Volume** : clone local monté en `/workspace/repo`
- **3 routes UI** : `/`, `/extraction`, `/deployment`

## Dépannage

**Port déjà utilisé**
```bash
lsof -nP -iTCP:3100 -sTCP:LISTEN
# Changer PORT dans config.env ou kill le PID
```

**REPO_PATH invalide**
```bash
git -C "$REPO_PATH" status   # doit fonctionner
```

**Windows — `invalid option \Program Files\Git\workspace`**
Git Bash réécrit `/workspace/repo` avant d'appeler Podman. Utilisez le chemin **local** du clone dans `config.env`, pas le chemin conteneur :
```bash
REPO_PATH="/c/Users/Vous/mon-clone-azdo"
```
Puis relancez `./init.sh` ou `./scripts/run.sh`. Les scripts activent `MSYS_NO_PATHCONV` automatiquement sous Git Bash.

**Pas de remote AzDO**
Le clone doit avoir `origin` vers `dev.azure.com`. Le PAT est testé à la connexion dans l'UI.
