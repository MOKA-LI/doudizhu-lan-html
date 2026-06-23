"use strict";

(function initDDZAudio(global) {
  const PREF_KEY = "doudizhu_audio_enabled_v2";
  const VOICE_BY_SEAT = ["man", "woman", "man"];
  const PASS_FILES = ["buyao1.wav", "buyao2.wav", "buyao3.wav", "buyao4.wav"];

  function assetPath() {
    return `/${Array.from(arguments)
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  function comboSignature(combo) {
    if (!combo || !combo.cards || !combo.cards.length) {
      return "";
    }
    return `${combo.seat}:${combo.comboLabel}:${combo.cards.map((card) => card.id || card.label || card.image).join("|")}`;
  }

  function seatVoice(seat) {
    return VOICE_BY_SEAT[((seat % VOICE_BY_SEAT.length) + VOICE_BY_SEAT.length) % VOICE_BY_SEAT.length] || "man";
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function singleVoiceIndex(rank) {
    return clamp(Number(rank || 3) - 2, 1, 15);
  }

  function pairVoiceIndex(rank) {
    return clamp(Number(rank || 3) - 2, 1, 13);
  }

  function comboSoundFile(comboLabel, cards) {
    const rank = cards && cards[0] ? cards[0].rank : 3;
    switch (comboLabel) {
      case "单张":
        return `${singleVoiceIndex(rank)}.wav`;
      case "对子":
        return `dui${pairVoiceIndex(rank)}.wav`;
      case "三张":
        return "sange.wav";
      case "三带一":
        return "sandaiyi.wav";
      case "三带二":
        return "sandaiyidui.wav";
      case "顺子":
        return "shunzi.wav";
      case "连对":
        return "liandui.wav";
      case "飞机":
      case "飞机带单":
      case "飞机带对":
        return "feiji.wav";
      case "四带二":
        return "sidaier.wav";
      case "四带两对":
        return "sidailiangdui.wav";
      case "炸弹":
        return "zhadan.wav";
      case "王炸":
        return "wangzha.wav";
      default:
        return null;
    }
  }

  function createController(options) {
    const config = {
      buttonId: options && options.buttonId ? options.buttonId : "",
      bgVolume: options && options.bgVolume != null ? options.bgVolume : 0.28,
      effectVolume: options && options.effectVolume != null ? options.effectVolume : 0.92,
    };

    const state = {
      enabled: global.localStorage.getItem(PREF_KEY) !== "0",
      unlocked: false,
      bgAudio: null,
      button: config.buttonId ? document.getElementById(config.buttonId) : null,
    };

    function updateButton() {
      if (!state.button) {
        return;
      }
      state.button.textContent = state.enabled ? "音效开" : "音效关";
      state.button.setAttribute("aria-pressed", state.enabled ? "true" : "false");
      state.button.classList.toggle("is-off", !state.enabled);
    }

    function ensureBgAudio() {
      if (state.bgAudio) {
        return state.bgAudio;
      }
      const audio = new Audio(assetPath("音效", "背景循环音乐.mp3"));
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = config.bgVolume;
      state.bgAudio = audio;
      return audio;
    }

    function unlock() {
      if (state.unlocked) {
        return;
      }
      state.unlocked = true;
      if (state.enabled) {
        ensureBgAudio()
          .play()
          .catch(() => {});
      }
    }

    function setEnabled(enabled) {
      state.enabled = !!enabled;
      global.localStorage.setItem(PREF_KEY, state.enabled ? "1" : "0");
      updateButton();

      const bgAudio = ensureBgAudio();
      if (!state.enabled) {
        bgAudio.pause();
        bgAudio.currentTime = 0;
        return;
      }

      if (state.unlocked) {
        bgAudio.play().catch(() => {});
      }
    }

    function playEffect(src, volume) {
      if (!state.enabled || !state.unlocked || !src) {
        return;
      }
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.volume = volume == null ? config.effectVolume : volume;
      audio.play().catch(() => {});
    }

    function playSeatFile(seat, fileName, volume) {
      if (!fileName) {
        return;
      }
      playEffect(assetPath("音效", seatVoice(seat), fileName), volume);
    }

    function playRandomSeatFile(seat, files, volume) {
      if (!files || !files.length) {
        return;
      }
      playSeatFile(seat, files[Math.floor(Math.random() * files.length)], volume);
    }

    function handleBidChanges(prevState, nextState) {
      for (const seat of [0, 1, 2]) {
        const prevText = (prevState && prevState.recentActionText && prevState.recentActionText[seat]) || "";
        const nextText = (nextState && nextState.recentActionText && nextState.recentActionText[seat]) || "";
        if (!nextText || nextText === prevText) {
          continue;
        }
        if (nextText === "不叫") {
          playSeatFile(seat, "bujiao.wav");
          return;
        }
        if (nextText.includes("1")) {
          playSeatFile(seat, "jiaodizhu.wav");
          return;
        }
        if (nextText.includes("2")) {
          playSeatFile(seat, "qiangdizhu1.wav");
          return;
        }
        if (nextText.includes("3")) {
          playSeatFile(seat, "qiangdizhu2.wav");
          return;
        }
      }
    }

    function handlePlayChanges(prevState, nextState) {
      const prevCombo = comboSignature(prevState && prevState.displayCombo);
      const nextCombo = comboSignature(nextState && nextState.displayCombo);

      if (nextCombo && nextCombo !== prevCombo && nextState.displayCombo) {
        const combo = nextState.displayCombo;
        playSeatFile(combo.seat, comboSoundFile(combo.comboLabel, combo.cards));
        return;
      }

      for (const seat of [0, 1, 2]) {
        const prevText = (prevState && prevState.recentActionText && prevState.recentActionText[seat]) || "";
        const nextText = (nextState && nextState.recentActionText && nextState.recentActionText[seat]) || "";
        if (nextText === "不出" && nextText !== prevText) {
          playRandomSeatFile(seat, PASS_FILES);
          return;
        }
      }
    }

    function handleWarnings(prevState, nextState) {
      if (!prevState || !prevState.seats || !nextState || !nextState.seats) {
        return;
      }

      for (const seat of nextState.seats) {
        if (!seat) {
          continue;
        }
        const prevSeat = prevState.seats[seat.seat];
        if (!prevSeat) {
          continue;
        }
        if (prevSeat.cardCount > 2 && seat.cardCount === 2) {
          playSeatFile(seat.seat, "baojing2.wav", 0.98);
          return;
        }
        if (prevSeat.cardCount > 1 && seat.cardCount === 1) {
          playSeatFile(seat.seat, "baojing1.wav", 0.98);
          return;
        }
      }
    }

    function handlePhaseCue(prevState, nextState) {
      if (!nextState) {
        return;
      }
      if (prevState && prevState.phase === nextState.phase) {
        return;
      }
      if (nextState.phase === "playing" && nextState.landlordSeat != null) {
        playSeatFile(nextState.landlordSeat, "zhuadizhu.mp3", 0.9);
      }
    }

    function handleState(prevState, nextState) {
      if (!nextState) {
        return;
      }

      handlePhaseCue(prevState, nextState);

      if (nextState.phase === "bidding") {
        handleBidChanges(prevState, nextState);
      }

      if (nextState.phase === "playing" || nextState.phase === "roundOver") {
        handlePlayChanges(prevState, nextState);
        handleWarnings(prevState, nextState);
      }
    }

    updateButton();

    if (state.button) {
      state.button.addEventListener("click", () => {
        unlock();
        setEnabled(!state.enabled);
      });
    }

    document.addEventListener(
      "pointerdown",
      () => {
        unlock();
      },
      { once: true, passive: true }
    );

    document.addEventListener(
      "keydown",
      () => {
        unlock();
      },
      { once: true }
    );

    return {
      handleState,
      setEnabled,
      unlock,
    };
  }

  global.DDZAudio = {
    createController,
    assetPath,
  };
})(window);
