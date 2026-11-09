import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function VoiceRouteControl() {
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const pointerRef = useRef(null);
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const [mount, setMount] = useState(null);

  useEffect(() => { setMount(document.getElementById('voice-root')); }, []);

  async function startRecording(pointerId) {
    if (state !== 'idle' || recorderRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      pointerRef.current = pointerId ?? null;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        if (!chunksRef.current.length) {
          setState('idle');
          setMessage('Keine Aufnahme erkannt. Bitte noch einmal versuchen.');
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
        const form = new FormData();
        form.append('file', blob, `route.${extension}`);
        setState('sending');
        setMessage('Aufnahme wird erkannt …');
        try {
          const response = await fetch('/api/transcribe', { method: 'POST', body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Die Spracherkennung ist fehlgeschlagen.');
          if (!result.text) throw new Error('Ich habe keine Strecke erkannt. Bitte noch einmal versuchen.');
          setState('idle');
          setMessage(`Erkannt: „${result.text}“`);
          window.dispatchEvent(new CustomEvent('voice:route', { detail: { transcript: result.text } }));
        } catch (error) {
          setState('idle');
          setMessage(error.message || 'Die Spracherkennung ist fehlgeschlagen.');
        }
      };
      recorder.start();
      setState('recording');
      setMessage('Ich höre zu. Loslassen beendet die Aufnahme.');
    } catch {
      setState('idle');
      setMessage('Mikrofonzugriff nicht möglich. Bitte Mikrofon im Browser erlauben.');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  if (!mount) return null;
  return createPortal(<div className="voice-control">
    <button
      type="button"
      className={`voice-button${state === 'recording' ? ' is-recording' : ''}`}
      aria-label={state === 'recording' ? 'Aufnahme beenden' : 'Strecke sprechen'}
      aria-pressed={state === 'recording'}
      disabled={state === 'sending'}
      onPointerDown={(event) => { if (event.button === 0) startRecording(event.pointerId); }}
      onPointerUp={(event) => { if (pointerRef.current === event.pointerId) stopRecording(); }}
      onPointerCancel={stopRecording}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          startRecording('keyboard');
        }
      }}
      onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') stopRecording(); }}
      onContextMenu={(event) => event.preventDefault()}
    >{state === 'sending' ? 'Erkennt …' : state === 'recording' ? 'Aufnahme läuft · loslassen zum Beenden' : 'Strecke sprechen'}</button>
    <p className="voice-message" aria-live="polite">{message || 'Mikrofon halten oder antippen, dann zum Beenden loslassen.'}</p>
  </div>, mount);
}
