// Start the upload before microphone cleanup so its final audio chunk is kept.
export function pauseAndSend(
  hasQuestion: boolean,
  isSending: boolean,
  send: () => void,
  pause: () => void
): void {
  if (hasQuestion && !isSending) send()
  pause()
}

export function flushRecording(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === 'inactive') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      recorder.removeEventListener('stop', onStop)
      recorder.removeEventListener('error', onError)
    }
    const onStop = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); reject(new Error('Audio recording failed')) }
    recorder.addEventListener('stop', onStop)
    recorder.addEventListener('error', onError)
    try { recorder.stop() } catch (error) { cleanup(); reject(error) }
  })
}
