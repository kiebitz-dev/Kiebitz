export type Source = "chess.com" | "lichess" | "manual";
export type Result = "win" | "loss" | "draw";
export type TimeControl = "Bullet" | "Blitz" | "Rapid" | "Täglich";

export interface Game {
  id: string;
  date: string;
  source: Source;
  tc: TimeControl;
  color: "white" | "black";
  opponent: string;
  oppElo: number;
  myElo: number;
  result: Result;
  opening: string;
  eco: string;
  moves: number;
  accuracy: number | null;
  accuracyOpening?: number | null;
  accuracyMiddlegame?: number | null;
  accuracyEndgame?: number | null;
  analyzed: boolean;
  tags: string[];
  note?: string;
  sans?: string[];
}

export const profile = {
  name: "Tom",
  ccUser: "Torim98",
  liUser: "Torim98",
  lastSync: "vor 12 Minuten",
};

export const ratings = [
  {
    id: "cc-rapid",
    platform: "chess.com" as Source,
    tc: "Rapid",
    timeClass: "rapid",
    value: 1462,
    delta: +24,
    spark: [1408, 1415, 1399, 1422, 1431, 1418, 1440, 1436, 1451, 1447, 1458, 1462],
    url: "https://www.chess.com/member/Torim98",
  },
  {
    id: "cc-blitz",
    platform: "chess.com" as Source,
    tc: "Blitz",
    timeClass: "blitz",
    value: 1287,
    delta: -11,
    spark: [1305, 1312, 1298, 1310, 1290, 1301, 1284, 1296, 1302, 1288, 1295, 1287],
    url: "https://www.chess.com/member/Torim98",
  },
  {
    id: "li-rapid",
    platform: "lichess" as Source,
    tc: "Rapid",
    timeClass: "rapid",
    value: 1521,
    delta: +37,
    spark: [1454, 1462, 1471, 1459, 1480, 1476, 1492, 1488, 1500, 1509, 1515, 1521],
    url: "https://lichess.org/@/Torim98",
  },
  {
    id: "li-puzzle",
    platform: "lichess" as Source,
    tc: "Puzzle",
    // Puzzles sind keine Bedenkzeitklasse · diese Karte filtert deshalb nichts.
    timeClass: "",
    value: 1850,
    delta: +52,
    spark: [1730, 1748, 1741, 1765, 1772, 1790, 1781, 1804, 1812, 1826, 1838, 1850],
    url: "https://lichess.org/@/Torim98/puzzles",
  },
];

// Sechs Monate Rating-Verlauf, zwei Serien
export const ratingHistory = Array.from({ length: 6 }, (_, i) => {
  const cc = [
    1380, 1388, 1375, 1392, 1401, 1396, 1410, 1404, 1398, 1415, 1422, 1417, 1430,
    1424, 1436, 1429, 1441, 1435, 1448, 1443, 1439, 1452, 1447, 1455, 1458, 1462,
  ][i * 5];
  const li = [
    1440, 1448, 1455, 1446, 1460, 1467, 1459, 1472, 1465, 1478, 1470, 1483, 1476,
    1488, 1481, 1493, 1487, 1499, 1492, 1504, 1497, 1508, 1512, 1506, 1517, 1521,
  ][i * 5];
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - (5 - i));
  return { month: date.toLocaleDateString("de-DE", { month: "short" }), cc, li };
});

export const games: Game[] = [
  {
    id: "g1", date: "11.07.2026", source: "chess.com", tc: "Rapid", color: "white",
    opponent: "DragonSlayer_88", oppElo: 1448, myElo: 1462, result: "win",
    opening: "Italienische Partie", eco: "C50", moves: 19, accuracy: 91.2, analyzed: true,
    tags: ["Italienisch", "Miniatur"],
    note: "Springergabel-Motiv nach d4-Durchbruch · genau die Struktur aus dem Repertoire-Training.",
    sans: ["e4","e5","Nf3","Nc6","Bc4","Bc5","c3","Nf6","d3","d6","O-O","O-O","Re1","a6","Bb3","Ba7","h3","h6","Nbd2","Be6","Bxe6","fxe6","Nf1","Qe8","Ng3","Nh7","d4","exd4","cxd4","e5","dxe5","dxe5","Nxe5","Nxe5","Qd5+","Kh8","Qxe5","Qg6"],
  },
  {
    id: "g2", date: "11.07.2026", source: "chess.com", tc: "Blitz", color: "black",
    opponent: "Matteo_Rossi", oppElo: 1301, myElo: 1290, result: "loss",
    opening: "Sizilianisch: Najdorf", eco: "B90", moves: 34, accuracy: 76.8, analyzed: true,
    tags: ["Sizilianisch", "Zeitnot"],
    sans: ["e4","c5","Nf3","d6","d4","cxd4","Nxd4","Nf6","Nc3","a6","Be3","e5","Nb3","Be6"],
  },
  {
    id: "g3", date: "10.07.2026", source: "lichess", tc: "Rapid", color: "white",
    opponent: "karpov_fanboy", oppElo: 1534, myElo: 1515, result: "win",
    opening: "Italienische Partie", eco: "C54", moves: 41, accuracy: 88.4, analyzed: true,
    tags: ["Italienisch", "Endspiel"],
    sans: ["e4","e5","Nf3","Nc6","Bc4","Bc5","c3","Nf6","d3","d6","O-O","O-O"],
  },
  {
    id: "g4", date: "10.07.2026", source: "lichess", tc: "Blitz", color: "black",
    opponent: "NimzoNico", oppElo: 1362, myElo: 1350, result: "draw",
    opening: "Caro-Kann: Vorstoßvariante", eco: "B12", moves: 52, accuracy: 82.1, analyzed: false,
    tags: ["Caro-Kann"],
    sans: ["e4","c6","d4","d5","e5","Bf5","Nf3","e6","Be2","Nd7"],
  },
  {
    id: "g5", date: "09.07.2026", source: "chess.com", tc: "Rapid", color: "black",
    opponent: "TalMagic1936", oppElo: 1490, myElo: 1455, result: "win",
    opening: "Damengambit Abgelehnt", eco: "D37", moves: 38, accuracy: 89.7, analyzed: true,
    tags: ["QGD", "Bestes Spiel"],
    note: "Minoritätsangriff sauber durchgezogen. Merken: Turm gehört auf die halboffene b-Linie.",
    sans: ["d4","d5","c4","e6","Nc3","Nf6","Nf3","Be7","Bf4","O-O","e3","c5"],
  },
  {
    id: "g6", date: "08.07.2026", source: "chess.com", tc: "Bullet", color: "white",
    opponent: "PreMoveKing", oppElo: 1240, myElo: 1265, result: "loss",
    opening: "Skandinavisch", eco: "B01", moves: 27, accuracy: null, analyzed: false,
    tags: [],
    sans: ["e4","d5","exd5","Qxd5","Nc3","Qa5","d4","Nf6","Nf3","c6"],
  },
  {
    id: "g7", date: "07.07.2026", source: "lichess", tc: "Rapid", color: "white",
    opponent: "endgame_enjoyer", oppElo: 1502, myElo: 1508, result: "win",
    opening: "Italienische Partie", eco: "C53", moves: 45, accuracy: 85.9, analyzed: true,
    tags: ["Italienisch"],
    sans: ["e4","e5","Nf3","Nc6","Bc4","Bc5","c3","Nf6","d3","a6"],
  },
  {
    id: "g8", date: "06.07.2026", source: "chess.com", tc: "Blitz", color: "black",
    opponent: "HansN_NotCheating", oppElo: 1330, myElo: 1295, result: "loss",
    opening: "Londoner System", eco: "D02", moves: 31, accuracy: 74.2, analyzed: true,
    tags: ["London", "Patzer"],
    note: "Schon wieder gegen London verloren. Dringend Plan gegen Bf4-Aufbau erarbeiten!",
    sans: ["d4","d5","Bf4","Nf6","e3","c5","c3","Nc6","Nd2","e6"],
  },
  {
    id: "g9", date: "05.07.2026", source: "lichess", tc: "Blitz", color: "white",
    opponent: "CoffeeHouseCarl", oppElo: 1344, myElo: 1352, result: "win",
    opening: "Legal-Falle", eco: "C41", moves: 7, accuracy: 97.5, analyzed: true,
    tags: ["Miniatur", "Falle"],
    note: "Legal-Matt auf dem Brett! Der Klassiker funktioniert auch 2026 noch.",
    sans: ["e4","e5","Nf3","d6","Bc4","Bg4","Nc3","g6","Nxe5","Bxd1","Bxf7+","Ke7","Nd5#"],
  },
  {
    id: "g10", date: "04.07.2026", source: "chess.com", tc: "Rapid", color: "black",
    opponent: "QueensGambitFan", oppElo: 1411, myElo: 1447, result: "win",
    opening: "Damengambit Abgelehnt", eco: "D35", moves: 44, accuracy: 86.3, analyzed: false,
    tags: ["QGD"],
    sans: ["d4","d5","c4","e6","Nc3","Nf6","cxd5","exd5","Bg5","Be7"],
  },
  {
    id: "g11", date: "03.07.2026", source: "lichess", tc: "Rapid", color: "white",
    opponent: "BlunderBuster", oppElo: 1489, myElo: 1501, result: "draw",
    opening: "Sizilianisch: Alapin", eco: "B22", moves: 61, accuracy: 83.8, analyzed: true,
    tags: ["Sizilianisch", "Endspiel"],
    sans: ["e4","c5","c3","Nf6","e5","Nd5","d4","cxd4","Nf3","Nc6"],
  },
  {
    id: "g12", date: "02.07.2026", source: "chess.com", tc: "Blitz", color: "white",
    opponent: "f6_is_always_wrong", oppElo: 1275, myElo: 1280, result: "win",
    opening: "Schäfermatt-Versuch", eco: "C20", moves: 4, accuracy: 99.1, analyzed: false,
    tags: ["Miniatur"],
    sans: ["e4","e5","Bc4","Nc6","Qh5","Nf6","Qxf7#"],
  },
];

// ── Analyse: ausgewählte Partie mit Evals & Annotationen ────────────────────
export interface AnalyzedMove {
  san: string;
  eval: number; // Centipawns aus Weiß-Sicht
  nag?: "!!" | "!" | "!?" | "?!" | "?" | "??";
  comment?: string;
  /**
   * Was die Auto-Analyse an dem Zug erkannt hätte · Motivname und Felder, wie
   * `src-tauri/src/motifs.rs` sie ablegt.
   *
   * Absichtlich Daten und kein Text: Die Vorschau schickt sie durch dieselbe
   * Satzmaschine wie die App (`lib/erklaerung.ts`) und zeigt damit, was die
   * Engine sagen würde — in der Sprache, die gerade eingestellt ist. Ein
   * fertiger Satz stünde hier nur auf Deutsch.
   */
  motif?: string;
  motifDetail?: string;
  lossCp?: number;
}

export const featuredGame = {
  gameId: "g1",
  white: "Torim98 (1462)",
  black: "DragonSlayer_88 (1448)",
  event: "chess.com Rapid · 11.07.2026",
  result: "1–0",
  engine: "Stockfish 19 · Tiefe 24 · 1,8 Mn/s",
  summary: { brilliant: 0, good: 1, inaccuracy: 1, mistake: 2, blunder: 1, acplWhite: 18, acplBlack: 64 },
  moves: [
    { san: "e4", eval: 30 }, { san: "e5", eval: 25 },
    { san: "Nf3", eval: 30 }, { san: "Nc6", eval: 28 },
    { san: "Bc4", eval: 25 }, { san: "Bc5", eval: 30 },
    { san: "c3", eval: 20 }, { san: "Nf6", eval: 25 },
    { san: "d3", eval: 18 }, { san: "d6", eval: 22 },
    { san: "O-O", eval: 20 }, { san: "O-O", eval: 18 },
    { san: "Re1", eval: 15 }, { san: "a6", eval: 25 },
    { san: "Bb3", eval: 20 }, { san: "Ba7", eval: 22 },
    { san: "h3", eval: 15 }, { san: "h6", eval: 20 },
    { san: "Nbd2", eval: 18 }, { san: "Be6", eval: 10 },
    { san: "Bxe6", eval: 12 }, { san: "fxe6", eval: 15 },
    { san: "Nf1", eval: 10 },
    {
      san: "Qe8",
      eval: 35,
      nag: "?!",
      comment: "Zu passiv. Besser war 12…d5 mit sofortigem Gegenspiel im Zentrum.",
      motif: "none",
      motifDetail: JSON.stringify({ best: "d5" }),
      lossCp: 25,
    },
    { san: "Ng3", eval: 30 },
    { san: "Nh7", eval: 90, nag: "?", comment: "Der Springer steht am Rand ohne Perspektive. Weiß bekommt freie Hand im Zentrum." },
    { san: "d4", eval: 85 }, { san: "exd4", eval: 95 },
    { san: "cxd4", eval: 90 },
    { san: "e5", eval: 190, nag: "?", comment: "Öffnet die Stellung zum falschen Zeitpunkt · die weißen Figuren stehen besser." },
    { san: "dxe5", eval: 185 }, { san: "dxe5", eval: 195 },
    { san: "Nxe5", eval: 210, nag: "!", comment: "Nutzt die Fesselung des e-Bauern: nach 17…Nxe5 folgt die Gabel auf d5." },
    {
      san: "Nxe5",
      eval: 520,
      nag: "??",
      comment: "Verliert eine Figur. Nach 18.Qd5+ gibt es keine Verteidigung von e5 und g8 zugleich.",
      motif: "fork",
      motifDetail: JSON.stringify({
        best: "Qe7",
        reply: "Qd5+",
        piece: "Q",
        square: "d5",
        targets: [
          { piece: "K", square: "g8" },
          { piece: "N", square: "e5" },
        ],
      }),
      lossCp: 310,
    },
    { san: "Qd5+", eval: 510 }, { san: "Kh8", eval: 515 },
    { san: "Qxe5", eval: 505 }, { san: "Qg6", eval: 540 },
  ] as AnalyzedMove[],
  /**
   * Das Fazit, wie `src-tauri/src/verdict.rs` es ablegt · Bausteine, keine
   * Sätze. Gesetzt wird es in `lib/erklaerung.ts`.
   */
  verdict: JSON.stringify([
    { key: "verdict.grade.mixed", params: { acc: 74.6 } },
    { key: "verdict.versus.better", params: { opp: 61.2 } },
    { key: "verdict.errors.count", params: { inaccuracies: 1, mistakes: 2, blunders: 1 } },
    { key: "verdict.phase.middlegame", params: { acc: 68.4 } },
    { key: "verdict.turningPoint", params: { n: 17, san: "Nxe5" } },
  ]),
  pvLines: [
    { eval: "+5,4", depth: 24, line: "20.Nf5 Qxg2+?? 21.Qxg2 · oder 20…Qf7 21.Qxc7 mit Mehrfigur und Angriff" },
    { eval: "+4,9", depth: 24, line: "20.Re3 Rf6 21.Qxc7 Raf8 22.Qe5 · Weiß konsolidiert mit Mehrfigur" },
    { eval: "+4,1", depth: 23, line: "20.Qe3 e5 21.Nf5 Rf6 22.Qg3 · auch hier bleibt die Figur mehr" },
  ],
};

// ── Repertoire ───────────────────────────────────────────────────────────────
export interface RepNode {
  id: string;
  label: string;
  moveSeq: string[];
  due: number;
  score: number; // Erfolgsquote Training in %
  children?: RepNode[];
}

export const repertoire: { side: "Weiß" | "Schwarz"; nodes: RepNode[] }[] = [
  {
    side: "Weiß",
    nodes: [
      {
        id: "w1", label: "Italienische Partie", moveSeq: ["e4", "e5", "Nf3", "Nc6", "Bc4"], due: 6, score: 92,
        children: [
          {
            id: "w1a", label: "Giuoco Pianissimo (3…Bc5 4.c3)", moveSeq: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3"], due: 3, score: 88,
          },
          {
            id: "w1b", label: "Zweispringerspiel (3…Nf6 4.d3)", moveSeq: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d3"], due: 2, score: 79,
          },
          {
            id: "w1c", label: "Ungarische Verteidigung (3…Be7)", moveSeq: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Be7", "d4"], due: 1, score: 95,
          },
        ],
      },
      {
        id: "w2", label: "Offener Sizilianer", moveSeq: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3"], due: 5, score: 74,
        children: [
          { id: "w2a", label: "Najdorf (5…a6 6.Be3)", moveSeq: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Be3"], due: 4, score: 68 },
        ],
      },
    ],
  },
  {
    side: "Schwarz",
    nodes: [
      {
        id: "b1", label: "Damengambit Abgelehnt", moveSeq: ["d4", "d5", "c4", "e6", "Nc3", "Nf6"], due: 3, score: 85,
      },
      {
        id: "b2", label: "Caro-Kann", moveSeq: ["e4", "c6", "d4", "d5"], due: 0, score: 91,
        children: [
          { id: "b2a", label: "Vorstoßvariante (3.e5 Bf5)", moveSeq: ["e4", "c6", "d4", "d5", "e5", "Bf5"], due: 0, score: 87 },
        ],
      },
    ],
  },
];

export const repertoireStats = {
  dueToday: 14,
  positions: 217,
  coverage: 87, // % der letzten 50 Partien im Buch bis Zug 8
  streak: 9,
};

// ── Puzzles ──────────────────────────────────────────────────────────────────
export interface Puzzle {
  id: string;
  fen: string;
  solutionSan: string;
  theme: string;
  rating: number;
  sideToMove: "white" | "black";
}

export const puzzles: Puzzle[] = [
  {
    id: "p1",
    fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
    solutionSan: "Ra8#",
    theme: "Grundreihenmatt",
    rating: 1240,
    sideToMove: "white",
  },
  {
    id: "p2",
    fen: "r4rk1/ppp2ppp/8/8/8/3Q4/PPB2PPP/6K1 w - - 0 1",
    solutionSan: "Qxh7#",
    theme: "Läufer-Dame-Batterie",
    rating: 1490,
    sideToMove: "white",
  },
  {
    id: "p3",
    fen: "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1",
    solutionSan: "Nf7#",
    theme: "Ersticktes Matt",
    rating: 1685,
    sideToMove: "white",
  },
];

export const puzzleStats = {
  rating: 1850,
  solvedTotal: 2841,
  streak: 7,
  todaySolved: 12,
  todayGoal: 20,
  history: [1730, 1748, 1741, 1765, 1772, 1790, 1781, 1804, 1812, 1826, 1838, 1850],
  themes: [
    { name: "Gabel", acc: 91 },
    { name: "Spieß", acc: 88 },
    { name: "Grundreihe", acc: 86 },
    { name: "Abzug", acc: 74 },
    { name: "Zugzwang", acc: 62 },
  ],
};
