window.earlyTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
window.savedFormatter = Intl.DateTimeFormat;
window.workerResult = new Promise((resolve, reject) => {
  const worker = new Worker('/worker.js');
  worker.onmessage = event => { resolve(event.data); worker.terminate(); };
  worker.onerror = reject;
});
