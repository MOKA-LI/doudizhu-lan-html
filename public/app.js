const phaseMap = {
  lobby: "大厅待机",
  dealing: "发牌中",
  bidding: "叫分阶段",
  playing: "出牌阶段",
  roundOver: "本局结算",
};

const state = {
  data: null,
  eventSource: null,
  currentComboSignature: "",
  currentComboData: null,
  archivedComboData: null,
  comboTransitionId: 0,
};

const roomMeta = document.getElementById("roomMeta");
const qrImage = document.getElementById("qrImage");
const joinLink = document.getElementById("joinLink");
const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const resetBtn = document.getElementById("resetBtn");
const phaseText = document.getElementById("phaseText");
const baseBidText = document.getElementById("baseBidText");
const multiplierText = document.getElementById("multiplierText");
const timerText = document.getElementById("timerText");
const logList = document.getElementById("logList");
const bottomCards = document.getElementById("bottomCards");
const comboOwner = document.getElementById("comboOwner");
const comboCards = document.getElementById("comboCards");
const currentComboOwner = document.getElementById("currentComboOwner");
const currentComboCards = document.getElementById("currentComboCards");
const bidHistory = document.getElementById("bidHistory");
const turnBanner = document.getElementById("turnBanner");
const railToggle = document.getElementById("railToggle");
const screenRail = document.getElementById("screenRail");
const roomMetaMini = document.getElementById("roomMetaMini");
const baseBidMirror = document.getElementById("baseBidMirror");
const multiplierMirror = document.getElementById("multiplierMirror");
const phaseMirror = document.getElementById("phaseMirror");
const screenMatchUi = document.querySelector(".screen-match-ui");
const audioController = window.DDZAudio?.createController({ buttonId: "audioToggleBtn" });

function applySceneTheme(phase) {
  document.body.classList.toggle("theme-lobby", phase === "lobby" || phase === "dealing");
  document.body.classList.toggle("theme-battle", phase === "bidding" || phase === "playing" || phase === "roundOver");
}

async function request(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "操作失败");
  }
  return payload;
}

function renderCardStrip(container, cards, allowHidden = false) {
  container.innerHTML = "";
  for (const card of cards || []) {
    if (card.hidden && allowHidden) {
      const back = document.createElement("div");
      back.className = "mini-back";
      container.appendChild(back);
      continue;
    }
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

function comboSignature(combo) {
  if (!combo?.cards?.length) {
    return "";
  }
  return `${combo.seat}:${combo.comboLabel}:${combo.cards.map((card) => card.id || card.label || card.image).join("|")}`;
}

function comboOwnerText(data, combo) {
  if (!combo) {
    return "等待出牌";
  }
  return `${data.seats[combo.seat]?.name || "玩家"} · ${combo.comboLabel}`;
}

function createFlightLayer(cards, className) {
  const layer = document.createElement("div");
  layer.className = className;
  for (const card of cards || []) {
    if (!card.image) {
      continue;
    }
    const img = document.createElement("img");
    img.src = card.image;
    img.className = "card-image";
    img.alt = card.label || "card";
    layer.appendChild(img);
  }
  return layer;
}

function cloneCombo(combo) {
  if (!combo) {
    return null;
  }
  return {
    ...combo,
    cards: [...(combo.cards || [])],
  };
}

function clearComboFlightLayers() {
  screenMatchUi?.querySelectorAll(".combo-fly-layer").forEach((layer) => layer.remove());
}

function renderArchiveCombo(data) {
  renderCardStrip(comboCards, state.archivedComboData?.cards || []);
  comboOwner.textContent = state.archivedComboData ? comboOwnerText(data, state.archivedComboData) : "等待下一手";
}

function renderCurrentCombo(data) {
  renderCardStrip(currentComboCards, state.currentComboData?.cards || []);
  currentComboOwner.textContent = comboOwnerText(data, state.currentComboData);
}

function pulseCurrentCombo() {
  currentComboCards?.classList.remove("combo-arrive");
  void currentComboCards?.offsetWidth;
  currentComboCards?.classList.add("combo-arrive");
  setTimeout(() => currentComboCards?.classList.remove("combo-arrive"), 460);
}

function animateArchiveShift(cards, startRect, endRect) {
  return new Promise((resolve) => {
    if (!screenMatchUi || !cards?.length || !startRect || !endRect) {
      comboCards?.classList.remove("pending");
      resolve();
      return;
    }

    const rootRect = screenMatchUi.getBoundingClientRect();
    const layer = createFlightLayer(cards, "played-strip archive-played combo-fly-layer");
    screenMatchUi.appendChild(layer);
    const width = Math.max(layer.scrollWidth, 1);
    const height = Math.max(layer.getBoundingClientRect().height, 1);
    const startX = startRect.left + startRect.width / 2 - rootRect.left - width / 2;
    const startY = startRect.top + startRect.height / 2 - rootRect.top - height / 2;
    const endX = endRect.left + endRect.width / 2 - rootRect.left - width / 2;
    const endY = endRect.top + endRect.height / 2 - rootRect.top - height / 2;

    layer.style.width = `${width}px`;

    const animation = layer.animate(
      [
        {
          transform: `translate(${startX}px, ${startY}px) scale(1)`,
          opacity: 1,
        },
        {
          transform: `translate(${endX}px, ${endY}px) scale(0.68)`,
          opacity: 0.92,
        },
      ],
      {
        duration: 420,
        easing: "cubic-bezier(0.26, 0.84, 0.34, 1)",
        fill: "forwards",
      }
    );

    const finish = () => {
      layer.remove();
      comboCards?.classList.remove("pending");
      resolve();
    };

    animation.addEventListener("finish", finish, { once: true });
    animation.addEventListener("cancel", finish, { once: true });
  });
}

function animateComboFromSeat(seatIndex, cards) {
  return new Promise((resolve) => {
    if (!screenMatchUi || !currentComboCards || !cards?.length) {
      currentComboCards?.classList.remove("combo-hidden", "incoming-pending");
      resolve();
      return;
    }
    const seatEl = document.getElementById(`seat${seatIndex}`);
    if (!seatEl) {
      currentComboCards?.classList.remove("combo-hidden", "incoming-pending");
      resolve();
      return;
    }

    const rootRect = screenMatchUi.getBoundingClientRect();
    const seatRect = seatEl.getBoundingClientRect();
    const targetRect = currentComboCards.getBoundingClientRect();
    const flyLayer = createFlightLayer(cards, "played-strip public-played combo-fly-layer");
    screenMatchUi.appendChild(flyLayer);
    const width = Math.max(flyLayer.scrollWidth, 1);
    const height = Math.max(flyLayer.getBoundingClientRect().height, 1);
    const startX = seatRect.left + seatRect.width / 2 - rootRect.left - width / 2;
    const startY = seatRect.top + seatRect.height * 0.56 - rootRect.top - height / 2;
    const endX = targetRect.left + targetRect.width / 2 - rootRect.left - width / 2;
    const endY = targetRect.top + targetRect.height / 2 - rootRect.top - height / 2;

    flyLayer.style.width = `${width}px`;

    const animation = flyLayer.animate(
      [
        {
          transform: `translate(${startX}px, ${startY}px) scale(0.36)`,
          opacity: 0.16,
        },
        {
          offset: 0.78,
          transform: `translate(${endX}px, ${endY}px) scale(1.14)`,
          opacity: 1,
        },
        {
          transform: `translate(${endX}px, ${endY}px) scale(1)`,
          opacity: 1,
        },
      ],
      {
        duration: 620,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      }
    );

    const finish = () => {
      currentComboCards?.classList.remove("combo-hidden", "incoming-pending");
      flyLayer.remove();
      resolve();
    };

    animation.addEventListener("finish", finish, { once: true });
    animation.addEventListener("cancel", finish, { once: true });
  });
}

function updateComboDisplay(data) {
  const nextCombo = cloneCombo(data.displayCombo || null);
  const nextSignature = comboSignature(nextCombo);
  const prevSignature = state.currentComboSignature;
  const phaseReset = !nextCombo || data.phase === "lobby" || data.phase === "dealing";

  if (phaseReset) {
    state.comboTransitionId += 1;
    clearComboFlightLayers();
    state.currentComboSignature = "";
    state.currentComboData = null;
    state.archivedComboData = null;
    currentComboCards?.classList.remove("combo-hidden", "incoming-pending");
    comboCards?.classList.remove("pending");
    renderCurrentCombo(data);
    renderArchiveCombo(data);
    return;
  }

  if (nextSignature && nextSignature !== prevSignature) {
    const transitionId = ++state.comboTransitionId;
    clearComboFlightLayers();

    const previousCombo = cloneCombo(state.currentComboData);
    const previousRect = previousCombo ? currentComboCards?.getBoundingClientRect() : null;
    const archiveRect = comboCards?.getBoundingClientRect();
    state.currentComboSignature = nextSignature;
    state.currentComboData = nextCombo;

    (async () => {
      if (previousCombo) {
        currentComboCards?.classList.add("combo-hidden");
        comboCards?.classList.add("pending");
        await animateArchiveShift(previousCombo.cards, previousRect, archiveRect);
        if (transitionId !== state.comboTransitionId) {
          return;
        }
        state.archivedComboData = previousCombo;
        renderArchiveCombo(data);
      }

      if (transitionId !== state.comboTransitionId) {
        return;
      }

      renderCurrentCombo(data);
      currentComboCards?.classList.add("incoming-pending");
      await animateComboFromSeat(nextCombo.seat, nextCombo.cards);
    })().catch(() => {});
    return;
  }

  state.currentComboData = nextCombo;
  renderCurrentCombo(data);
  renderArchiveCombo(data);
}

function seatStatusText(seatState, seatIndex, fullState) {
  if (fullState.currentTurnSeat === seatIndex) {
    return fullState.phase === "bidding" ? "轮到我叫分" : "轮到我出牌";
  }
  if (fullState.recentActionText?.[seatIndex]) {
    return fullState.recentActionText[seatIndex];
  }
  if (fullState.phase === "dealing") {
    return "发牌中";
  }
  if (fullState.phase === "roundOver") {
    return "等待结算";
  }
  return "等待操作";
}

function renderSeat(elementId, seatState, seatIndex, fullState) {
  const root = document.getElementById(elementId);
  root.className = "screen-seat-chip seat-chip";
  if (!seatState) {
    root.innerHTML = `
      <div class="seat-head">
        <div class="seat-avatar seat-avatar-empty">+</div>
        <div>
          <div class="seat-name">空位</div>
          <div class="meta-line">等待玩家扫码加入</div>
        </div>
      </div>
    `;
    return;
  }

  if (fullState.currentTurnSeat === seatIndex) {
    root.classList.add("current-turn");
  }
  if (fullState.landlordSeat === seatIndex) {
    root.classList.add("landlord");
  }

  const tags = [];
  if (seatState.isBot) {
    tags.push(`<span class="tag bot">AI</span>`);
  }
  if (seatState.ready) {
    tags.push(`<span class="tag ready">已准备</span>`);
  }
  if (!seatState.connected && !seatState.isBot) {
    tags.push(`<span class="tag">离线托管</span>`);
  }

  const backs = new Array(Math.min(seatState.cardCount, 10)).fill(`<div class="mini-back"></div>`).join("");
  const actionCards = fullState.recentActionCards?.[seatIndex] || [];
  const actionText = fullState.recentActionText?.[seatIndex] || "";
  const seatInitial = seatState.name?.slice(0, 1) || "玩";
  const roleText = seatState.role === "landlord" ? "地主" : "农民";
  const bubbleText = seatStatusText(seatState, seatIndex, fullState);
  const bubbleClass = fullState.currentTurnSeat === seatIndex ? "seat-status-bubble is-active" : "seat-status-bubble";
  const kickControl = seatState.isBot ? "" : `<button class="seat-kick-btn" type="button" data-kick-seat="${seatIndex}">踢人</button>`;

  root.innerHTML = `
    <div class="seat-head">
      <div class="seat-head-main">
        <div class="seat-avatar">${seatInitial}</div>
        <div>
          <div class="seat-name">${seatState.name}</div>
          <div class="seat-role">${roleText}</div>
        </div>
      </div>
      <div class="seat-tags">${tags.join("")}${kickControl}</div>
    </div>
    <div class="seat-stats">
      <span>手牌 ${seatState.cardCount}</span>
      <span>总分 ${seatState.totalScore}</span>
      <span>本局 ${seatState.roundDelta > 0 ? "+" : ""}${seatState.roundDelta}</span>
    </div>
    <div class="meta-line seat-bid-line">${seatState.lastBid == null ? "未叫分" : `叫分：${seatState.lastBid || "不叫"}`}</div>
    <div class="seat-mini-cards">${backs}</div>
    <div class="meta-line seat-action-line">${actionText || "等待操作"}</div>
    <div class="card-strip small compact-overlap">${actionCards.map((card) => `<img src="${card.image}" class="card-image" alt="${card.label}" />`).join("")}</div>
    <div class="${bubbleClass}">${bubbleText}</div>
  `;
}

function renderLogs(logs) {
  logList.innerHTML = logs
    .slice(-12)
    .map((item) => `<div class="log-entry">${new Date(item.at).toLocaleTimeString()} ${item.text}</div>`)
    .join("");
  logList.scrollTo({ top: logList.scrollHeight, behavior: "smooth" });
}

function renderBids(data) {
  const entries = data.bidding?.history || [];
  if (!entries.length) {
    bidHistory.innerHTML = `<div class="bid-entry">本局尚未开始叫分</div>`;
    return;
  }
  bidHistory.innerHTML = entries
    .slice(-4)
    .map((entry) => {
      const seat = data.seats[entry.seat];
      return `<div class="bid-entry">${seat?.name || "玩家"}：${entry.bid === 0 ? "不叫" : `${entry.bid} 分`}</div>`;
    })
    .join("");
}

function updateTimer() {
  if (!state.data?.turnDeadlineAt) {
    timerText.textContent = "-";
    return;
  }
  const left = Math.max(0, Math.ceil((state.data.turnDeadlineAt - Date.now()) / 1000));
  timerText.textContent = `${left}s`;
}

function render(data) {
  const previousData = state.data;
  audioController?.handleState(previousData, data);
  state.data = data;
  applySceneTheme(data.phase);
  roomMeta.textContent = `房号 ${data.roomId} · 第 ${data.round || 0} 局 · 局域网 ${data.localIps.join(" / ") || "127.0.0.1"}`;
  if (roomMetaMini) {
    roomMetaMini.textContent = `房号 ${data.roomId} · 第 ${data.round || 0} 局`;
  }
  phaseText.textContent = phaseMap[data.phase] || data.phase;
  baseBidText.textContent = String(data.baseBid);
  multiplierText.textContent = `x${data.multiplier}`;
  if (baseBidMirror) {
    baseBidMirror.textContent = String(data.baseBid);
  }
  if (multiplierMirror) {
    multiplierMirror.textContent = `x${data.multiplier}`;
  }
  if (phaseMirror) {
    phaseMirror.textContent = phaseMap[data.phase] || data.phase;
  }
  updateTimer();

  joinLink.href = data.joinUrl;
  joinLink.textContent = "手机加入";
  joinLink.title = data.joinUrl;
  qrImage.src = `https://quickchart.io/qr?text=${encodeURIComponent(data.joinUrl)}&size=180`;

  renderSeat("seat0", data.seats[0], 0, data);
  renderSeat("seat1", data.seats[1], 1, data);
  renderSeat("seat2", data.seats[2], 2, data);
  renderLogs(data.logs);
  renderBids(data);
  renderCardStrip(bottomCards, data.bottomCards, true);
  updateComboDisplay(data);

  const currentSeat = data.currentTurnSeat != null ? data.seats[data.currentTurnSeat] : null;
  if (data.phase === "roundOver") {
    const winner = data.seats[data.winnerSeat];
    turnBanner.textContent = winner ? `${winner.name} 获胜，等待下一局` : "本局结束";
  } else if (currentSeat) {
    turnBanner.textContent = `轮到 ${currentSeat.name}${data.phase === "bidding" ? " 叫分" : " 出牌"}`;
  } else {
    turnBanner.textContent = "等待玩家加入";
  }

  startBtn.disabled = !data.canStart;
  nextBtn.disabled = data.phase !== "roundOver" || !data.canStart;
}

function connectEvents() {
  state.eventSource?.close();
  state.eventSource = new EventSource("/events?view=screen");
  state.eventSource.onmessage = (event) => {
    render(JSON.parse(event.data));
  };
}

railToggle?.addEventListener("click", () => {
  screenRail?.classList.toggle("open");
  screenRail?.classList.toggle("hidden-drawer");
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-kick-seat]");
  if (!button) {
    return;
  }
  try {
    await request("/api/action", { action: "kick", seat: Number(button.dataset.kickSeat) });
  } catch (error) {
    alert(error.message);
  }
});

startBtn.addEventListener("click", async () => {
  try {
    await request("/api/action", { action: "start" });
  } catch (error) {
    alert(error.message);
  }
});

nextBtn.addEventListener("click", async () => {
  try {
    await request("/api/action", { action: "nextRound" });
  } catch (error) {
    alert(error.message);
  }
});

resetBtn.addEventListener("click", async () => {
  try {
    await request("/api/action", { action: "resetLobby" });
  } catch (error) {
    alert(error.message);
  }
});

setInterval(updateTimer, 300);

fetch("/api/bootstrap?view=screen")
  .then((response) => response.json())
  .then((payload) => {
    render(payload.state);
    connectEvents();
  });
