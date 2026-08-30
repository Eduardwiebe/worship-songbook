/**
 * In-memory access token + persisted refresh token for native clients.
 * Web cookie sessions never use this module for auth.
 */

import { secureDelete, secureGet, secureSet } from './secureStorage'

const REFRESH_KEY = 'songbook.refreshToken'
const BAND_KEY = 'songbook.selectedBand'

let accessToken = ''
let selectedBandId = ''
let authFailureHandler = null

export function onNativeAuthFailure(handler) {
  authFailureHandler = typeof handler === 'function' ? handler : null
}

export function notifyNativeAuthFailure() {
  accessToken = ''
  if (authFailureHandler) authFailureHandler()
}

export function getAccessToken() {
  return accessToken
}

export function setAccessToken(token) {
  accessToken = token || ''
}

export function clearAccessToken() {
  accessToken = ''
}

export function getSelectedBandId() {
  return selectedBandId
}

export function setSelectedBandId(id) {
  selectedBandId = id || ''
}

export async function persistRefreshToken(token) {
  if (!token) {
    await secureDelete(REFRESH_KEY)
    return
  }
  await secureSet(REFRESH_KEY, token)
}

export async function loadRefreshToken() {
  return (await secureGet(REFRESH_KEY)) || ''
}

export async function clearRefreshToken() {
  await secureDelete(REFRESH_KEY)
}

export async function persistSelectedBand(id) {
  selectedBandId = id || ''
  if (!id) {
    await secureDelete(BAND_KEY)
    return
  }
  await secureSet(BAND_KEY, id)
}

export async function loadSelectedBand() {
  const value = (await secureGet(BAND_KEY)) || ''
  selectedBandId = value
  return value
}

export async function clearNativeSession() {
  accessToken = ''
  selectedBandId = ''
  await clearRefreshToken()
  await secureDelete(BAND_KEY)
}

export async function applyNativeLoginTokens(payload) {
  setAccessToken(payload.accessToken || '')
  await persistRefreshToken(payload.refreshToken || '')
}
