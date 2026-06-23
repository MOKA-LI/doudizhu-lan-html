const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3188);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const TURN_SECONDS = 20;
const BOT_THINK_MS = 900;
const AUTO_REDEAL_MS = 1800;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const SUIT_LABELS = {
  1: "heart",
  2: "spade",
  3: "club",
  4: "diamond",
};

const RANK_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const MAX_STRAIGHT_RANK = 14;
const room = createRoom();

function createRoom() {
  return {
    id: randomCode(6),
    createdAt: Date.now(),
    round: 0,
    phase: "lobby",
    seats: [null, null, null],
    players: new Map(),
    logs: [],
    deck: [],
    bottomCards: [],
    currentTurnSeat: null,
    turnDeadlineAt: null,
    landlordSeat: null,
    bidding: null,
    activeCombo: null,
    displayCombo: null,
    turnPasses: new Set(),
    recentActionText: ["", "", ""],
    recentActionCards: [[], [], []],
    multiplier: 1,
    baseBid: 1,
    winnerSeat: null,
    playCounts: [0, 0, 0],
    timer: null,
    sseClients: new Set(),
  };
}

function randomCode(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length).toUpperCase();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function rankLabel(rank) {
  if (rank >= 3 && rank <= 10) {
    return String(rank);
  }
  if (rank === 11) {
    return "J";
  }
  if (rank === 12) {
    return "Q";
  }
  if (rank === 13) {
    return "K";
  }
  if (rank === 14) {
    return "A";
  }
  if (rank === 15) {
    return "2";
  }
  if (rank === 16) {
    return "SJ";
  }
  return "BJ";
}

function cardImageFile(label, suit) {
  if (label === "7") {
    const sevenMap = {
      1: "图层 2.png",
      2: "7.png",
      3: "图层 3.png",
      4: "图层 1.png",
    };
    return sevenMap[suit];
  }
  return `${label}_${suit}.png`;
}

function comboLabel(combo) {
  if (!combo) {
    return "";
  }
  const map = {
    single: "单张",
    pair: "对子",
    triple: "三张",
    tripleSingle: "三带一",
    triplePair: "三带二",
    straight: "顺子",
    pairStraight: "连对",
    plane: "飞机",
    planeSingle: "飞机带单",
    planePair: "飞机带对",
    fourTwoSingles: "四带二",
    fourTwoPairs: "四带两对",
    bomb: "炸弹",
    rocket: "王炸",
  };
  return map[combo.type] || combo.type;
}

function createDeck() {
  const deck = [];
  for (let rank = 3; rank <= 15; rank += 1) {
    const label = rankLabel(rank);
    for (let suit = 1; suit <= 4; suit += 1) {
      deck.push({
        id: `${label}_${suit}_${randomCode(4)}`,
        rank,
        suit,
        label,
        image: `/cards/${encodeURIComponent(cardImageFile(label, suit))}`,
      });
    }
  }
  deck.push({
    id: `N_${randomCode(4)}`,
    rank: 16,
    suit: "joker",
    label: "SJ",
    image: "/cards/N.png",
  });
  deck.push({
    id: `W_${randomCode(4)}`,
    rank: 17,
    suit: "joker",
    label: "BJ",
    image: "/cards/W_.png",
  });
  return shuffle(deck);
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    const suitA = typeof a.suit === "number" ? a.suit : 99;
    const suitB = typeof b.suit === "number" ? b.suit : 99;
    return suitA - suitB;
  });
}

function groupCards(cards) {
  const ranks = new Map();
  for (const card of cards) {
    if (!ranks.has(card.rank)) {
      ranks.set(card.rank, []);
    }
    ranks.get(card.rank).push(card);
  }
  for (const group of ranks.values()) {
    group.sort((a, b) => {
      const suitA = typeof a.suit === "number" ? a.suit : 99;
      const suitB = typeof b.suit === "number" ? b.suit : 99;
      return suitA - suitB;
    });
  }
  return ranks;
}

function nextSeat(seat) {
  return (seat + 1) % 3;
}

function seatDistance(from, to) {
  return (to - from + 3) % 3;
}

function sameTeam(roomState, seatA, seatB) {
  if (roomState.landlordSeat == null) {
    return false;
  }
  const aLandlord = seatA === roomState.landlordSeat;
  const bLandlord = seatB === roomState.landlordSeat;
  return aLandlord === bLandlord;
}

function allPlayersInSeatOrder() {
  return room.seats.map((playerId) => (playerId ? room.players.get(playerId) : null));
}

function clearTimer(roomState) {
  if (roomState.timer) {
    clearTimeout(roomState.timer);
    roomState.timer = null;
  }
  roomState.turnDeadlineAt = null;
}

function logEvent(roomState, text) {
  roomState.logs.unshift({
    id: randomId("log"),
    text,
    at: Date.now(),
  });
  roomState.logs = roomState.logs.slice(0, 30);
}

function resetTable(roomState) {
  roomState.activeCombo = null;
  roomState.turnPasses = new Set();
}

function ensureBots(roomState) {
  const takenNames = new Set(Array.from(roomState.players.values()).map((player) => player.name));
  const botNames = ["阿星", "阿布", "阿杰", "老K", "小满", "红桃Q"];
  for (let seat = 0; seat < 3; seat += 1) {
    if (roomState.seats[seat]) {
      continue;
    }
    let name = botNames.find((candidate) => !takenNames.has(candidate)) || `机器人${seat + 1}`;
    takenNames.add(name);
    const playerId = randomId("bot");
    roomState.players.set(playerId, {
      id: playerId,
      token: null,
      name,
      seat,
      isBot: true,
      connected: true,
      ready: true,
      hand: [],
      role: "farmer",
      totalScore: 0,
      roundDelta: 0,
      lastBid: null,
    });
    roomState.seats[seat] = playerId;
  }
}

function syncLobbyBots(roomState) {
  if (!(roomState.phase === "lobby" || roomState.phase === "roundOver")) {
    return;
  }
  for (let seat = 0; seat < 3; seat += 1) {
    const player = playerAt(seat);
    if (player?.isBot) {
      roomState.players.delete(player.id);
      roomState.seats[seat] = null;
    }
  }
}

function humanPlayersInSeatOrder() {
  return allPlayersInSeatOrder().filter((player) => player && !player.isBot);
}

function everyoneReady(roomState) {
  const humans = humanPlayersInSeatOrder(roomState);
  return humans.length > 0 && humans.every((player) => player.ready);
}

function canStartRound(roomState) {
  return everyoneReady(roomState);
}

function maybeAutoStart() {
  if (!canStartRound(room)) {
    return false;
  }
  startRound();
  return true;
}

function startRound() {
  if (!canStartRound(room)) {
    return { ok: false, error: "至少需要 1 名真人玩家才能开始。" };
  }
  clearTimer(room);
  ensureBots(room);
  room.round += 1;
  room.phase = "dealing";
  room.winnerSeat = null;
  room.landlordSeat = null;
  room.multiplier = 1;
  room.baseBid = 1;
  room.currentTurnSeat = null;
  room.turnDeadlineAt = null;
  room.deck = createDeck();
  room.bottomCards = [];
  room.activeCombo = null;
  room.displayCombo = null;
  room.turnPasses = new Set();
  room.recentActionText = ["", "", ""];
  room.recentActionCards = [[], [], []];
  room.playCounts = [0, 0, 0];

  for (const player of room.players.values()) {
    player.ready = false;
    player.hand = [];
    player.role = "farmer";
    player.roundDelta = 0;
    player.lastBid = null;
  }

  const cards = [...room.deck];
  const players = allPlayersInSeatOrder();
  for (let index = 0; index < 17; index += 1) {
    for (const player of players) {
      player.hand.push(cards.shift());
    }
  }
  for (const player of players) {
    player.hand = sortCards(player.hand);
  }
  room.bottomCards = sortCards(cards.splice(0, 3));
  logEvent(room, `第 ${room.round} 局开始，系统发牌。`);
  broadcastRoom();

  setTimeout(() => {
    const starterSeat = Math.floor(Math.random() * 3);
    room.phase = "bidding";
    room.bidding = {
      starterSeat,
      currentSeat: starterSeat,
      highestBid: 0,
      highestSeat: null,
      turnsTaken: 0,
      history: [],
    };
    room.currentTurnSeat = starterSeat;
    logEvent(room, `${playerAt(starterSeat).name} 先手叫分。`);
    broadcastRoom();
    scheduleTurn();
  }, 1200);

  return { ok: true };
}

function playerAt(seat) {
  const playerId = room.seats[seat];
  return playerId ? room.players.get(playerId) : null;
}

function playerByToken(token) {
  if (!token) {
    return null;
  }
  for (const player of room.players.values()) {
    if (player.token === token) {
      return player;
    }
  }
  return null;
}

function removeCardsFromHand(hand, cardIds) {
  const idSet = new Set(cardIds);
  const remaining = hand.filter((card) => !idSet.has(card.id));
  return remaining.length === hand.length - cardIds.length ? remaining : null;
}

function takeCardsFromHand(hand, cardIds) {
  const idSet = new Set(cardIds);
  const cards = hand.filter((card) => idSet.has(card.id));
  return cards.length === cardIds.length ? cards : null;
}

function detectCombo(cards) {
  const sorted = sortCards(cards);
  const length = sorted.length;
  if (!length) {
    return null;
  }
  const groups = groupCards(sorted);
  const entries = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  const ranks = entries.map(([rank]) => rank);
  const counts = entries.map(([, group]) => group.length);
  const uniqueCount = entries.length;

  if (length === 1) {
    return { type: "single", mainRank: sorted[0].rank, length: 1 };
  }

  if (length === 2) {
    if (ranks.includes(16) && ranks.includes(17)) {
      return { type: "rocket", mainRank: 17, length: 2 };
    }
    if (uniqueCount === 1 && counts[0] === 2) {
      return { type: "pair", mainRank: ranks[0], length: 2 };
    }
    return null;
  }

  if (length === 3 && uniqueCount === 1 && counts[0] === 3) {
    return { type: "triple", mainRank: ranks[0], length: 3 };
  }

  if (length === 4) {
    if (uniqueCount === 1 && counts[0] === 4) {
      return { type: "bomb", mainRank: ranks[0], length: 4 };
    }
    const tripleRank = entries.find(([, group]) => group.length === 3)?.[0];
    if (tripleRank != null) {
      return { type: "tripleSingle", mainRank: tripleRank, length: 4 };
    }
  }

  if (length === 5) {
    const tripleRank = entries.find(([, group]) => group.length === 3)?.[0];
    const pairRank = entries.find(([, group]) => group.length === 2)?.[0];
    if (tripleRank != null && pairRank != null) {
      return { type: "triplePair", mainRank: tripleRank, length: 5 };
    }
  }

  if (isStraight(entries, 1, 5)) {
    return { type: "straight", mainRank: ranks[ranks.length - 1], length };
  }

  if (isStraight(entries, 2, 3) && length % 2 === 0) {
    return { type: "pairStraight", mainRank: ranks[ranks.length - 1], length };
  }

  if (length >= 6) {
    const plane = detectPlane(entries, length);
    if (plane) {
      return plane;
    }
  }

  const quadRank = entries.find(([, group]) => group.length === 4)?.[0];
  if (quadRank != null) {
    if (length === 6) {
      const rest = entries.filter(([rank]) => rank !== quadRank);
      const allSingles = rest.reduce((sum, [, group]) => sum + group.length, 0) === 2 && rest.every(([, group]) => group.length === 1);
      if (allSingles) {
        return { type: "fourTwoSingles", mainRank: quadRank, length: 6 };
      }
    }
    if (length === 8) {
      const rest = entries.filter(([rank]) => rank !== quadRank);
      const allPairs = rest.length === 2 && rest.every(([, group]) => group.length === 2);
      if (allPairs) {
        return { type: "fourTwoPairs", mainRank: quadRank, length: 8 };
      }
    }
  }

  return null;
}

function isStraight(entries, expectedCount, minGroupLength) {
  if (entries.length < minGroupLength) {
    return false;
  }
  for (const [rank, group] of entries) {
    if (rank > MAX_STRAIGHT_RANK || group.length !== expectedCount) {
      return false;
    }
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index][0] !== entries[index - 1][0] + 1) {
      return false;
    }
  }
  return true;
}

function detectPlane(entries, totalLength) {
  const tripleRanks = entries.filter(([, group]) => group.length >= 3 && group[0].rank <= MAX_STRAIGHT_RANK).map(([rank]) => rank);
  if (tripleRanks.length < 2) {
    return null;
  }
  const sequences = findConsecutiveRuns(tripleRanks, 2);
  sequences.sort((a, b) => b.length - a.length || b[b.length - 1] - a[a.length - 1]);
  for (const seq of sequences) {
    const tripleCount = seq.length;
    const countMap = new Map(entries.map(([rank, group]) => [rank, group.length]));
    for (const rank of seq) {
      countMap.set(rank, countMap.get(rank) - 3);
    }
    const leftovers = [...countMap.entries()].filter(([, count]) => count > 0);
    const leftCardCount = leftovers.reduce((sum, [, count]) => sum + count, 0);
    if (totalLength === tripleCount * 3 && leftCardCount === 0) {
      return { type: "plane", mainRank: seq[seq.length - 1], planeLength: tripleCount, length: totalLength };
    }
    if (totalLength === tripleCount * 4 && leftCardCount === tripleCount) {
      return { type: "planeSingle", mainRank: seq[seq.length - 1], planeLength: tripleCount, length: totalLength };
    }
    if (totalLength === tripleCount * 5 && leftCardCount === tripleCount * 2 && leftovers.every(([, count]) => count === 2)) {
      return { type: "planePair", mainRank: seq[seq.length - 1], planeLength: tripleCount, length: totalLength };
    }
  }
  return null;
}

function compareCombos(current, previous) {
  if (!current || !previous) {
    return false;
  }
  if (current.type === "rocket") {
    return true;
  }
  if (previous.type === "rocket") {
    return false;
  }
  if (current.type === "bomb" && previous.type !== "bomb") {
    return true;
  }
  if (current.type !== previous.type) {
    return false;
  }
  if (current.length !== previous.length) {
    return false;
  }
  if ((current.type === "plane" || current.type === "planeSingle" || current.type === "planePair") && current.planeLength !== previous.planeLength) {
    return false;
  }
  return current.mainRank > previous.mainRank;
}

function findConsecutiveRuns(ranks, minLength) {
  const runs = [];
  let current = [];
  for (const rank of ranks.sort((a, b) => a - b)) {
    if (!current.length || rank === current[current.length - 1] + 1) {
      current.push(rank);
    } else {
      if (current.length >= minLength) {
        runs.push([...current]);
      }
      current = [rank];
    }
  }
  if (current.length >= minLength) {
    runs.push([...current]);
  }
  const windows = [];
  for (const run of runs) {
    for (let start = 0; start < run.length; start += 1) {
      for (let end = start + minLength; end <= run.length; end += 1) {
        windows.push(run.slice(start, end));
      }
    }
  }
  return windows;
}

function cardsForRanks(groups, rankSequence, countPerRank) {
  const cards = [];
  for (const rank of rankSequence) {
    const group = groups.get(rank);
    if (!group || group.length < countPerRank) {
      return null;
    }
    cards.push(...group.slice(0, countPerRank));
  }
  return sortCards(cards);
}

function pickSingles(groups, excludedRanks, count) {
  const cards = [];
  for (const [rank, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (excludedRanks.has(rank)) {
      continue;
    }
    for (const card of group) {
      cards.push(card);
      if (cards.length === count) {
        return sortCards(cards);
      }
    }
  }
  return null;
}

function pickPairs(groups, excludedRanks, count) {
  const cards = [];
  let pairCount = 0;
  for (const [rank, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (excludedRanks.has(rank) || group.length < 2) {
      continue;
    }
    cards.push(...group.slice(0, 2));
    pairCount += 1;
    if (pairCount === count) {
      return sortCards(cards);
    }
  }
  return null;
}

function generateLeadCombos(hand) {
  const groups = groupCards(hand);
  const combos = [];
  const pushCombo = (cards) => {
    if (!cards) {
      return;
    }
    const combo = detectCombo(cards);
    if (combo) {
      combos.push({ cards, combo });
    }
  };

  const tripleRuns = findConsecutiveRuns(
    [...groups.entries()].filter(([rank, group]) => group.length >= 3 && rank <= MAX_STRAIGHT_RANK).map(([rank]) => rank),
    2,
  );
  for (const run of tripleRuns.sort((a, b) => b.length - a.length || a[0] - b[0])) {
    const triples = cardsForRanks(groups, run, 3);
    pushCombo(triples);
    pushCombo([...triples, ...(pickSingles(groups, new Set(run), run.length) || [])]);
    pushCombo([...triples, ...(pickPairs(groups, new Set(run), run.length) || [])]);
  }

  for (const run of findConsecutiveRuns(
    [...groups.entries()].filter(([rank, group]) => group.length >= 2 && rank <= MAX_STRAIGHT_RANK).map(([rank]) => rank),
    3,
  )) {
    pushCombo(cardsForRanks(groups, run, 2));
  }

  for (const run of findConsecutiveRuns(
    [...groups.entries()].filter(([rank]) => rank <= MAX_STRAIGHT_RANK).map(([rank]) => rank),
    5,
  )) {
    pushCombo(cardsForRanks(groups, run, 1));
  }

  for (const [rank, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length >= 3) {
      pushCombo(group.slice(0, 3));
      pushCombo([...group.slice(0, 3), ...(pickSingles(groups, new Set([rank]), 1) || [])]);
      pushCombo([...group.slice(0, 3), ...(pickPairs(groups, new Set([rank]), 1) || [])]);
    }
    if (group.length >= 4) {
      pushCombo(group.slice(0, 4));
      pushCombo([...group.slice(0, 4), ...(pickSingles(groups, new Set([rank]), 2) || [])]);
      pushCombo([...group.slice(0, 4), ...(pickPairs(groups, new Set([rank]), 2) || [])]);
    }
    if (group.length >= 2) {
      pushCombo(group.slice(0, 2));
    }
    pushCombo(group.slice(0, 1));
  }

  const rocket = [groups.get(16)?.[0], groups.get(17)?.[0]].filter(Boolean);
  if (rocket.length === 2) {
    pushCombo(rocket);
  }

  const unique = new Map();
  for (const entry of combos) {
    unique.set(entry.cards.map((card) => card.id).sort().join(","), entry);
  }
  return [...unique.values()].sort(compareLeadCandidates);
}

function compareLeadCandidates(a, b) {
  const weight = {
    planePair: 1,
    planeSingle: 2,
    plane: 3,
    pairStraight: 4,
    straight: 5,
    triplePair: 6,
    tripleSingle: 7,
    triple: 8,
    pair: 9,
    single: 10,
    fourTwoPairs: 11,
    fourTwoSingles: 12,
    bomb: 13,
    rocket: 14,
  };
  const typeDiff = weight[a.combo.type] - weight[b.combo.type];
  if (typeDiff !== 0) {
    return typeDiff;
  }
  if (a.combo.type === "single" || a.combo.type === "pair") {
    return a.combo.mainRank - b.combo.mainRank;
  }
  if (a.cards.length !== b.cards.length) {
    return b.cards.length - a.cards.length;
  }
  return a.combo.mainRank - b.combo.mainRank;
}

function generateBeatCombos(hand, targetCombo) {
  const groups = groupCards(hand);
  const results = [];
  const add = (cards) => {
    if (!cards) {
      return;
    }
    const combo = detectCombo(cards);
    if (combo && compareCombos(combo, targetCombo)) {
      results.push({ cards, combo });
    }
  };

  const orderedEntries = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  switch (targetCombo.type) {
    case "single":
      for (const [, group] of orderedEntries) {
        add(group.slice(0, 1));
      }
      break;
    case "pair":
      for (const [, group] of orderedEntries) {
        if (group.length >= 2) {
          add(group.slice(0, 2));
        }
      }
      break;
    case "triple":
      for (const [, group] of orderedEntries) {
        if (group.length >= 3) {
          add(group.slice(0, 3));
        }
      }
      break;
    case "tripleSingle":
      for (const [rank, group] of orderedEntries) {
        if (group.length < 3) {
          continue;
        }
        add([...group.slice(0, 3), ...(pickSingles(groups, new Set([rank]), 1) || [])]);
      }
      break;
    case "triplePair":
      for (const [rank, group] of orderedEntries) {
        if (group.length < 3) {
          continue;
        }
        add([...group.slice(0, 3), ...(pickPairs(groups, new Set([rank]), 1) || [])]);
      }
      break;
    case "straight":
      for (const run of findConsecutiveRuns(
        orderedEntries.filter(([rank, group]) => group.length >= 1 && rank <= MAX_STRAIGHT_RANK).map(([rank]) => rank),
        targetCombo.length,
      )) {
        if (run.length === targetCombo.length) {
          add(cardsForRanks(groups, run, 1));
        }
      }
      break;
    case "pairStraight":
      for (const run of findConsecutiveRuns(
        orderedEntries.filter(([rank, group]) => group.length >= 2 && rank <= MAX_STRAIGHT_RANK).map(([rank]) => rank),
        targetCombo.length / 2,
      )) {
        if (run.length === targetCombo.length / 2) {
          add(cardsForRanks(groups, run, 2));
        }
      }
      break;
    case "plane":
    case "planeSingle":
    case "planePair": {
      for (const run of findConsecutiveRuns(
        orderedEntries.filter(([rank, group]) => group.length >= 3 && rank <= MAX_STRAIGHT_RANK).map(([rank]) => rank),
        targetCombo.planeLength,
      )) {
        if (run.length !== targetCombo.planeLength) {
          continue;
        }
        const triples = cardsForRanks(groups, run, 3);
        if (targetCombo.type === "plane") {
          add(triples);
        }
        if (targetCombo.type === "planeSingle") {
          add([...triples, ...(pickSingles(groups, new Set(run), targetCombo.planeLength) || [])]);
        }
        if (targetCombo.type === "planePair") {
          add([...triples, ...(pickPairs(groups, new Set(run), targetCombo.planeLength) || [])]);
        }
      }
      break;
    }
    case "fourTwoSingles":
      for (const [rank, group] of orderedEntries) {
        if (group.length >= 4) {
          add([...group.slice(0, 4), ...(pickSingles(groups, new Set([rank]), 2) || [])]);
        }
      }
      break;
    case "fourTwoPairs":
      for (const [rank, group] of orderedEntries) {
        if (group.length >= 4) {
          add([...group.slice(0, 4), ...(pickPairs(groups, new Set([rank]), 2) || [])]);
        }
      }
      break;
    case "bomb":
      for (const [, group] of orderedEntries) {
        if (group.length >= 4) {
          add(group.slice(0, 4));
        }
      }
      break;
    default:
      break;
  }

  if (targetCombo.type !== "rocket") {
    for (const [, group] of orderedEntries) {
      if (group.length >= 4) {
        add(group.slice(0, 4));
      }
    }
    const rocket = [groups.get(16)?.[0], groups.get(17)?.[0]].filter(Boolean);
    if (rocket.length === 2) {
      add(rocket);
    }
  }

  const unique = new Map();
  for (const entry of results) {
    unique.set(entry.cards.map((card) => card.id).sort().join(","), entry);
  }
  return [...unique.values()].sort(compareBeatCandidates);
}

function compareBeatCandidates(a, b) {
  const bombWeight = (entry) => (entry.combo.type === "bomb" || entry.combo.type === "rocket" ? 1 : 0);
  const bombDiff = bombWeight(a) - bombWeight(b);
  if (bombDiff !== 0) {
    return bombDiff;
  }
  if (a.combo.mainRank !== b.combo.mainRank) {
    return a.combo.mainRank - b.combo.mainRank;
  }
  return a.cards.length - b.cards.length;
}

function evaluateBid(hand) {
  const groups = groupCards(hand);
  let score = 0;
  let highCards = 0;
  for (const [rank, group] of groups.entries()) {
    if (rank >= 16) {
      score += 4;
      highCards += 2;
    } else if (rank === 15) {
      score += group.length * 1.5;
      highCards += group.length;
    } else if (rank >= 13) {
      score += group.length * 0.75;
      highCards += group.length;
    }
    if (group.length === 4) {
      score += 5;
    } else if (group.length === 3) {
      score += 2.5;
    } else if (group.length === 2) {
      score += 1;
    }
  }
  if (groups.has(16) && groups.has(17)) {
    score += 4;
  }
  const straightRuns = findConsecutiveRuns(
    [...groups.entries()].filter(([rank]) => rank <= MAX_STRAIGHT_RANK).map(([rank]) => rank),
    5,
  );
  if (straightRuns.length) {
    score += Math.min(3, straightRuns[0].length / 2);
  }
  score += highCards * 0.2;
  if (score >= 17) {
    return 3;
  }
  if (score >= 13) {
    return 2;
  }
  if (score >= 9) {
    return 1;
  }
  return 0;
}

function chooseAiBid(player) {
  const desired = evaluateBid(player.hand);
  const minimum = room.bidding.highestBid + 1;
  if (desired < minimum) {
    return 0;
  }
  return Math.min(3, Math.max(minimum, desired));
}

function chooseAiPlay(player) {
  const hand = player.hand;
  const lastCombo = room.activeCombo;
  const leaderSeat = room.displayCombo?.seat ?? null;
  const playerSeat = player.seat;

  if (!lastCombo) {
    const leadChoices = generateLeadCombos(hand);
    const finishing = leadChoices.find((entry) => entry.cards.length === hand.length);
    if (finishing) {
      return finishing.cards;
    }
    return leadChoices.find((entry) => entry.combo.type !== "bomb" && entry.combo.type !== "rocket")?.cards || leadChoices[0]?.cards || null;
  }

  if (leaderSeat != null && sameTeam(room, playerSeat, leaderSeat)) {
    const finishingBeat = generateBeatCombos(hand, lastCombo).find((entry) => entry.cards.length === hand.length);
    return finishingBeat ? finishingBeat.cards : null;
  }

  const candidates = generateBeatCombos(hand, lastCombo);
  if (!candidates.length) {
    return null;
  }
  const opponentSeat = leaderSeat;
  const opponent = opponentSeat != null ? playerAt(opponentSeat) : null;
  const endgame = opponent && opponent.hand.length <= 2;
  const finishing = candidates.find((entry) => entry.cards.length === hand.length);
  if (finishing) {
    return finishing.cards;
  }
  const safe = candidates.filter((entry) => entry.combo.type !== "bomb" && entry.combo.type !== "rocket");
  if (safe.length && !endgame) {
    return safe[0].cards;
  }
  return candidates[0].cards;
}

function finishRound(winnerSeat) {
  clearTimer(room);
  room.phase = "roundOver";
  room.winnerSeat = winnerSeat;

  const landlordWon = winnerSeat === room.landlordSeat;
  const farmerSeats = [0, 1, 2].filter((seat) => seat !== room.landlordSeat);
  const farmerPlayed = farmerSeats.some((seat) => room.playCounts[seat] > 0);
  const landlordPlayedTimes = room.playCounts[room.landlordSeat];
  const spring = landlordWon ? !farmerPlayed : landlordPlayedTimes <= 1;
  if (spring) {
    room.multiplier *= 2;
    logEvent(room, "触发春天，本局倍数翻倍。");
  }

  const roundScore = room.baseBid * room.multiplier;
  for (const player of room.players.values()) {
    player.roundDelta = 0;
  }
  const landlord = playerAt(room.landlordSeat);
  if (landlordWon) {
    landlord.roundDelta = roundScore * 2;
    landlord.totalScore += landlord.roundDelta;
    for (const seat of farmerSeats) {
      const farmer = playerAt(seat);
      farmer.roundDelta = -roundScore;
      farmer.totalScore += farmer.roundDelta;
    }
    logEvent(room, `${landlord.name} 获胜，本局结算 ${roundScore} 分。`);
  } else {
    landlord.roundDelta = -roundScore * 2;
    landlord.totalScore += landlord.roundDelta;
    for (const seat of farmerSeats) {
      const farmer = playerAt(seat);
      farmer.roundDelta = roundScore;
      farmer.totalScore += farmer.roundDelta;
    }
    logEvent(room, `农民获胜，本局结算 ${roundScore} 分。`);
  }

  broadcastRoom();
}

function enterPlayPhase(landlordSeat) {
  room.phase = "playing";
  room.landlordSeat = landlordSeat;
  room.currentTurnSeat = landlordSeat;
  const landlord = playerAt(landlordSeat);
  landlord.role = "landlord";
  landlord.hand = sortCards([...landlord.hand, ...room.bottomCards]);
  room.recentActionText = ["", "", ""];
  room.recentActionCards = [[], [], []];
  room.activeCombo = null;
  room.displayCombo = null;
  room.turnPasses = new Set();
  logEvent(room, `${landlord.name} 成为地主，底牌已亮出。`);
  broadcastRoom();
  scheduleTurn();
}

function resolveBid(player, bid) {
  if (room.phase !== "bidding" || room.currentTurnSeat !== player.seat) {
    return { ok: false, error: "现在不是你的叫分回合。" };
  }
  if (![0, 1, 2, 3].includes(bid)) {
    return { ok: false, error: "叫分只能是 0 到 3。" };
  }
  if (bid > 0 && bid <= room.bidding.highestBid) {
    return { ok: false, error: "叫分必须高于当前最高分。" };
  }

  clearTimer(room);
  player.lastBid = bid;
  room.bidding.history.push({ seat: player.seat, bid });
  room.bidding.turnsTaken += 1;
  room.recentActionText[player.seat] = bid === 0 ? "不叫" : `${bid} 分`;
  room.recentActionCards[player.seat] = [];

  if (bid > room.bidding.highestBid) {
    room.bidding.highestBid = bid;
    room.bidding.highestSeat = player.seat;
    room.baseBid = bid;
    logEvent(room, `${player.name} 叫 ${bid} 分。`);
  } else {
    logEvent(room, `${player.name} 选择不叫。`);
  }

  if (bid === 3) {
    enterPlayPhase(player.seat);
    return { ok: true };
  }

  if (room.bidding.turnsTaken >= 3) {
    if (room.bidding.highestSeat == null) {
      room.phase = "dealing";
      room.bidding = null;
      logEvent(room, "本轮无人叫分，系统重新洗牌。");
      broadcastRoom();
      setTimeout(() => {
        startRound();
      }, AUTO_REDEAL_MS);
      return { ok: true };
    }
    enterPlayPhase(room.bidding.highestSeat);
    return { ok: true };
  }

  room.currentTurnSeat = nextSeat(player.seat);
  room.bidding.currentSeat = room.currentTurnSeat;
  broadcastRoom();
  scheduleTurn();
  return { ok: true };
}

function resolvePlay(player, cardIds) {
  if (room.phase !== "playing" || room.currentTurnSeat !== player.seat) {
    return { ok: false, error: "现在不是你的出牌回合。" };
  }
  if (!Array.isArray(cardIds) || !cardIds.length) {
    return { ok: false, error: "请选择要出的牌。" };
  }
  const cards = takeCardsFromHand(player.hand, cardIds);
  if (!cards) {
    return { ok: false, error: "所选牌不存在于你的手牌中。" };
  }
  const combo = detectCombo(cards);
  if (!combo) {
    return { ok: false, error: "当前选择不是有效牌型。" };
  }
  if (room.activeCombo && !compareCombos(combo, room.activeCombo)) {
    return { ok: false, error: "你出的牌压不过当前牌面。" };
  }

  clearTimer(room);
  player.hand = sortCards(removeCardsFromHand(player.hand, cardIds));
  room.activeCombo = combo;
  room.displayCombo = {
    seat: player.seat,
    combo,
    cards: sortCards(cards),
  };
  room.turnPasses = new Set();
  room.recentActionText = ["", "", ""];
  room.recentActionCards = [[], [], []];
  room.recentActionText[player.seat] = comboLabel(combo);
  room.recentActionCards[player.seat] = sortCards(cards);
  room.playCounts[player.seat] += 1;
  logEvent(room, `${player.name} 出了 ${comboLabel(combo)}。`);

  if (combo.type === "bomb" || combo.type === "rocket") {
    room.multiplier *= 2;
    logEvent(room, `${comboLabel(combo)} 生效，当前倍数 x${room.multiplier}。`);
  }

  if (player.hand.length === 0) {
    finishRound(player.seat);
    return { ok: true };
  }

  room.currentTurnSeat = nextSeat(player.seat);
  broadcastRoom();
  scheduleTurn();
  return { ok: true };
}

function resolvePass(player) {
  if (room.phase !== "playing" || room.currentTurnSeat !== player.seat) {
    return { ok: false, error: "现在不是你的操作回合。" };
  }
  if (!room.activeCombo) {
    return { ok: false, error: "当前轮到你领牌，不能不出。" };
  }

  clearTimer(room);
  room.turnPasses.add(player.seat);
  room.recentActionText[player.seat] = "不出";
  room.recentActionCards[player.seat] = [];
  logEvent(room, `${player.name} 不出。`);

  if (room.turnPasses.size >= 2) {
    const leadSeat = room.displayCombo.seat;
    room.currentTurnSeat = leadSeat;
    room.activeCombo = null;
    room.turnPasses = new Set();
    logEvent(room, `${playerAt(leadSeat).name} 获得新一轮出牌权。`);
  } else {
    room.currentTurnSeat = nextSeat(player.seat);
  }

  broadcastRoom();
  scheduleTurn();
  return { ok: true };
}

function getHint(player) {
  if (room.phase !== "playing" || room.currentTurnSeat !== player.seat) {
    return [];
  }
  if (!room.activeCombo) {
    return generateLeadCombos(player.hand)[0]?.cards || [];
  }
  return generateBeatCombos(player.hand, room.activeCombo)[0]?.cards || [];
}

function scheduleTurn() {
  clearTimer(room);
  const seat = room.currentTurnSeat;
  const player = seat != null ? playerAt(seat) : null;
  if (!player) {
    return;
  }
  room.turnDeadlineAt = Date.now() + TURN_SECONDS * 1000;
  broadcastRoom();

  if (player.isBot || !player.connected) {
    room.timer = setTimeout(() => {
      performAutoAction(player);
    }, BOT_THINK_MS);
    return;
  }

  room.timer = setTimeout(() => {
    performAutoAction(player);
  }, TURN_SECONDS * 1000);
}

function performAutoAction(player) {
  if (room.phase === "bidding" && room.currentTurnSeat === player.seat) {
    resolveBid(player, player.isBot ? chooseAiBid(player) : 0);
    return;
  }
  if (room.phase === "playing" && room.currentTurnSeat === player.seat) {
    const autoCards = chooseAiPlay(player);
    if (autoCards?.length) {
      resolvePlay(
        player,
        autoCards.map((card) => card.id),
      );
      return;
    }
    if (room.activeCombo) {
      resolvePass(player);
      return;
    }
    const hint = getHint(player);
    if (hint.length) {
      resolvePlay(
        player,
        hint.map((card) => card.id),
      );
    }
  }
}

function buildSeatState(player, revealHand = false) {
  if (!player) {
    return null;
  }
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    isBot: player.isBot,
    ready: player.ready,
    connected: player.connected,
    role: player.role,
    totalScore: player.totalScore,
    roundDelta: player.roundDelta,
    lastBid: player.lastBid,
    cardCount: player.hand.length,
    hand: revealHand ? serializeCards(player.hand) : undefined,
  };
}

function serializeCards(cards) {
  return sortCards(cards).map((card) => ({
    id: card.id,
    rank: card.rank,
    label: card.label,
    suit: SUIT_LABELS[card.suit] || card.suit,
    image: card.image,
  }));
}

function baseState() {
  return {
    roomId: room.id,
    phase: room.phase,
    round: room.round,
    landlordSeat: room.landlordSeat,
    currentTurnSeat: room.currentTurnSeat,
    turnDeadlineAt: room.turnDeadlineAt,
    baseBid: room.baseBid,
    multiplier: room.multiplier,
    winnerSeat: room.winnerSeat,
    logs: room.logs,
    seats: allPlayersInSeatOrder().map((player) => buildSeatState(player, room.phase === "roundOver")),
    bottomCards:
      room.phase === "playing" || room.phase === "roundOver"
        ? serializeCards(room.bottomCards)
        : room.bottomCards.map(() => ({ hidden: true })),
    recentActionText: room.recentActionText,
    recentActionCards: room.recentActionCards.map((cards) => serializeCards(cards)),
    displayCombo: room.displayCombo
      ? {
          seat: room.displayCombo.seat,
          comboLabel: comboLabel(room.displayCombo.combo),
          cards: serializeCards(room.displayCombo.cards),
        }
      : null,
    bidding: room.bidding,
    joinUrl: null,
    localIps: getLocalIps(),
  };
}

function buildPublicState(host) {
  const state = baseState();
  state.view = "screen";
  state.joinUrl = `http://${resolveJoinHost(host)}/player?room=${encodeURIComponent(room.id)}`;
  state.canStart = canStartRound(room) && (room.phase === "lobby" || room.phase === "roundOver");
  return state;
}

function buildPlayerState(player, host) {
  const state = baseState();
  state.view = "player";
  state.joinUrl = `http://${resolveJoinHost(host)}/player?room=${encodeURIComponent(room.id)}`;
  state.me = player
    ? {
        id: player.id,
        name: player.name,
        seat: player.seat,
        isBot: player.isBot,
        role: player.role,
        ready: player.ready,
        totalScore: player.totalScore,
        roundDelta: player.roundDelta,
        hand: serializeCards(player.hand),
        lastBid: player.lastBid,
      }
    : null;
  state.canReady = !!player && (room.phase === "lobby" || room.phase === "roundOver");
  state.canStart = !!player && canStartRound(room) && (room.phase === "lobby" || room.phase === "roundOver");
  state.myTurn = !!player && room.currentTurnSeat === player.seat;
  state.canPass = !!player && room.phase === "playing" && room.currentTurnSeat === player.seat && !!room.activeCombo;
  state.hintAvailable = !!player && room.phase === "playing" && room.currentTurnSeat === player.seat;
  return state;
}

function broadcastRoom() {
  for (const client of room.sseClients) {
    const host = client.host;
    const payload =
      client.view === "screen"
        ? buildPublicState(host)
        : buildPlayerState(playerByToken(client.token), host);
    client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const network of Object.values(interfaces)) {
    for (const item of network || []) {
      if (item.family === "IPv4" && !item.internal) {
        ips.push(item.address);
      }
    }
  }
  return [...new Set(ips)];
}

function resolveJoinHost(requestHost) {
  const fallbackHost = requestHost || `127.0.0.1:${PORT}`;
  try {
    const parsed = new URL(`http://${fallbackHost}`);
    const port = parsed.port || String(PORT);
    const hostname = parsed.hostname;
    if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") {
      const lanIp = getLocalIps()[0];
      return lanIp ? `${lanIp}:${port}` : fallbackHost;
    }
    return fallbackHost;
  } catch {
    return fallbackHost;
  }
}

function resetLobby() {
  clearTimer(room);
  room.phase = "lobby";
  room.round = 0;
  room.landlordSeat = null;
  room.bottomCards = [];
  room.currentTurnSeat = null;
  room.winnerSeat = null;
  room.multiplier = 1;
  room.baseBid = 1;
  room.bidding = null;
  room.activeCombo = null;
  room.displayCombo = null;
  room.turnPasses = new Set();
  room.recentActionText = ["", "", ""];
  room.recentActionCards = [[], [], []];
  room.playCounts = [0, 0, 0];
  logEvent(room, "已返回大厅。");

  const humanPlayers = [];
  for (const player of room.players.values()) {
    if (!player.isBot) {
      humanPlayers.push(player);
    }
  }
  room.players.clear();
  room.seats = [null, null, null];

  for (const player of humanPlayers) {
    player.ready = false;
    player.role = "farmer";
    player.hand = [];
    player.lastBid = null;
    player.roundDelta = 0;
    room.players.set(player.id, player);
    room.seats[player.seat] = player.id;
  }
  syncLobbyBots(room);
  broadcastRoom();
}

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveStaticFile(res, filePath) {
  if (!filePath.startsWith(ROOT)) {
    notFound(res);
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      notFound(res);
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

function handleJoin(body, host, res) {
  const name = String(body.name || "").trim().slice(0, 12);
  const seat = Number(body.seat);
  if (!name) {
    jsonResponse(res, 400, { ok: false, error: "请输入玩家昵称。" });
    return;
  }
  if (![0, 1, 2].includes(seat)) {
    jsonResponse(res, 400, { ok: false, error: "请选择有效座位。" });
    return;
  }
  if (!(room.phase === "lobby" || room.phase === "roundOver")) {
    jsonResponse(res, 400, { ok: false, error: "当前对局已开始，请等下一局加入。" });
    return;
  }

  const occupant = playerAt(seat);
  if (occupant && !occupant.isBot) {
    jsonResponse(res, 400, { ok: false, error: "该座位已有真人玩家。" });
    return;
  }
  if (occupant && occupant.isBot) {
    room.players.delete(occupant.id);
  }

  const playerId = randomId("player");
  const token = randomId("token");
  const player = {
    id: playerId,
    token,
    name,
    seat,
    isBot: false,
    connected: true,
    ready: false,
    hand: [],
    role: "farmer",
    totalScore: 0,
    roundDelta: 0,
    lastBid: null,
  };
  room.players.set(playerId, player);
  room.seats[seat] = playerId;
  syncLobbyBots(room);
  logEvent(room, `${name} 坐到了 ${seatLabel(seat)}。`);
  broadcastRoom();
  jsonResponse(res, 200, {
    ok: true,
    token,
    playerId,
    state: buildPlayerState(player, host),
  });
}

function seatLabel(seat) {
  return ["下家位", "对家位", "上家位"][seat] || `座位${seat + 1}`;
}

function leaveSeat(player) {
  const seat = player.seat;
  room.players.delete(player.id);
  room.seats[seat] = null;
  if (room.phase !== "lobby" && room.phase !== "roundOver") {
    const botId = randomId("bot");
    room.players.set(botId, {
      id: botId,
      token: null,
      name: `机器人${seat + 1}`,
      seat,
      isBot: true,
      connected: true,
      ready: true,
      hand: [...player.hand],
      role: player.role,
      totalScore: player.totalScore,
      roundDelta: player.roundDelta,
      lastBid: player.lastBid,
    });
    room.seats[seat] = botId;
    logEvent(room, `${player.name} 离开，系统接管该位置。`);
    if (room.currentTurnSeat === seat) {
      scheduleTurn();
    }
  } else {
    logEvent(room, `${player.name} 离开了座位。`);
    syncLobbyBots(room);
    maybeAutoStart();
  }
}

function kickSeat(seat) {
  if (![0, 1, 2].includes(seat)) {
    return { ok: false, error: "请选择有效座位。" };
  }
  const occupant = playerAt(seat);
  if (!occupant || occupant.isBot) {
    return { ok: false, error: "该座位没有可踢出的真人玩家。" };
  }
  logEvent(room, `${occupant.name} 被公屏移出座位。`);
  leaveSeat(occupant);
  return { ok: true };
}

function handleAction(body, host, res) {
  const action = body.action;
  const player = playerByToken(body.token);
  let result = { ok: false, error: "未知操作。" };

  switch (action) {
    case "ready":
      if (!player) {
        result = { ok: false, error: "玩家身份失效，请重新加入。" };
        break;
      }
      if (!(room.phase === "lobby" || room.phase === "roundOver")) {
        result = { ok: false, error: "当前阶段不能准备。" };
        break;
      }
      player.ready = !player.ready;
      logEvent(room, `${player.name}${player.ready ? "已准备" : "取消准备"}。`);
      syncLobbyBots(room);
      maybeAutoStart();
      result = { ok: true };
      break;
    case "start":
      result = startRound();
      break;
    case "bid":
      if (!player) {
        result = { ok: false, error: "玩家身份失效，请重新加入。" };
        break;
      }
      result = resolveBid(player, Number(body.bid));
      break;
    case "play":
      if (!player) {
        result = { ok: false, error: "玩家身份失效，请重新加入。" };
        break;
      }
      result = resolvePlay(player, body.cardIds || []);
      break;
    case "pass":
      if (!player) {
        result = { ok: false, error: "玩家身份失效，请重新加入。" };
        break;
      }
      result = resolvePass(player);
      break;
    case "hint":
      if (!player) {
        result = { ok: false, error: "玩家身份失效，请重新加入。" };
        break;
      }
      result = { ok: true, cards: serializeCards(getHint(player)) };
      break;
    case "leave":
      if (!player) {
        result = { ok: false, error: "玩家身份失效，请重新加入。" };
        break;
      }
      leaveSeat(player);
      result = { ok: true };
      break;
    case "kick":
      result = kickSeat(Number(body.seat));
      break;
    case "nextRound":
      if (room.phase !== "roundOver") {
        result = { ok: false, error: "当前还不能开始下一局。" };
        break;
      }
      result = canStartRound(room) ? startRound() : { ok: false, error: "所有真人玩家准备后会自动开始。" };
      break;
    case "resetLobby":
      resetLobby();
      result = { ok: true };
      break;
    default:
      break;
  }

  broadcastRoom();
  jsonResponse(res, result.ok ? 200 : 400, {
    ...result,
    state: player ? buildPlayerState(playerByToken(player.token), host) : buildPublicState(host),
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const host = req.headers.host || `127.0.0.1:${PORT}`;

  if (pathname === "/events") {
    const view = requestUrl.searchParams.get("view") === "screen" ? "screen" : "player";
    const token = requestUrl.searchParams.get("token") || "";
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-store",
    });
    res.write("\n");
    const client = { res, view, token, host };
    room.sseClients.add(client);
    const player = playerByToken(token);
    if (player) {
      player.connected = true;
    }
    const payload = view === "screen" ? buildPublicState(host) : buildPlayerState(player, host);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    req.on("close", () => {
      room.sseClients.delete(client);
      const disconnectedPlayer = playerByToken(token);
      if (disconnectedPlayer) {
        disconnectedPlayer.connected = false;
        broadcastRoom();
      }
    });
    return;
  }

  if (pathname === "/api/bootstrap") {
    const token = requestUrl.searchParams.get("token") || "";
    const view = requestUrl.searchParams.get("view") === "screen" ? "screen" : "player";
    const player = playerByToken(token);
    const payload = view === "screen" ? buildPublicState(host) : buildPlayerState(player, host);
    jsonResponse(res, 200, { ok: true, state: payload });
    return;
  }

  if (pathname === "/api/join" && req.method === "POST") {
    try {
      handleJoin(await readBody(req), host, res);
    } catch (error) {
      jsonResponse(res, 400, { ok: false, error: "加入失败，请检查输入。" });
    }
    return;
  }

  if (pathname === "/api/action" && req.method === "POST") {
    try {
      handleAction(await readBody(req), host, res);
    } catch (error) {
      jsonResponse(res, 400, { ok: false, error: error.message || "操作失败。" });
    }
    return;
  }

  if (pathname === "/") {
    serveStaticFile(res, path.join(PUBLIC_DIR, "index.html"));
    return;
  }

  if (pathname === "/player") {
    serveStaticFile(res, path.join(PUBLIC_DIR, "player.html"));
    return;
  }

  const publicPath = path.join(PUBLIC_DIR, pathname);
  if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
    serveStaticFile(res, publicPath);
    return;
  }

  const assetPath = path.join(ROOT, pathname);
  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    serveStaticFile(res, assetPath);
    return;
  }

  notFound(res);
});

logEvent(room, "房间已创建，等待玩家加入。");
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dou Dizhu server running at http://127.0.0.1:${PORT}`);
  for (const ip of getLocalIps()) {
    console.log(`LAN: http://${ip}:${PORT}`);
  }
});
