# Xake — Analyse de partie

> Deux usages distincts de Stockfish : l'aide **pendant** la partie (barre d'évaluation, meilleurs
> coups sur demande) et l'**analyse après coup**, pour voir où la partie a basculé et ce que
> chaque camp aurait pu jouer à la place.
>
> Statut : **implémenté**. Rédigé le 2026-10-28.

## 1. Pourquoi un mode à part

- Un seul interrupteur « Analyse » mélangeait les deux usages : la courbe encombrait l'écran de
  jeu, et en revue, cliquer sur un de mes coups montrait les meilleures réponses de l'adversaire
  au lieu de ce que j'aurais dû jouer. Il fallait revenir au coup d'avant pour le changer.
- Le mode jeu reste sobre ; l'analyse de partie a son propre écran et son propre bouton.

## 2. Mode jeu

- Interrupteur **Évaluation** (`A`, ex-« Analyse ») : barre d'évaluation à gauche du plateau et
  marques des coups dans la liste (glyphes `?!` `?` `??`, point vert « meilleur coup »), sans fond
  coloré. Pas de courbe.
- Les marques supposent une évaluation de chaque position : elle continue en tâche de fond
  (spec 002 §4), même coût qu'avant.
- Meilleurs coups (`B`, clic droit, appui long) : ceux de la position affichée, inchangés.

## 3. Mode analyse de partie

- Entrée : bouton **Analyser la partie** (`R`) sous les interrupteurs, ou « Analyser la partie »
  sur la carte de fin de partie. Sortie : le même bouton (`R`). Non sauvegardé : ouvrir une autre
  partie ou recharger revient au mode jeu.
- Affiche la courbe d'évaluation (spec 002 §4) et colore la case des coups jugés dans la liste :
  liseré gauche et fond de la couleur du jugement (plus marqué pour une gaffe, discret pour un
  meilleur coup), glyphe agrandi.
- Stockfish ne joue jamais ; le plateau n'accepte de coup qu'après un coup de Stockfish (§4). Annuler, changer de camp, deux camps,
  les meilleurs coups et la barre d'évaluation (toujours affichée ici) sont désactivés. La navigation (liste, ◀ ▶, courbe, signets)
  reste libre.
- **Coup sélectionné** (le mien ou celui de Stockfish) : le panneau titre « À la place de 9. a3? »
  et liste les meilleurs coups de la position **d'avant**, le nombre de lignes du réglage. Le plateau
  reste sur la position d'après : le coup joué en flèche rouge, les alternatives en flèches
  numérotées. Sur la position de départ : les meilleurs coups de cette position.
- Voir ce que Stockfish a raté compte autant que voir ce que j'ai raté, surtout à bas Elo.

## 4. Rejouer

- Sur un de **mes** coups (couleur du joueur, ou tous en mode deux camps) : bouton **Rejouer ce
  coup**. Il quitte l'analyse et place la partie juste avant ce coup, à moi de jouer ; mon nouveau
  coup crée une variante (spec 001 §6.5) et Stockfish reprend.
- Toucher une des alternatives fait la même chose et la joue aussitôt, dans le panneau ou sur
  l'échiquier : un clic sur une flèche (à moins de 0,4 case de son tracé) joue cette alternative.
  On vise la flèche entière, pas la case d'arrivée : deux alternatives vers la même case se
  distinguent par leur départ. Flèches superposées (deux pièces alignées vers la même case) : la
  mieux classée gagne, l'autre reste jouable par sa partie propre ou par le panneau.
- Sur un coup de Stockfish : lignes non cliquables (je ne joue pas ses coups), bouton **Jouer à
  partir d'ici** : quitte l'analyse sur la position après ce coup, à moi de jouer. L'échiquier y
  est jouable : y jouer un coup quitte aussi l'analyse.
- Ces boutons sont en style primaire, en tête du panneau : la sortie de l'analyse doit se voir.
  Le bouton d'analyse sous la liste des coups devient **Revenir au jeu** : retour à la partie où
  elle en est, au dernier coup de la ligne affichée (`R` aussi).
