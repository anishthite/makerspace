import {
  playCompletionChime,
  readCompletionChime,
  writeCompletionChime,
} from './completion-chimes.js';

const status = document.querySelector('#chime-status');

function setStatus(message) {
  if (status) status.textContent = message;
}

writeCompletionChime('spark');

document.querySelector('#play-spark')?.addEventListener('click', async () => {
  const played = await playCompletionChime({ id: 'spark', outcome: 'success' });
  setStatus(played ? 'Played spark.' : 'Playback was blocked by the browser.');
});

document.querySelector('#play-failed')?.addEventListener('click', async () => {
  const played = await playCompletionChime({ outcome: 'error' });
  setStatus(played ? `Played failed tone for ${readCompletionChime()}.` : 'Playback was blocked by the browser.');
});

setStatus(`Installed: ${readCompletionChime()}.`);
