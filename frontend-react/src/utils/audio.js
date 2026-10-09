let audioAlertPlaying = false;

export function playSiren() {
  if (audioAlertPlaying) return;
  audioAlertPlaying = true;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(850, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(350, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.7);
    setTimeout(() => { audioAlertPlaying = false; }, 1500);
  } catch (e) {
    audioAlertPlaying = false;
  }
}