import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MAX_RECORDING_MS = 30_000;

export default function VoiceRouteControl() {
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const pendingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const timerRef = useRef(null);
  const pointerRef = useRef(null);
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('Halten Sie den Knopf und sagen Sie zum Beispiel: „Von Garching nach Ismaning“.');
  const [mount, setMount] = useState(null);

  useEffect(() => {
    setMount(document.getElementById('voice-root'));
    return () => {
      clearTimeout(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function sendRecording(blob) {
    if (!blob?.size) {
      setState('idle');
      setMessage('Keine Audiodaten aufgenommen. Bitte den Knopf länger halten.');
      return;
    }
    const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const audioFile = new File([blob], `route-${Date.now()}.${extension}`, { type: blob.type || 'audio/webm' });
    const form = new FormData();
    form.append('file', audioFile, audioFile.name);
    setState('sending');
    setMessage('Text wird verarbeitet …');
    try {
      const response = await fetch('/api/transcribe', { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Serverfehler (${response.status}).`);
      if (!result.text?.trim()) throw new Error('Kein Text erkannt. Bitte lauter und näher am Mikrofon sprechen.');
      setState('idle');
      setMessage(`Erkannt: „${result.text.trim()}“`);
      window.dispatchEvent(new CustomEvent('voice:route', { detail: { transcript: result.text.trim() } }));
    } catch (error) {
      console.error('Voice transcription upload failed:', error);
      setState('error');
      setMessage(error.message || 'Spracherkennung fehlgeschlagen. Bitte erneut versuchen.');
    }
  }

  async function startRecording(pointerId) {
    if (pendingRef.current || recorderRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('error');
      setMessage('Dieses Gerät unterstützt keine Browser-Aufnahme.');
      console.error('Voice recording unavailable: MediaRecorder/getUserMedia missing.');
      return;
    }
    pendingRef.current = true;
    stopRequestedRef.current = false;
    pointerRef.current = pointerId ?? null;
    setState('starting');
    setMessage('Mikrofon wird vorbereitet …');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      if (stopRequestedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        pendingRef.current = false;
        setState('idle');
        return;
      }
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error || event);
        setState('error');
        setMessage('Mikrofonaufnahme fehlgeschlagen. Bitte Mikrofonzugriff prüfen.');
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        pendingRef.current = false;
      };
      recorder.onstop = () => {
        clearTimeout(timerRef.current);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        pendingRef.current = false;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        void sendRecording(blob);
      };
      recorder.start(250);
      pendingRef.current = false;
      setState('recording');
      setMessage('Mikrofon hört zu … loslassen beendet die Aufnahme.');
      timerRef.current = setTimeout(() => stopRecording(true), MAX_RECORDING_MS);
    } catch (error) {
      console.error('Microphone start failed:', error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      pendingRef.current = false;
      setState('error');
      setMessage(error.name === 'NotAllowedError' ? 'Mikrofon gesperrt. Bitte Mikrofonzugriff im Browser erlauben.' : 'Mikrofon konnte nicht gestartet werden. Bitte erneut versuchen.');
    }
  }

  function stopRecording(fromLimit = false) {
    if (pendingRef.current && !recorderRef.current) {
      stopRequestedRef.current = true;
      return;
    }
    if (recorderRef.current?.state === 'recording') {
      if (fromLimit) setMessage('Maximale Aufnahmedauer erreicht. Text wird verarbeitet …');
      recorderRef.current.stop();
    }
  }

  function resetError() {
    if (state === 'error') {
      setState('idle');
      setMessage('Halten Sie den Knopf und sagen Sie zum Beispiel: „Von Garching nach Ismaning“.');
    }
  }

  if (!mount) return null;
  return createPortal(<div className="voice-control">
    <button
      type="button"
      className={`voice-button${state === 'recording' ? ' is-recording' : ''}`}
      aria-label={state === 'recording' ? 'Aufnahme beenden' : 'Strecke sprechen'}
      aria-pressed={state === 'recording'}
      disabled={state === 'sending'}
      onPointerDown={(event) => { if (event.button === 0) { event.currentTarget.setPointerCapture?.(event.pointerId); resetError(); void startRecording(event.pointerId); } }}
      onPointerUp={(event) => { if (pointerRef.current === event.pointerId) stopRecording(); }}
      onPointerCancel={() => stopRecording()}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          resetError();
          void startRecording('keyboard');
        }
      }}
      onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') stopRecording(); }}
      onContextMenu={(event) => event.preventDefault()}
    >{state === 'starting' ? 'Mikrofon startet …' : state === 'sending' ? 'Text wird verarbeitet …' : state === 'recording' ? 'Mikrofon hört zu … loslassen zum Beenden' : state === 'error' ? 'Erneut versuchen' : 'Strecke sprechen'}</button>
    <p className={`voice-message${state === 'error' ? ' voice-error' : ''}`} aria-live="assertive">{message}</p>
  </div>, mount);
}
