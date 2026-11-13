import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Trash2, Sparkles, Radio } from 'lucide-react';
import { pauseAndSend, flushRecording } from './VoiceSubmission';
import { composeQuestionText } from './QuestionText';
import { SilenceAutoSend } from './SilenceAutoSend';
import { Button } from '../ui/button';
import { useToast } from '../../contexts/toast';

interface AudioListenerProps {
  isListening: boolean;
  setIsListening: (listening: boolean) => void;
}

export const AudioListener: React.FC<AudioListenerProps> = ({ isListening, setIsListening }) => {
  const [transcript, setTranscript] = useState<string>('');
  const [interimText, setInterimText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingMessage, setProcessingMessage] = useState('Preparing answer...');
  const [submissionError, setSubmissionError] = useState('');
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const [sendNotice, setSendNotice] = useState('');
  const questionTextRef = useRef('');
  const hasVoiceRef = useRef(false);
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  questionTextRef.current = composeQuestionText(transcript, interimText);

  // Web Speech API
  const recognitionRef = useRef<any>(null);

  // Native Audio & MediaRecorder
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const samplingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceDetectorRef = useRef<SilenceAutoSend | null>(null);
  const sessionRef = useRef(0);
  const listeningRef = useRef(isListening);
  listeningRef.current = isListening;
  const isSubmittingRef = useRef<boolean>(false);

  // DOM ref for zero-react-render equalizer
  const eqBarsRef = useRef<(HTMLDivElement | null)[]>([]);
  const soundDotRef = useRef<HTMLSpanElement | null>(null);

  const { showToast } = useToast();

  // Forward ref for handleSend
  const handleSendRef = useRef<(reason?: 'manual' | 'silence' | 'pause') => Promise<void>>(async () => {});

  const handleSend = useCallback(async (reason: 'manual' | 'silence' | 'pause' = 'manual') => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsProcessing(true);
    setProcessingMessage('Preparing answer...');
    setSilenceCountdown(null);
    setSendNotice(reason === 'silence' ? 'Three seconds of silence detected. Sending your voice question...' : reason === 'pause' ? 'Recording paused. Sending your voice question...' : 'Sending your question...');
    setSubmissionError('');
    silenceDetectorRef.current?.reset();

    const fullText = questionTextRef.current.trim();

    try {
      if (fullText) {
        const result = await window.electronAPI.processAudioTranscript(fullText);
        if (!result?.success) throw new Error(result?.error || 'Failed to answer question');
        setTranscript('');
        setInterimText('');
        questionTextRef.current = '';
        setSendNotice('Question sent. Answer received.');
        return;
      }
      // Stop and flush the current recording before sending. Restarting after
      // the answer creates a complete new audio file, including its header.
      const recorder = mediaRecorderRef.current;
      if (recorder) await flushRecording(recorder);

      // If we have recorded raw audio chunks, send direct audio buffer
      if (!fullText && audioChunksRef.current.length > 0) {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorderRef.current?.mimeType || 'audio/webm'
        });

        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1] || '';
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(audioBlob);
        });

        const base64Audio = await base64Promise;

        if (base64Audio && base64Audio.length > 100) {
          const result = await window.electronAPI.processAudioDirect(
            base64Audio,
            mediaRecorderRef.current?.mimeType || 'audio/webm'
          );
          if (!result.success) throw new Error(result.error || 'Failed to answer audio question');
          setTranscript('');
          setInterimText('');
          audioChunksRef.current = [];
          questionTextRef.current = '';
          setSendNotice('Voice question sent. Answer received.');
          return;
        }
      }

      setSendNotice('No question detected.');
      showToast('No Question', 'Type a question or speak into your microphone.', 'neutral');
    } catch (err: any) {
      console.error('Audio processing error:', err);
      const message = err.message || 'Failed to send question';
      setSendNotice('Sending failed. Please retry.');
      setSubmissionError(message);
      showToast('Error', message, 'error');
    } finally {
      setIsProcessing(false);
      isSubmittingRef.current = false;
      audioChunksRef.current = [];
      hasVoiceRef.current = false;
      setSilenceCountdown(null);
      silenceDetectorRef.current?.reset();
      const recorder = mediaRecorderRef.current;
      const restart = () => {
        audioChunksRef.current = [];
        if (listeningRef.current && mediaRecorderRef.current === recorder && recorder?.state === 'inactive' && mediaStreamRef.current?.active) {
          try { recorder.start(400); } catch (error) { setIsListening(false); }
        }
      };
      if (recorder && recorder.state !== 'inactive') {
        recorder.addEventListener('stop', restart, { once: true });
        try { recorder.stop(); } catch (error) { recorder.removeEventListener('stop', restart); }
      } else { restart(); }
    }
  }, [showToast, setIsListening]);

  handleSendRef.current = handleSend;

  // Initialize MediaRecorder and Web Audio Analyser
  const startRecording = useCallback(async () => {
    const sessionId = ++sessionRef.current;
    try {
      audioChunksRef.current = [];
      hasVoiceRef.current = false;
      setSilenceCountdown(null);
      silenceDetectorRef.current?.reset();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      if (sessionId !== sessionRef.current || !listeningRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      mediaStreamRef.current = stream;

      // Audio Context for visualizer and VAD
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.5;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      // VAD & Visualizer loop (updates direct DOM nodes for 0 React re-renders = 0 jitter)
      const VAD_VOICE_THRESHOLD = 18;
      const detector = new SilenceAutoSend(() => {
        if (listeningRef.current && !isSubmittingRef.current) void handleSendRef.current('silence');
      }, 3000);
      silenceDetectorRef.current = detector;

      const updateVAD = () => {
        if (!analyserRef.current) return;
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;

        // Direct DOM update for equalizer bars (no React state churn)
        eqBarsRef.current.forEach((bar, idx) => {
          if (bar) {
            const factor = [0.4, 0.9, 1.3, 0.7, 1.1, 0.5, 0.8, 0.3][idx] || 0.6;
            const barHeight = Math.max(3, Math.min(14, Math.round((avg * factor) / 4)));
            bar.style.height = `${barHeight}px`;
            bar.style.backgroundColor = avg > 12 ? '#34d399' : '#52525b';
          }
        });

        if (soundDotRef.current) {
          soundDotRef.current.style.backgroundColor = avg > 12 ? '#34d399' : '#10b981';
        }

        if (!listeningRef.current || isSubmittingRef.current) return;
        if (avg > VAD_VOICE_THRESHOLD) {
          hasVoiceRef.current = true;
          detector.voiceDetected();
          setSilenceCountdown(null);
        } else {
          setSilenceCountdown(detector.remainingSeconds);
        }
      };
      samplingIntervalRef.current = setInterval(updateVAD, 100);

      // MediaRecorder with audio/webm
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
        else mimeType = '';
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      recorder.start(400); // 400ms slices
      mediaRecorderRef.current = recorder;

      // Start Web Speech API as background subtitle helper
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition && !recognitionRef.current) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';

          recognition.onresult = (event: any) => {
            if (isSubmittingRef.current || !listeningRef.current) return;
            hasVoiceRef.current = true;
            // Recognized speech also resets the silence timer.
            detector.voiceDetected();
            let currentInterim = '';
            let finalChunk = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const item = event.results[i];
              if (item.isFinal) {
                finalChunk += item[0].transcript + ' ';
              } else {
                currentInterim += item[0].transcript;
              }
            }
            if (finalChunk) {
              setTranscript(prev => composeQuestionText(prev, finalChunk));
            }
            questionTextRef.current = composeQuestionText(
              finalChunk ? composeQuestionText(transcriptRef.current, finalChunk) : transcriptRef.current,
              currentInterim
            );
            if (finalChunk) transcriptRef.current = composeQuestionText(transcriptRef.current, finalChunk);
            setInterimText(currentInterim);
          };

          recognition.onerror = () => {};
          recognition.onend = () => {
            if (listeningRef.current && recognitionRef.current === recognition) {
              try { recognition.start(); } catch (error) { /* Raw audio remains available. */ }
            }
          };
          recognition.start();
          recognitionRef.current = recognition;
        } catch (e) {}
      }
    } catch (error: any) {
      console.error('Failed to open microphone:', error);
      showToast('Mic Error', 'Could not open microphone.', 'error');
      setIsListening(false);
    }
  }, [setIsListening, showToast]);

  const stopRecording = useCallback(() => {
    sessionRef.current++;
    silenceDetectorRef.current?.reset();
    silenceDetectorRef.current = null;
    setSilenceCountdown(null);
    if (samplingIntervalRef.current) clearInterval(samplingIntervalRef.current);
    samplingIntervalRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isListening) {
      startRecording();
    } else {
      stopRecording();
    }
    return () => {
      stopRecording();
    };
  }, [isListening, startRecording, stopRecording]);

  useEffect(() => {
    return window.electronAPI.onProcessingStatus((status: { message: string; progress: number }) => {
      if (isSubmittingRef.current) setProcessingMessage(status.message);
    });
  }, []);

  const handleToggleListening = useCallback(() => {
    if (!listeningRef.current) {
      if (isSubmittingRef.current) return;
      listeningRef.current = true;
      setSendNotice('');
      setIsListening(true);
      return;
    }
    // Prevent restarting the microphone when this submission finishes.
    listeningRef.current = false;
    silenceDetectorRef.current?.reset();
    setSilenceCountdown(null);
    pauseAndSend(
      hasVoiceRef.current || Boolean(questionTextRef.current.trim()),
      isSubmittingRef.current,
      () => { void handleSendRef.current('pause'); },
      () => setIsListening(false)
    );
  }, [setIsListening]);

  useEffect(() => {
    return window.electronAPI.onToggleAudioListening(handleToggleListening);
  }, [handleToggleListening]);

  const handleClear = () => {
    setSubmissionError('');
    setSendNotice('');
    setSilenceCountdown(null);
    hasVoiceRef.current = false;
    questionTextRef.current = '';
    transcriptRef.current = '';
    setTranscript('');
    setInterimText('');
    audioChunksRef.current = [];
    silenceDetectorRef.current?.reset();
  };


  const displayText = composeQuestionText(transcript, interimText);

  return (
    <div className="mx-2 my-1.5 p-2 rounded-lg bg-zinc-900/95 border border-emerald-500/40 shadow-xl backdrop-blur-md transition-none">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {isListening && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span
              ref={soundDotRef}
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                isListening ? 'bg-emerald-500' : 'bg-zinc-500'
              }`}
            ></span>
          </span>

          <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 animate-pulse" />
            {isProcessing ? processingMessage : isListening ? 'Auto-Listening Active' : 'Voice Input Ready'}
          </span>

          {/* Equalizer Visualizer Bars (0 React re-renders) */}
          {isListening && (
            <div className="flex items-end gap-0.5 h-3.5 px-1 py-0.5 bg-black/40 rounded border border-white/5">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div
                  key={i}
                  ref={(el) => (eqBarsRef.current[i] = el)}
                  style={{ height: '3px' }}
                  className="w-0.5 rounded-full bg-zinc-600 transition-none"
                />
              ))}
            </div>
          )}

          <span className="text-[10px] text-emerald-400/80 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/20">
            Sends after 3s of silence
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {displayText && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-6 px-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              disabled={isProcessing}
              title="Clear text"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleListening}
            disabled={isProcessing && !isListening}
            className={`h-6 px-2 text-xs font-medium ${
              isListening
                ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
            }`}
          >
            {isListening ? (
              <>
                <MicOff className="h-3 w-3 mr-1" /> Pause
              </>
            ) : (
              <>
                <Mic className="h-3 w-3 mr-1" /> Listen
              </>
            )}
          </Button>

          <Button
            size="sm"
            onClick={() => void handleSend('manual')}
            disabled={isProcessing}
            className="h-6 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow flex items-center gap-1.5"
          >
            <Sparkles className="h-3 w-3" />
            {isProcessing ? 'Thinking...' : submissionError ? 'Retry' : 'Solve Now'}
          </Button>
        </div>
      </div>

      <p role="status" aria-live="polite" className="mb-2 text-xs text-emerald-300">
        {isProcessing ? `${sendNotice} ${processingMessage}` : silenceCountdown !== null ? `Sending automatically in ${silenceCountdown}s of silence...` : sendNotice}
      </p>
      {submissionError && <p role="alert" className="mb-2 text-xs text-red-300">{submissionError}</p>}
      {/* Editable live transcript / question text area */}
      <div className="relative">
        <textarea
          value={displayText}
          disabled={isProcessing}
          onChange={(e) => {
            setSubmissionError('');
            questionTextRef.current = e.target.value;
            transcriptRef.current = e.target.value;
            setTranscript(e.target.value);
            setInterimText('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            isListening
              ? '🎙️ Listening... Ask a question in any field. Pause for 3 seconds to send automatically.'
              : 'Ask any question: science, math, business, history, writing…'
          }
          rows={2}
          className="w-full text-xs text-zinc-100 bg-black/60 rounded p-1.5 border border-white/10 focus:border-emerald-500/50 focus:outline-none resize-none placeholder:text-zinc-500"
        />
      </div>
    </div>
  );
};
