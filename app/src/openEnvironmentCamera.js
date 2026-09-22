export async function openEnvironmentCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error('camera-unavailable')
    error.name = 'NotFoundError'
    throw error
  }
  const attempts = [
    { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { audio: false, video: { facingMode: { ideal: 'environment' } } },
    { audio: false, video: true },
  ]
  let lastError = null
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (error) {
      lastError = error
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') throw error
    }
  }
  throw lastError || new Error('camera-unavailable')
}
