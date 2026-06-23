const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get("room") || "";
const seatButtons = [...document.querySelectorAll(".seat-pick")];
const joinPanel = document.getElementById("joinPanel");
const joinBtn = document.getElementById("joinBtn");
const readyBtn = document.getElementById("readyBtn");
const startRoundBtn = document.getElementById("startRoundBtn");
const bid0Btn = document.getElementById("bid0Btn");
const bid1Btn = document.getElementById("bid1Btn");
const bid2Btn = document.getElementById("bid2Btn");
const bid3Btn = document.getElementById("bid3Btn");
const hintBtn = document.getElementById("hintBtn");
const passBtn = document.getElementById("passBtn");
const playBtn = document.getElementById("playBtn");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const leaveBtn = document.getElementById("leaveBtn");
const nameInput = document.getElementById("nameInput");
const playerRoomMeta = document.getElementById("playerRoomMeta");
const playerTurnText = document.getElementById("playerTurnText");
const opponentSeats = document.getElementById("opponentSeats");
const playerComboOwner = document.getElementById("playerComboOwner");
const playerComboCards = document.getElementById("playerComboCards");
const playerBottomCards = document.getElementById("playerBottomCards");
const comboTypePill = document.getElementById("comboTypePill");
const miniTableSummary = document.getElementById("miniTableSummary");
const mySeatSummary = document.getElementById("mySeatSummary");
const myHand = document.getElementById("myHand");
const selectedSummary = document.getElementById("selectedSummary");
const playerLogList = document.getElementById("playerLogList");
const modalTableMeta = document.getElementById("modalTableMeta");
const modalTableTurn = document.getElementById("modalTableTurn");
const modalTableComboOwner = document.getElementById("modalTableComboOwner");
const modalTableCards = document.getElementById("modalTableCards");
const modalBottomCards = document.getElementById("modalBottomCards");
const modalOpeners = [...document.querySelectorAll("[data-open-modal]")];
const modalClosers = [...document.querySelectorAll("[data-close-modal]")];
const leftOpponentCard = document.getElementById("leftOpponentCard");
const rightOpponentCard = document.getElementById("rightOpponentCard");
const utilityRow = document.querySelector(".utility-row");
const bidRow = document.querySelector(".bid-row");
const actionRow = document.querySelector(".action-row-center");
const audioController = window.DDZAudio?.createController({ buttonId: "playerAudioToggleBtn" });

const phaseMap = {
  lobby: "大厅待机",
  dealing: "发牌中",
  bidding: "叫分阶段",
  playing: "出牌阶段",
  roundOver: "本局结算",
};

const app = {
  selectedSeat: 0,
  token: localStorage.getItem(`doudizhu_token_${roomId || "default"}`) || "",
  state: null,
  eventSource: null,
  selectedCards: new Set(),
};

seatButtons.forEach((button) => {
  button.addEventListener("click", () => {
    app.selectedSeat = Number(button.dataset.seat);
    seatButtons.forEach((item) => item.classList.toggle("active", item === button));
  });
});
seatButtons[0]?.classList.add("active");

modalOpeners.forEach((button) => {
  button.addEventListener("click", () => openModal(button.dataset.openModal));
});

modalClosers.forEach((button) => {
  button.addEventListener("click", () => closeModal(button.closest(".sheet-modal")?.id));
});

function applySceneTheme(phase) {
  document.body.classList.toggle("theme-lobby", phase === "lobby" || phase === "dealing");
  document.body.classList.toggle("theme-battle", phase === "bidding" || phase === "playing" || phase === "roundOver");
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove("hidden");
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add("hidden");
  }
}

async function postAction(body) {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      token: app.token || body.token,
      roomId,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "操作失败");
  }
  if (payload.state) {
    render(payload.state);
  }
  return payload;
}

async function joinRoom() {
  const name = nameInput.value.trim();
  if (!name) {
    alert("请输入昵称");
    return;
  }
  const response = await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId,
      name,
      seat: app.selectedSeat,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "加入失败");
  }
  app.token = payload.token;
  localStorage.setItem(`doudizhu_token_${roomId || "default"}`, app.token);
  connectEvents();
  render(payload.state);
}

function renderCardStrip(container, cards) {
  container.innerHTML = "";
  for (const card of cards || []) {
    if (!card.image) {
      continue;
    }
    const img = document.createElement("img");
    img.src = card.image;
    img.className = "card-image";
    img.alt = card.label || "card";
    container.appendChild(img);
  }
}

function renderLogs(logs) {
  playerLogList.innerHTML = logs
    .map((item) => `<div class="log-entry">${new Date(item.at).toLocaleTimeString()} ${item.text}</div>`)
    .join("");
}

function sanitizeSelection(hand) {
  const validIds = new Set(hand.map((card) => card.id));
  app.selectedCards = new Set([...app.selectedCards].filter((cardId) => validIds.has(cardId)));
}

function renderHand() {
  const hand = app.state?.me?.hand || [];
  sanitizeSelection(hand);
  myHand.innerHTML = "";
  const center = (hand.length - 1) / 2;
  const rotationStep = hand.length > 15 ? 0.95 : hand.length > 11 ? 1.2 : 1.5;

  hand.forEach((card, index) => {
    const wrapper = document.createElement("button");
    wrapper.type = "button";
    wrapper.className = "hand-card";
    wrapper.style.setProperty("--rotation", `${(index - center) * rotationStep}deg`);
    wrapper.style.setProperty("--depth", String(index + 2));
    if (app.selectedCards.has(card.id)) {
      wrapper.classList.add("selected");
    }

    const img = document.createElement("img");
    img.src = card.image;
    img.alt = card.label;
    wrapper.appendChild(img);

    wrapper.addEventListener("click", () => {
      if (!app.state?.myTurn || app.state.phase !== "playing") {
        return;
      }
      if (app.selectedCards.has(card.id)) {
        app.selectedCards.delete(card.id);
      } else {
        app.selectedCards.add(card.id);
      }
      renderHand();
      updateButtons();
    });
    myHand.appendChild(wrapper);
  });

  selectedSummary.textContent = `已选 ${app.selectedCards.size} 张`;
}

function renderOpponentSummary(container, seat) {
  container.className = "opponent-chip";
  if (!seat) {
    container.textContent = "等待对手";
    return;
  }

  if (app.state?.currentTurnSeat === seat.seat) {
    container.classList.add("current-turn");
  }
  if (app.state?.landlordSeat === seat.seat) {
    container.classList.add("landlord");
  }

  container.innerHTML = `
    <strong>${seat.name}</strong>
    <span>${seat.role === "landlord" ? "地主" : "农民"} · 手牌 ${seat.cardCount}</span>
    <em>${app.state.recentActionText?.[seat.seat] || "等待操作"}</em>
  `;
}

function renderOpponents() {
  const meSeat = app.state?.me?.seat;
  opponentSeats.innerHTML = "";
  const rivals = [];
  for (const seat of app.state?.seats || []) {
    if (!seat || seat.seat === meSeat) {
      continue;
    }
    rivals.push(seat);
    const div = document.createElement("div");
    div.className = "opponent-card";
    div.innerHTML = `
      <div class="opponent-card-head">
        <strong>${seat.name}</strong>
        <span class="tag ${seat.isBot ? "bot" : ""}">${seat.isBot ? "AI" : "真人"}</span>
      </div>
      <div class="meta-line">${seat.role === "landlord" ? "地主" : "农民"} · 手牌 ${seat.cardCount}</div>
      <div class="meta-line">总分 ${seat.totalScore} · 本局 ${seat.roundDelta > 0 ? "+" : ""}${seat.roundDelta}</div>
      <div class="meta-line">${app.state.recentActionText?.[seat.seat] || "等待操作"}</div>
    `;
    opponentSeats.appendChild(div);
  }

  let leftSeat = null;
  let rightSeat = null;

  if (meSeat == null) {
    [leftSeat, rightSeat] = rivals;
  } else {
    const leftSeatIndex = (meSeat + 2) % 3;
    const rightSeatIndex = (meSeat + 1) % 3;
    leftSeat = app.state?.seats?.[leftSeatIndex] || null;
    rightSeat = app.state?.seats?.[rightSeatIndex] || null;
  }

  renderOpponentSummary(leftOpponentCard, leftSeat);
  renderOpponentSummary(rightOpponentCard, rightSeat);
}

function updateButtons() {
  const me = app.state?.me;
  const biddingTurn = app.state?.phase === "bidding" && app.state?.myTurn;
  const playingTurn = app.state?.phase === "playing" && app.state?.myTurn;
  const highestBid = app.state?.bidding?.highestBid || 0;
  const readyPhase = app.state?.phase === "lobby" || app.state?.phase === "roundOver";

  readyBtn.textContent = me?.ready ? "取消准备" : "准备";
  readyBtn.classList.toggle("is-ready", !!me?.ready);
  readyBtn.disabled = !app.state?.canReady;
  startRoundBtn.disabled = !app.state?.canStart;
  nextRoundBtn.disabled = app.state?.phase !== "roundOver";
  hintBtn.disabled = !app.state?.hintAvailable;
  passBtn.disabled = !app.state?.canPass;
  playBtn.disabled = !(playingTurn && app.selectedCards.size);
  bid0Btn.disabled = !biddingTurn;
  bid1Btn.disabled = !biddingTurn || highestBid >= 1;
  bid2Btn.disabled = !biddingTurn || highestBid >= 2;
  bid3Btn.disabled = !biddingTurn || highestBid >= 3;
  leaveBtn.disabled = !me;

  readyBtn.classList.toggle("hidden", !readyPhase || !me);
  startRoundBtn.classList.toggle("hidden", !app.state?.canStart || !readyPhase);
  nextRoundBtn.classList.toggle("hidden", app.state?.phase !== "roundOver");
  bidRow?.classList.toggle("hidden-row", app.state?.phase !== "bidding" || !me);
  actionRow?.classList.toggle("hidden-row", app.state?.phase !== "playing" || !me);
  utilityRow?.classList.toggle(
    "hidden-row",
    !readyPhase || !me || (readyBtn.classList.contains("hidden") && startRoundBtn.classList.contains("hidden") && nextRoundBtn.classList.contains("hidden"))
  );
}

function buildTurnText(state) {
  const currentSeat = state.currentTurnSeat != null ? state.seats[state.currentTurnSeat] : null;
  if (state.phase === "roundOver") {
    const winner = state.seats[state.winnerSeat];
    return winner ? `${winner.name} 获胜，本局结束` : "本局结束";
  }
  if (currentSeat) {
    return `轮到 ${currentSeat.name}${state.phase === "bidding" ? " 叫分" : " 出牌"}`;
  }
  return "等待玩家就位";
}

function render(state) {
  const previousState = app.state;
  audioController?.handleState(previousState, state);
  app.state = state;
  applySceneTheme(state.phase);
  const me = state.me;
  joinPanel.classList.toggle("hidden", !!me);
  playerRoomMeta.textContent = `房号 ${state.roomId} · ${phaseMap[state.phase] || state.phase} · 倍数 x${state.multiplier}`;
  playerTurnText.textContent = buildTurnText(state);
  miniTableSummary.textContent = `底分 ${state.baseBid} · 当前倍数 x${state.multiplier}`;

  const comboOwnerText = state.displayCombo
    ? `${state.seats[state.displayCombo.seat]?.name || "玩家"} · ${state.displayCombo.comboLabel}`
    : "等待出牌";
  playerComboOwner.textContent = comboOwnerText;
  comboTypePill.textContent = state.displayCombo?.comboLabel || "桌面待机";
  renderCardStrip(playerComboCards, state.displayCombo?.cards || []);
  renderCardStrip(playerBottomCards, state.bottomCards || []);

  modalTableMeta.textContent = `房号 ${state.roomId} · ${phaseMap[state.phase] || state.phase}`;
  modalTableTurn.textContent = buildTurnText(state);
  modalTableComboOwner.textContent = comboOwnerText;
  renderCardStrip(modalTableCards, state.displayCombo?.cards || []);
  renderCardStrip(modalBottomCards, state.bottomCards || []);

  renderOpponents();
  renderLogs(state.logs);

  if (me) {
    mySeatSummary.textContent = `${me.name} · 座位 ${me.seat + 1} · ${me.role === "landlord" ? "地主" : "农民"} · 总分 ${me.totalScore}`;
    renderHand();
  } else {
    mySeatSummary.textContent = "未加入座位";
    myHand.innerHTML = "";
    app.selectedCards.clear();
    selectedSummary.textContent = "已选 0 张";
  }

  updateButtons();
}

function connectEvents() {
  app.eventSource?.close();
  app.eventSource = new EventSource(`/events?view=player&token=${encodeURIComponent(app.token)}`);
  app.eventSource.onmessage = (event) => {
    render(JSON.parse(event.data));
  };
}

joinBtn.addEventListener("click", async () => {
  try {
    await joinRoom();
  } catch (error) {
    alert(error.message);
  }
});

readyBtn.addEventListener("click", async () => {
  try {
    await postAction({ action: "ready" });
  } catch (error) {
    alert(error.message);
  }
});

startRoundBtn.addEventListener("click", async () => {
  try {
    await postAction({ action: "start" });
  } catch (error) {
    alert(error.message);
  }
});

bid0Btn.addEventListener("click", () => postAction({ action: "bid", bid: 0 }).catch((error) => alert(error.message)));
bid1Btn.addEventListener("click", () => postAction({ action: "bid", bid: 1 }).catch((error) => alert(error.message)));
bid2Btn.addEventListener("click", () => postAction({ action: "bid", bid: 2 }).catch((error) => alert(error.message)));
bid3Btn.addEventListener("click", () => postAction({ action: "bid", bid: 3 }).catch((error) => alert(error.message)));

hintBtn.addEventListener("click", async () => {
  try {
    const payload = await postAction({ action: "hint" });
    if (!payload.cards?.length) {
      selectedSummary.textContent = "没有可出的牌";
      alert("当前没有可出的牌");
      return;
    }
    app.selectedCards = new Set((payload.cards || []).map((card) => card.id));
    renderHand();
    updateButtons();
  } catch (error) {
    alert(error.message);
  }
});

passBtn.addEventListener("click", () => postAction({ action: "pass" }).catch((error) => alert(error.message)));

playBtn.addEventListener("click", async () => {
  try {
    await postAction({ action: "play", cardIds: [...app.selectedCards] });
    app.selectedCards.clear();
    renderHand();
  } catch (error) {
    alert(error.message);
  }
});

nextRoundBtn.addEventListener("click", async () => {
  try {
    await postAction({ action: "nextRound" });
    app.selectedCards.clear();
  } catch (error) {
    alert(error.message);
  }
});

leaveBtn.addEventListener("click", async () => {
  if (!app.token) {
    return;
  }
  try {
    await postAction({ action: "leave" });
    localStorage.removeItem(`doudizhu_token_${roomId || "default"}`);
    app.token = "";
    app.selectedCards.clear();
    app.eventSource?.close();
    const bootstrap = await fetch("/api/bootstrap?view=player");
    const payload = await bootstrap.json();
    render(payload.state);
    connectEvents();
  } catch (error) {
    alert(error.message);
  }
});

fetch(`/api/bootstrap?view=player${app.token ? `&token=${encodeURIComponent(app.token)}` : ""}`)
  .then((response) => response.json())
  .then((payload) => {
    render(payload.state);
    connectEvents();
  });
