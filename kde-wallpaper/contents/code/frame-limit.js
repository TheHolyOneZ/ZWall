

(function () {
  if (window.__zwallSetFps) return;
  var fps = 30;
  var nativeRaf = window.requestAnimationFrame.bind(window);
  var callbacks = new Map();
  var nextId = 1;
  var lastTick = null;
  var paused = new Set();

  window.requestAnimationFrame = function (cb) {
    var id = nextId++;
    callbacks.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    callbacks.delete(id);
  };

  function outermostSvgs() {
    var out = [];
    var all = document.getElementsByTagName("svg");
    for (var i = 0; i < all.length; i++) if (!all[i].ownerSVGElement) out.push(all[i]);
    return out;
  }

  function stepAnimations(dt) {
    outermostSvgs().forEach(function (s) {
      if (!s.__zwallPaced) {
        s.__zwallPaced = true;
        s.pauseAnimations();
      }
      s.setCurrentTime(s.getCurrentTime() + dt / 1000);
    });
    if (!document.getAnimations) return;
    document.getAnimations().forEach(function (a) {
      if (!paused.has(a)) {
        if (a.playState !== "running") return;
        paused.add(a);
        a.pause();
        return;
      }
      if (a.playState === "paused") a.currentTime = (a.currentTime || 0) + dt * (a.playbackRate || 1);
      else if (a.playState === "finished" || a.playState === "idle") paused.delete(a);
    });
  }

  function release() {
    outermostSvgs().forEach(function (s) {
      if (s.__zwallPaced) {
        s.__zwallPaced = false;
        s.unpauseAnimations();
      }
    });
    paused.forEach(function (a) {
      try {
        a.play();
      } catch (e) {}
    });
    paused.clear();
  }


  var due = 0;
  function frame(now) {
    if (fps > 0 && now < due - 3) {
      nativeRaf(frame);
      return;
    }
    if (fps > 0) {
      var interval = 1000 / fps;
      due = due + interval;
      if (due < now) due = now + interval;
    }
    var dt = lastTick === null ? 0 : now - lastTick;
    lastTick = now;
    if (fps > 0) {
      try {
        stepAnimations(dt);
      } catch (e) {}
    }
    var run = callbacks;
    callbacks = new Map();
    run.forEach(function (cb) {
      try {
        cb(now);
      } catch (e) {
        setTimeout(function () {
          throw e;
        });
      }
    });
    nativeRaf(frame);
  }

  window.__zwallSetFps = function (n) {
    var was = fps;
    fps = Math.max(0, n | 0);
    if (fps === 0 && was > 0) release();
  };
  nativeRaf(frame);
})();
