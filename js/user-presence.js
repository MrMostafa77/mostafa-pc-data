// ============================================================
// Users Presence — Firebase Realtime Database
// يعرض المستخدمين المسجلين وحالتهم Online / Offline في Popup.
// ============================================================
(function () {
  'use strict';

  var db = null;
  var usersRef = null;
  var currentUid = null;
  var popup = null;
  var usersList = null;
  var usersButton = null;
  var closeButton = null;
  var presenceRefs = {};

  function usernameFromUser(user) {
    if (!user) return 'Unknown';
    var email = String(user.email || '');
    var name = email.split('@')[0] || user.displayName || user.uid;
    return name.replace(/\s+/g, '');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);
    });
  }

  function formatLastSeen(ts) {
    if (!ts) return 'Last seen: —';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return 'Last seen: —';
    var now = new Date();
    var diff = Math.max(0, now.getTime() - d.getTime());
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return 'Last seen just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return 'Last seen ' + min + ' min ago';
    var hrs = Math.floor(min / 60);
    if (hrs < 24) return 'Last seen ' + hrs + ' hr ago';
    var days = Math.floor(hrs / 24);
    return 'Last seen ' + days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  function renderUsers(snapshot) {
    if (!usersList) return;
    var data = snapshot && snapshot.val ? (snapshot.val() || {}) : {};
    var users = Object.keys(data).map(function (uid) {
      var item = data[uid] || {};
      return {
        uid: uid,
        username: item.username || 'User',
        online: item.online === true,
        lastSeen: item.lastSeen || 0
      };
    });

    // Current user first, then online users, then offline users alphabetically.
    users.sort(function (a, b) {
      if (a.uid === currentUid) return -1;
      if (b.uid === currentUid) return 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.username.localeCompare(b.username);
    });

    if (!users.length) {
      usersList.innerHTML = '<div class="users-empty">No users found.</div>';
      return;
    }

    usersList.innerHTML = users.map(function (u) {
      var isMe = u.uid === currentUid;
      var statusText = u.online ? 'Online now' : formatLastSeen(u.lastSeen);
      return '<div class="presence-user ' + (u.online ? 'is-online' : 'is-offline') + '">' +
        '<span class="presence-dot" aria-hidden="true"></span>' +
        '<div class="presence-info">' +
          '<div class="presence-name">' + escapeHtml(u.username) + (isMe ? ' <span class="presence-me">You</span>' : '') + '</div>' +
          '<div class="presence-status">' + escapeHtml(statusText) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function setPopup(open) {
    if (!popup || !usersButton) return;
    popup.hidden = !open;
    usersButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function initPopup() {
    usersButton = document.getElementById('users-btn');
    popup = document.getElementById('users-popup');
    usersList = document.getElementById('users-list');
    closeButton = document.getElementById('users-popup-close');
    if (!usersButton || !popup) return;

    usersButton.addEventListener('click', function (e) {
      e.stopPropagation();
      setPopup(popup.hidden);
    });
    if (closeButton) closeButton.addEventListener('click', function () { setPopup(false); });
    document.addEventListener('click', function (e) {
      if (!popup.hidden && !popup.contains(e.target) && e.target !== usersButton) setPopup(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setPopup(false);
    });
  }

  function initPresence(user) {
    if (!user || !db) return;
    currentUid = user.uid;
    var ref = db.ref('presence/' + user.uid);
    var connectedRef = db.ref('.info/connected');
    var username = usernameFromUser(user);
    presenceRefs.main = ref;

    connectedRef.on('value', function (snap) {
      if (snap.val() !== true) return;
      ref.onDisconnect().set({
        username: username,
        online: false,
        lastSeen: firebase.database.ServerValue.TIMESTAMP
      }).then(function () {
        return ref.set({
          username: username,
          online: true,
          lastSeen: firebase.database.ServerValue.TIMESTAMP
        });
      }).catch(function (err) {
        console.error('Presence setup failed:', err);
      });
    });

    window.addEventListener('beforeunload', function () {
      // onDisconnect is the reliable path; this is only a best-effort update.
      ref.update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP }).catch(function () {});
    });

    usersRef = db.ref('presence');
    usersRef.on('value', renderUsers, function (err) {
      console.error('Presence read failed:', err);
      if (usersList) usersList.innerHTML = '<div class="users-empty">Unable to load users.</div>';
    });
  }

  // Explicit logout: mark the current session offline BEFORE Firebase signs out.
  // onDisconnect() still handles tab/browser/network disconnects.
  window.GameVaultPresenceSignOut = function () {
    if (!currentUid || !db) return Promise.resolve();
    var ref = db.ref('presence/' + currentUid);
    return ref.update({
      online: false,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    }).catch(function (err) {
      console.warn('Presence logout update failed:', err);
    });
  };

  function start() {
    initPopup();
    if (typeof firebase === 'undefined' || !firebase.database || typeof firebaseConfig === 'undefined') return;
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.database();
    } catch (e) {
      console.error('Realtime Database unavailable:', e);
      return;
    }

    firebase.auth().onAuthStateChanged(function (user) {
      if (user) initPresence(user);
      else {
        currentUid = null;
        if (usersRef) usersRef.off('value', renderUsers);
        if (usersList) usersList.innerHTML = '<div class="users-empty">Sign in to see users.</div>';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
