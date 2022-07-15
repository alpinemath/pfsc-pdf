"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isDestHashesEqual = isDestHashesEqual;
exports.isDestArraysEqual = isDestArraysEqual;
exports.PDFHistory = void 0;

var _ui_utils = require("./ui_utils.js");

const HASH_CHANGE_TIMEOUT = 1000;
const POSITION_UPDATED_THRESHOLD = 50;
const UPDATE_VIEWAREA_TIMEOUT = 1000;
const MAX_LOCAL_HISTORY_STATES = 25;

function getCurrentHash() {
  return document.location.hash;
}

function balancedTrimStartIndex(m, n, p) {
  if (n <= m) {
    return 0;
  }

  const B = Math.ceil((m - 1) / 2);
  const F = Math.floor((m - 1) / 2);
  const b = p;
  const f = n - (p + 1);
  let i0;

  if (b >= B && f >= F) {
    i0 = p - B;
  } else if (b < B) {
    i0 = 0;
  } else {
    i0 = n - m;
  }

  return i0;
}

class LocalHistory {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.history = [];
    this.ptr = null;
    this.navEnableHandlers = [];
  }

  defineHistory(states, ptr) {
    if (states.length > MAX_LOCAL_HISTORY_STATES) {
      const m = MAX_LOCAL_HISTORY_STATES;
      const i0 = balancedTrimStartIndex(m, states.length, ptr);
      states = states.slice(i0, i0 + m);
    }

    this.history = states;
    this.ptr = ptr;
    this.publishNavEnable();
  }

  describeHistory() {
    return {
      states: this.history,
      ptr: this.ptr
    };
  }

  addNavEnableHandler(callback) {
    this.navEnableHandlers.push(callback);
  }

  publishNavEnable() {
    const b = this.canGoBackward();
    const f = this.canGoForward();
    const h = this.describeHistory();
    this.navEnableHandlers.forEach(cb => {
      cb({
        back: b,
        fwd: f,
        history: h
      });
    });
  }

  canGoBackward() {
    return this.ptr !== null && this.ptr > 0;
  }

  canGoForward() {
    return this.ptr !== null && this.ptr < this.length - 1;
  }

  get state() {
    return this.ptr === null ? null : this.history[this.ptr];
  }

  get latest() {
    return this.ptr === null ? null : this.history[this.length - 1];
  }

  get length() {
    return this.history.length;
  }

  back() {
    if (!this.canGoBackward()) {
      return;
    }

    this.ptr--;
    this.eventBus.dispatch("localpopstate", {
      state: this.state
    });
    this.publishNavEnable();
  }

  forward() {
    if (!this.canGoForward()) {
      return;
    }

    this.ptr++;
    this.eventBus.dispatch("localpopstate", {
      state: this.state
    });
    this.publishNavEnable();
  }

  replaceState(newState, title, newUrl) {
    if (this.ptr === null) {
      this.history.push(newState);
      this.ptr = 0;
    } else {
      this.history[this.ptr] = newState;
    }
  }

  pushState(newState, title, newUrl) {
    if (this.ptr === null) {
      this.ptr = 0;
    } else {
      this.ptr++;
      this.history.splice(this.ptr);
    }

    this.history.push(newState);

    while (this.length > MAX_LOCAL_HISTORY_STATES) {
      this.history.shift();

      if (this.ptr > 0) {
        this.ptr--;
      }
    }

    this.publishNavEnable();
  }

}

class PDFHistory {
  constructor({
    linkService,
    eventBus,
    local
  }) {
    this.linkService = linkService;
    this.eventBus = eventBus || (0, _ui_utils.getGlobalEventBus)();
    this._local = local;
    this._history = local ? new LocalHistory(eventBus) : window.history;
    this._initialized = false;
    this._fingerprint = "";
    this.reset();
    this._boundEvents = null;
    this._isViewerInPresentationMode = false;
    this.eventBus.on("presentationmodechanged", evt => {
      this._isViewerInPresentationMode = evt.active || evt.switchInProgress;
    });
    this.eventBus.on("pagesinit", () => {
      this._isPagesLoaded = false;

      const onPagesLoaded = evt => {
        this.eventBus.off("pagesloaded", onPagesLoaded);
        this._isPagesLoaded = !!evt.pagesCount;
      };

      this.eventBus.on("pagesloaded", onPagesLoaded);
    });
  }

  initialize({
    fingerprint,
    resetHistory = false,
    updateUrl = false
  }) {
    if (!fingerprint || typeof fingerprint !== "string") {
      console.error('PDFHistory.initialize: The "fingerprint" must be a non-empty string.');
      return;
    }

    if (this._initialized) {
      this.reset();
    }

    const reInitialized = this._fingerprint !== "" && this._fingerprint !== fingerprint;
    this._fingerprint = fingerprint;
    this._updateUrl = updateUrl === true;
    this._initialized = true;

    this._bindEvents();

    const state = this._history.state;
    this._popStateInProgress = false;
    this._blockHashChange = 0;
    this._currentHash = getCurrentHash();
    this._numPositionUpdates = 0;
    this._uid = this._maxUid = 0;
    this._destination = null;
    this._position = null;

    if (!this._isValidState(state, true) || resetHistory) {
      const {
        hash,
        page,
        rotation
      } = this._parseCurrentHash();

      if (!hash || reInitialized || resetHistory) {
        this._pushOrReplaceState(null, true);

        return;
      }

      this._pushOrReplaceState({
        hash,
        page,
        rotation
      }, true);

      return;
    }

    const destination = state.destination;

    this._updateInternalState(destination, state.uid, true);

    if (this._local) {
      this._maxUid = this._history.latest.uid;
    } else if (this._uid > this._maxUid) {
      this._maxUid = this._uid;
    }

    if (destination.rotation !== undefined) {
      this._initialRotation = destination.rotation;
    }

    if (destination.dest) {
      this._initialBookmark = JSON.stringify(destination.dest);
      this._destination.page = null;
    } else if (destination.hash) {
      this._initialBookmark = destination.hash;
    } else if (destination.page) {
      this._initialBookmark = `page=${destination.page}`;
    }
  }

  reset() {
    if (this._initialized) {
      this._pageHide();

      this._initialized = false;

      this._unbindEvents();
    }

    if (this._updateViewareaTimeout) {
      clearTimeout(this._updateViewareaTimeout);
      this._updateViewareaTimeout = null;
    }

    this._initialBookmark = null;
    this._initialRotation = null;
  }

  get history() {
    return this._history;
  }

  defineHistory(states, ptr, reinit) {
    const lh = new LocalHistory(this.eventBus);
    lh.defineHistory(states, ptr);
    this._history = lh;

    if (reinit) {
      this.initialize({
        fingerprint: this._fingerprint
      });
    }
  }

  push({
    namedDest = null,
    explicitDest,
    pageNumber
  }) {
    if (!this._initialized) {
      return;
    }

    if (namedDest && typeof namedDest !== "string") {
      console.error("PDFHistory.push: " + `"${namedDest}" is not a valid namedDest parameter.`);
      return;
    } else if (!Array.isArray(explicitDest)) {
      console.error("PDFHistory.push: " + `"${explicitDest}" is not a valid explicitDest parameter.`);
      return;
    } else if (!(Number.isInteger(pageNumber) && pageNumber > 0 && pageNumber <= this.linkService.pagesCount)) {
      if (pageNumber !== null || this._destination) {
        console.error("PDFHistory.push: " + `"${pageNumber}" is not a valid pageNumber parameter.`);
        return;
      }
    }

    const hash = namedDest || JSON.stringify(explicitDest);

    if (!hash) {
      return;
    }

    let forceReplace = false;

    if (this._destination && (isDestHashesEqual(this._destination.hash, hash) || isDestArraysEqual(this._destination.dest, explicitDest))) {
      if (this._destination.page) {
        return;
      }

      forceReplace = true;
    }

    if (this._popStateInProgress && !forceReplace) {
      return;
    }

    this._pushOrReplaceState({
      dest: explicitDest,
      hash,
      page: pageNumber,
      rotation: this.linkService.rotation
    }, forceReplace);

    if (!this._popStateInProgress) {
      this._popStateInProgress = true;
      Promise.resolve().then(() => {
        this._popStateInProgress = false;
      });
    }
  }

  pushCurrentPosition() {
    if (!this._initialized || this._popStateInProgress) {
      return;
    }

    this._tryPushCurrentPosition();
  }

  back() {
    if (!this._initialized || this._popStateInProgress) {
      return;
    }

    const state = this._history.state;

    if (this._isValidState(state) && state.uid > 0) {
      this._history.back();
    }
  }

  forward() {
    if (!this._initialized || this._popStateInProgress) {
      return;
    }

    const state = this._history.state;

    if (this._isValidState(state) && state.uid < this._maxUid) {
      this._history.forward();
    }
  }

  get popStateInProgress() {
    return this._initialized && (this._popStateInProgress || this._blockHashChange > 0);
  }

  get initialBookmark() {
    return this._initialized ? this._initialBookmark : null;
  }

  get initialRotation() {
    return this._initialized ? this._initialRotation : null;
  }

  _pushOrReplaceState(destination, forceReplace = false) {
    const shouldReplace = forceReplace || !this._destination;
    const newState = {
      fingerprint: this._fingerprint,
      uid: shouldReplace ? this._uid : this._uid + 1,
      destination
    };

    this._updateInternalState(destination, newState.uid);

    let newUrl;

    if (this._updateUrl && destination && destination.hash) {
      const baseUrl = document.location.href.split("#")[0];

      if (!baseUrl.startsWith("file://")) {
        newUrl = `${baseUrl}#${destination.hash}`;
      }
    }

    if (shouldReplace) {
      this._history.replaceState(newState, "", newUrl);
    } else {
      this._maxUid = this._uid;

      this._history.pushState(newState, "", newUrl);
    }
  }

  _tryPushCurrentPosition(temporary = false) {
    if (!this._position) {
      return;
    }

    let position = this._position;

    if (temporary) {
      position = Object.assign(Object.create(null), this._position);
      position.temporary = true;
    }

    if (!this._destination) {
      this._pushOrReplaceState(position);

      return;
    }

    if (this._destination.temporary) {
      this._pushOrReplaceState(position, true);

      return;
    }

    if (this._destination.hash === position.hash) {
      return;
    }

    if (!this._destination.page && (POSITION_UPDATED_THRESHOLD <= 0 || this._numPositionUpdates <= POSITION_UPDATED_THRESHOLD)) {
      return;
    }

    let forceReplace = false;

    if (this._destination.page >= position.first && this._destination.page <= position.page) {
      if (this._destination.dest || !this._destination.first) {
        return;
      }

      forceReplace = true;
    }

    this._pushOrReplaceState(position, forceReplace);
  }

  _isValidState(state, checkReload = false) {
    if (!state) {
      return false;
    }

    if (state.fingerprint !== this._fingerprint) {
      if (checkReload) {
        if (typeof state.fingerprint !== "string" || state.fingerprint.length !== this._fingerprint.length) {
          return false;
        }

        const [perfEntry] = performance.getEntriesByType("navigation");

        if (!perfEntry || perfEntry.type !== "reload") {
          return false;
        }
      } else {
        return false;
      }
    }

    if (!Number.isInteger(state.uid) || state.uid < 0) {
      return false;
    }

    if (state.destination === null || typeof state.destination !== "object") {
      return false;
    }

    return true;
  }

  _updateInternalState(destination, uid, removeTemporary = false) {
    if (this._updateViewareaTimeout) {
      clearTimeout(this._updateViewareaTimeout);
      this._updateViewareaTimeout = null;
    }

    if (removeTemporary && destination && destination.temporary) {
      delete destination.temporary;
    }

    this._destination = destination;
    this._uid = uid;
    this._numPositionUpdates = 0;
  }

  _parseCurrentHash() {
    const hash = unescape(getCurrentHash()).substring(1);
    let page = (0, _ui_utils.parseQueryString)(hash).page | 0;

    if (!(Number.isInteger(page) && page > 0 && page <= this.linkService.pagesCount)) {
      page = null;
    }

    return {
      hash,
      page,
      rotation: this.linkService.rotation
    };
  }

  _updateViewarea({
    location
  }) {
    if (this._updateViewareaTimeout) {
      clearTimeout(this._updateViewareaTimeout);
      this._updateViewareaTimeout = null;
    }

    this._position = {
      hash: this._isViewerInPresentationMode ? `page=${location.pageNumber}` : location.pdfOpenParams.substring(1),
      page: this.linkService.page,
      first: location.pageNumber,
      rotation: location.rotation
    };

    if (this._popStateInProgress) {
      return;
    }

    if (POSITION_UPDATED_THRESHOLD > 0 && this._isPagesLoaded && this._destination && !this._destination.page) {
      this._numPositionUpdates++;
    }

    if (UPDATE_VIEWAREA_TIMEOUT > 0) {
      this._updateViewareaTimeout = setTimeout(() => {
        if (!this._popStateInProgress) {
          this._tryPushCurrentPosition(true);
        }

        this._updateViewareaTimeout = null;
      }, UPDATE_VIEWAREA_TIMEOUT);
    }
  }

  _popState({
    state
  }) {
    const newHash = getCurrentHash(),
          hashChanged = this._currentHash !== newHash;
    this._currentHash = newHash;

    if (!state) {
      this._uid++;

      const {
        hash,
        page,
        rotation
      } = this._parseCurrentHash();

      this._pushOrReplaceState({
        hash,
        page,
        rotation
      }, true);

      return;
    }

    if (!this._isValidState(state)) {
      return;
    }

    this._popStateInProgress = true;

    if (hashChanged) {
      this._blockHashChange++;
      (0, _ui_utils.waitOnEventOrTimeout)({
        target: window,
        name: "hashchange",
        delay: HASH_CHANGE_TIMEOUT
      }).then(() => {
        this._blockHashChange--;
      });
    }

    const destination = state.destination;

    this._updateInternalState(destination, state.uid, true);

    if (this._uid > this._maxUid) {
      this._maxUid = this._uid;
    }

    if ((0, _ui_utils.isValidRotation)(destination.rotation)) {
      this.linkService.rotation = destination.rotation;
    }

    if (destination.dest) {
      this.linkService.navigateTo(destination.dest);
    } else if (destination.hash) {
      this.linkService.setHash(destination.hash);
    } else if (destination.page) {
      this.linkService.page = destination.page;
    }

    Promise.resolve().then(() => {
      this._popStateInProgress = false;
    });
  }

  _pageHide() {
    if (!this._destination || this._destination.temporary) {
      this._tryPushCurrentPosition();
    }
  }

  _bindEvents() {
    if (this._boundEvents) {
      return;
    }

    this._boundEvents = {
      updateViewarea: this._updateViewarea.bind(this),
      popState: this._popState.bind(this),
      pageHide: this._pageHide.bind(this)
    };
    this.eventBus.on("updateviewarea", this._boundEvents.updateViewarea);

    if (this._local) {
      this.eventBus.on("localpopstate", this._boundEvents.popState);
    } else {
      window.addEventListener("popstate", this._boundEvents.popState);
    }

    window.addEventListener("pagehide", this._boundEvents.pageHide);
  }

  _unbindEvents() {
    if (!this._boundEvents) {
      return;
    }

    this.eventBus.off("updateviewarea", this._boundEvents.updateViewarea);

    if (this._local) {
      this.eventBus.off("localpopstate", this._boundEvents.popState);
    } else {
      window.removeEventListener("popstate", this._boundEvents.popState);
    }

    window.removeEventListener("pagehide", this._boundEvents.pageHide);
    this._boundEvents = null;
  }

}

exports.PDFHistory = PDFHistory;

function isDestHashesEqual(destHash, pushHash) {
  if (typeof destHash !== "string" || typeof pushHash !== "string") {
    return false;
  }

  if (destHash === pushHash) {
    return true;
  }

  const {
    nameddest
  } = (0, _ui_utils.parseQueryString)(destHash);

  if (nameddest === pushHash) {
    return true;
  }

  return false;
}

function isDestArraysEqual(firstDest, secondDest) {
  function isEntryEqual(first, second) {
    if (typeof first !== typeof second) {
      return false;
    }

    if (Array.isArray(first) || Array.isArray(second)) {
      return false;
    }

    if (first !== null && typeof first === "object" && second !== null) {
      if (Object.keys(first).length !== Object.keys(second).length) {
        return false;
      }

      for (const key in first) {
        if (!isEntryEqual(first[key], second[key])) {
          return false;
        }
      }

      return true;
    }

    return first === second || Number.isNaN(first) && Number.isNaN(second);
  }

  if (!(Array.isArray(firstDest) && Array.isArray(secondDest))) {
    return false;
  }

  if (firstDest.length !== secondDest.length) {
    return false;
  }

  for (let i = 0, ii = firstDest.length; i < ii; i++) {
    if (!isEntryEqual(firstDest[i], secondDest[i])) {
      return false;
    }
  }

  return true;
}