// The only place that touches saved login state.
//
// Stored in sessionStorage, which belongs to a single browser tab, so each tab
// keeps its own signed-in account (handy for testing admin, supervisor,
// finance and employee side by side). Closing the tab ends that session.
// Unrelated settings such as the dark-mode choice stay in localStorage.

const TOKEN_KEY = 'matisan_token'
const USER_KEY = 'matisan_user'

function store() {
  try {
    return window.sessionStorage
  } catch {
    return null // storage blocked (private mode, strict settings)
  }
}

export function getToken() {
  try {
    return store()?.getItem(TOKEN_KEY) || null
  } catch {
    return null
  }
}

export function getStoredUser() {
  try {
    const raw = store()?.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    clearSession() // corrupt value: drop it instead of crashing the app
    return null
  }
}

export function saveSession(token, user) {
  try {
    store()?.setItem(TOKEN_KEY, token)
    store()?.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* storage unavailable: the session lasts until the page reloads */
  }
}

export function saveUser(user) {
  try {
    store()?.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  try {
    store()?.removeItem(TOKEN_KEY)
    store()?.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

// Earlier versions kept the login in localStorage, shared by every tab. Remove
// those leftovers once so an old shared login can never be picked up again.
export function purgeLegacySession() {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
    window.localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}
