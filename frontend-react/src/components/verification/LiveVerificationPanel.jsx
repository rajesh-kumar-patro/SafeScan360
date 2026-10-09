import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  Camera,
  CameraOff,
  SkipForward,
  AlertTriangle,
  ShieldCheck,
  XCircle,
  Volume2,
} from 'lucide-react';

import {
  getLiveState,
  nextPerson,
} from '../../utils/verifyApi';

// ============================================================
// CONFIGURATION
// ============================================================

const PPE_ITEMS = [
  ['helmet', 'Helmet'],
  ['vest', 'Vest'],
  ['gloves', 'Gloves'],
  ['shoes', 'Shoes'],
];

const FACE_STEPS = [
  ['DETECTING_FACE', 'Detecting Face'],
  ['FACE_FOUND', 'Face Found'],
  ['VERIFYING', 'Verifying Identity'],
  ['FACE_VERIFIED', 'Face Verified'],
];

const POLL_MS = 500;
const POPUP_MS = 5000;

const WARNING_SOUND_INTERVAL = 2000;
const FACE_WARNING_SOUND_INTERVAL = 2000;

const ABSENT_GRACE_MS = 1500;

const CAMERA_UNAVAILABLE =
  'Camera unavailable. Please check your camera connection.';

// ============================================================
// HELPERS
// ============================================================

const Spinner = () => (
  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
);

function emailNote(result) {
  if (!result?.alert) return null;

  switch (result.email_status) {
    case 'sent':
      return {
        tone: 'text-emerald-700',
        text: '✉ Email alert sent.',
      };

    case 'failed':
      return {
        tone: 'text-rose-700',
        text: 'Alert stored. Email delivery failed.',
      };

    case 'not_configured':
      return {
        tone: 'text-slate-500',
        text: 'Alert stored. Email is not configured (SMTP settings missing in .env).',
      };

    default:
      return {
        tone: 'text-blue-700',
        text: '✉ Sending email alert…',
      };
  }
}

const POPUP_POSITION =
  'absolute left-1/2 top-1/2 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2';

function WorkerAvatar({
  popup,
  ring,
  fallbackBg,
  fallbackText,
  Icon,
  size = 'h-20 w-20',
}) {
  return popup.image ? (
    <img
      src={popup.image}
      alt={popup.name || 'Worker'}
      className={`mx-auto ${size} rounded-2xl object-cover ring-4 ${ring}`}
    />
  ) : (
    <div
      className={`mx-auto flex ${size} items-center justify-center rounded-2xl ${fallbackBg} ${fallbackText}`}
    >
      <Icon size={34} />
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function LiveVerificationPanel() {
  // ==========================================================
  // STATE
  // ==========================================================

  const [running, setRunning] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [popup, setPopup] = useState(null);

  // ==========================================================
  // TIMERS
  // ==========================================================

  const timerRef = useRef(null);

  const popupTimer = useRef(null);

  const warningSoundTimer = useRef(null);

  const faceWarningSoundTimer = useRef(null);

  const absentTimer = useRef(null);

  // ==========================================================
  // SESSION TRACKING
  // ==========================================================

  const popupSession = useRef('');

  const currentSession = useRef('');

  // null | 'incomplete' | 'complete'
  const lastPpeStatus = useRef(null);

  // null | 'unknown'
  const lastFaceWarningSession = useRef('');

  // ==========================================================
  // AUDIO
  // ==========================================================

  const audioContextRef = useRef(null);

  // Currently playing PPE warning oscillator
  const warningOscillatorRef = useRef(null);

  // Currently playing face warning oscillator
  const faceWarningOscillatorRef = useRef(null);

  // ==========================================================
  // INITIALIZE AUDIO
  // ==========================================================

  const getAudioContext = useCallback(() => {
    try {
      const AudioContextClass =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioContextClass) {
        console.warn(
          'Web Audio API is not supported by this browser.'
        );

        return null;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      return audioContextRef.current;
    } catch (err) {
      console.error('Audio initialization failed:', err);
      return null;
    }
  }, []);

  // ==========================================================
  // UNLOCK AUDIO
  // ==========================================================

  const unlockAudio = useCallback(async () => {
    try {
      const ctx = getAudioContext();

      if (!ctx) return false;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      return ctx.state === 'running';
    } catch (err) {
      console.warn('Audio could not be unlocked:', err);
      return false;
    }
  }, [getAudioContext]);

  // ==========================================================
  // PLAY SOUND
  //
  // type:
  // warning       = PPE warning
  // face_warning  = unknown face warning
  // success       = PPE complete
  // ==========================================================

  const playSafetySound = useCallback(
    (type = 'warning') => {
      const ctx = audioContextRef.current;

      if (!ctx) return;

      try {
        // If browser suspended audio, try to resume.
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }

        if (ctx.state !== 'running') return;

        const oscillator = ctx.createOscillator();

        const gain = ctx.createGain();

        oscillator.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;

        // ====================================================
        // PPE WARNING SOUND
        // ====================================================

        if (type === 'warning') {
          oscillator.type = 'square';

          oscillator.frequency.setValueAtTime(
            700,
            now
          );

          oscillator.frequency.setValueAtTime(
            450,
            now + 0.18
          );

          oscillator.frequency.setValueAtTime(
            700,
            now + 0.36
          );

          gain.gain.setValueAtTime(
            0.0001,
            now
          );

          gain.gain.exponentialRampToValueAtTime(
            0.45,
            now + 0.03
          );

          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            now + 0.45
          );

          warningOscillatorRef.current = oscillator;

          oscillator.start(now);

          oscillator.stop(now + 0.5);
        }

        // ====================================================
        // UNKNOWN FACE WARNING SOUND
        // ====================================================

        else if (type === 'face_warning') {
          oscillator.type = 'sawtooth';

          oscillator.frequency.setValueAtTime(
            950,
            now
          );

          oscillator.frequency.setValueAtTime(
            600,
            now + 0.15
          );

          oscillator.frequency.setValueAtTime(
            950,
            now + 0.30
          );

          gain.gain.setValueAtTime(
            0.0001,
            now
          );

          gain.gain.exponentialRampToValueAtTime(
            0.30,
            now + 0.03
          );

          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            now + 0.38
          );

          faceWarningOscillatorRef.current = oscillator;

          oscillator.start(now);

          oscillator.stop(now + 0.42);
        }

        // ====================================================
        // SUCCESS SOUND
        // ====================================================

        else if (type === 'success') {
          oscillator.type = 'sine';

          oscillator.frequency.setValueAtTime(
            880,
            now
          );

          oscillator.frequency.setValueAtTime(
            1100,
            now + 0.12
          );

          gain.gain.setValueAtTime(
            0.0001,
            now
          );

          gain.gain.exponentialRampToValueAtTime(
            0.35,
            now + 0.03
          );

          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            now + 0.45
          );

          oscillator.start(now);

          oscillator.stop(now + 0.5);
        }

        // ====================================================
        // CLEANUP
        // ====================================================

        oscillator.onended = () => {
          try {
            if (
              warningOscillatorRef.current === oscillator
            ) {
              warningOscillatorRef.current = null;
            }

            if (
              faceWarningOscillatorRef.current === oscillator
            ) {
              faceWarningOscillatorRef.current = null;
            }

            oscillator.disconnect();

            gain.disconnect();
          } catch {}
        };
      } catch (err) {
        console.error(
          'Safety sound failed:',
          err
        );
      }
    },
    []
  );

  // ==========================================================
  // STOP CURRENT PPE WARNING TONE
  // ==========================================================

  const stopCurrentWarningTone = useCallback(() => {
    const oscillator =
      warningOscillatorRef.current;

    if (oscillator) {
      try {
        oscillator.stop();
      } catch {}

      warningOscillatorRef.current = null;
    }
  }, []);

  // ==========================================================
  // STOP CURRENT FACE WARNING TONE
  // ==========================================================

  const stopCurrentFaceWarningTone =
    useCallback(() => {
      const oscillator =
        faceWarningOscillatorRef.current;

      if (oscillator) {
        try {
          oscillator.stop();
        } catch {}

        faceWarningOscillatorRef.current = null;
      }
    }, []);

  // ==========================================================
  // STOP PPE WARNING
  // ==========================================================

  const stopWarningSound = useCallback(() => {
    if (warningSoundTimer.current) {
      clearInterval(
        warningSoundTimer.current
      );

      warningSoundTimer.current = null;
    }

    stopCurrentWarningTone();
  }, [stopCurrentWarningTone]);

  // ==========================================================
  // START PPE WARNING
  // ==========================================================

  const startWarningSound = useCallback(() => {
    if (warningSoundTimer.current) {
      return;
    }

    // Play immediately.
    playSafetySound('warning');

    // Then every 2 seconds.
    warningSoundTimer.current =
      setInterval(() => {
        playSafetySound('warning');
      }, WARNING_SOUND_INTERVAL);
  }, [playSafetySound]);

  // ==========================================================
  // STOP FACE WARNING
  // ==========================================================

  const stopFaceWarningSound =
    useCallback(() => {
      if (faceWarningSoundTimer.current) {
        clearInterval(
          faceWarningSoundTimer.current
        );

        faceWarningSoundTimer.current = null;
      }

      stopCurrentFaceWarningTone();

      lastFaceWarningSession.current = '';
    }, [stopCurrentFaceWarningTone]);

  // ==========================================================
  // START FACE WARNING
  // ==========================================================

  const startFaceWarningSound =
    useCallback(() => {
      if (faceWarningSoundTimer.current) {
        return;
      }

      // Play immediately.
      playSafetySound('face_warning');

      // Repeat every 2 seconds.
      faceWarningSoundTimer.current =
        setInterval(() => {
          playSafetySound('face_warning');
        }, FACE_WARNING_SOUND_INTERVAL);
    }, [playSafetySound]);

  // ==========================================================
  // POLL BACKEND
  // ==========================================================

  const poll = useCallback(async () => {
    try {
      const res = await fetch(
        '/api/live-verify/state',
        {
          cache: 'no-store',
        }
      );

      const data = await res.json();

      if (res.ok) {
        setState(data);
      }
    } catch {
      // Keep previous state if backend briefly fails.
    }
  }, []);

  // ==========================================================
  // STOP CAMERA
  // ==========================================================

  const stop = useCallback(() => {
    clearInterval(timerRef.current);

    timerRef.current = null;

    stopWarningSound();

    stopFaceWarningSound();

    clearTimeout(absentTimer.current);

    absentTimer.current = null;

    clearTimeout(popupTimer.current);

    lastPpeStatus.current = null;

    currentSession.current = '';

    popupSession.current = '';

    lastFaceWarningSession.current = '';

    setRunning(false);

    setStreamUrl('');

    setState(null);

    setPopup(null);
  }, [
    stopWarningSound,
    stopFaceWarningSound,
  ]);

  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);

      clearInterval(
        warningSoundTimer.current
      );

      clearInterval(
        faceWarningSoundTimer.current
      );

      clearTimeout(absentTimer.current);

      clearTimeout(popupTimer.current);

      try {
        warningOscillatorRef.current?.stop();
      } catch {}

      try {
        faceWarningOscillatorRef.current?.stop();
      } catch {}

      if (audioContextRef.current) {
        audioContextRef.current
          .close()
          .catch(() => {});

        audioContextRef.current = null;
      }
    };
  }, []);

  // ==========================================================
  // START CAMERA
  // ==========================================================

  const start = async () => {
    setError('');

    // Important:
    // Create/unlock AudioContext from the button click.
    await unlockAudio();

    // --------------------------------------------------------
    // CHECK CAMERA
    // --------------------------------------------------------

    try {
      const data = await getLiveState();

      if (!data.camera?.configured) {
        setError(
          CAMERA_UNAVAILABLE +
            " No camera is configured: set CAMERA_RTSP_URL in the backend .env (a number such as 0 uses the computer's own camera)."
        );

        return;
      }
    } catch (e) {
      setError(
        e?.message ||
          'Unable to connect to the verification backend.'
      );

      return;
    }

    // --------------------------------------------------------
    // RESET OLD SESSION
    // --------------------------------------------------------

    stopWarningSound();

    stopFaceWarningSound();

    clearTimeout(
      absentTimer.current
    );

    absentTimer.current = null;

    clearTimeout(
      popupTimer.current
    );

    lastPpeStatus.current = null;

    currentSession.current = '';

    popupSession.current = '';

    lastFaceWarningSession.current = '';

    setPopup(null);

    // --------------------------------------------------------
    // START STREAM
    // --------------------------------------------------------

    setStreamUrl(
      `/api/live-verify/stream?t=${Date.now()}`
    );

    setRunning(true);

    clearInterval(timerRef.current);

    timerRef.current =
      setInterval(
        poll,
        POLL_MS
      );

    poll();
  };

  // ==========================================================
  // DERIVED STATE
  // ==========================================================

  const snap = state?.snapshot;

  const verified =
    Boolean(snap?.face?.verified);

  /*
    Backend should provide:

      face_present: true / false

    If old backend does not provide it,
    assume face is present.
  */

  const facePresent =
    state?.face_present !== false;

  // ==========================================================
  // UNKNOWN FACE / FACE FAILED
  // ==========================================================

  const faceStatusCode =
    snap?.status?.code;

  const faceFailed =
    faceStatusCode === 'FACE_FAILED' &&
    snap?.phase === 'failed';

  const unknownPerson =
    faceStatusCode === 'UNKNOWN_PERSON' &&
    snap?.phase === 'failed';

  // ==========================================================
  // WORKER LEFT CAMERA
  // ==========================================================

  useEffect(() => {
    if (!running) return;

    if (facePresent) {
      clearTimeout(
        absentTimer.current
      );

      absentTimer.current = null;

      return;
    }

    if (absentTimer.current) {
      return;
    }

    absentTimer.current =
      setTimeout(() => {
        absentTimer.current = null;

        // Stop BOTH warning sounds immediately.
        stopWarningSound();

        stopFaceWarningSound();

        lastPpeStatus.current = null;

        currentSession.current = '';

        lastFaceWarningSession.current = '';

        clearTimeout(
          popupTimer.current
        );

        setPopup(null);
      }, ABSENT_GRACE_MS);
  }, [
    running,
    facePresent,
    stopWarningSound,
    stopFaceWarningSound,
  ]);

  // ==========================================================
  // FACE BECAME VERIFIED
  // ==========================================================

  useEffect(() => {
    if (verified) {
      // Unknown-face warning must stop.
      stopFaceWarningSound();
    }
  }, [
    verified,
    stopFaceWarningSound,
  ]);

  // ==========================================================
  // UNKNOWN FACE WARNING
  //
  // Different sound from PPE warning.
  // ==========================================================

  useEffect(() => {
    if (!running) {
      stopFaceWarningSound();
      return;
    }

    // Worker left.
    if (!facePresent) {
      stopFaceWarningSound();
      return;
    }

    // Already verified.
    if (verified) {
      stopFaceWarningSound();
      return;
    }

    // Unknown face.
    if (unknownPerson || faceFailed) {
      const sessionId =
        snap?.session_id || 'face-warning';

      // Don't restart the timer on every 500ms poll.
      if (
        lastFaceWarningSession.current !==
        sessionId
      ) {
        lastFaceWarningSession.current =
          sessionId;

        startFaceWarningSound();
      }

      return;
    }

    // Face is simply being detected/verifying.
    stopFaceWarningSound();
  }, [
    running,
    facePresent,
    verified,
    unknownPerson,
    faceFailed,
    snap?.session_id,
    startFaceWarningSound,
    stopFaceWarningSound,
  ]);

  // ==========================================================
  // VERIFICATION INACTIVE
  // ==========================================================

  useEffect(() => {
    if (!verified) {
      stopWarningSound();

      lastPpeStatus.current = null;
    }
  }, [
    verified,
    stopWarningSound,
  ]);

  // ==========================================================
  // NEW WORKER SESSION
  // ==========================================================

  useEffect(() => {
    const sessionId =
      snap?.session_id;

    if (!sessionId) return;

    if (
      currentSession.current &&
      currentSession.current !== sessionId
    ) {
      stopWarningSound();

      stopFaceWarningSound();

      lastPpeStatus.current = null;

      lastFaceWarningSession.current = '';

      clearTimeout(
        popupTimer.current
      );

      setPopup(null);
    }

    currentSession.current =
      sessionId;
  }, [
    snap?.session_id,
    stopWarningSound,
    stopFaceWarningSound,
  ]);

  // ==========================================================
  // FACE VERIFIED POPUP
  //
  // NO SOUND HERE.
  // ==========================================================

  useEffect(() => {
    if (
      !verified ||
      !snap?.session_id
    ) {
      return;
    }

    if (
      snap.session_id ===
      popupSession.current
    ) {
      return;
    }

    popupSession.current =
      snap.session_id;

    setPopup({
      type: 'verified',
      name: snap.person?.name,
      mobile: snap.person?.mobile,
      image: snap.person?.image,
    });

    clearTimeout(
      popupTimer.current
    );

    popupTimer.current =
      setTimeout(() => {
        setPopup((current) =>
          current?.type === 'verified'
            ? null
            : current
        );
      }, POPUP_MS);
  }, [
    verified,
    snap?.session_id,
    snap?.person?.name,
    snap?.person?.mobile,
    snap?.person?.image,
  ]);

  // ==========================================================
  // PPE RESULT
  //
  // Incomplete:
  //   warning sound every 2 seconds
  //
  // Complete:
  //   warning stops
  //   success plays once
  // ==========================================================

  useEffect(() => {
    const ppeResult =
      snap?.result;

    // No PPE result.
    if (
      !verified ||
      !ppeResult?.ppe ||
      !facePresent
    ) {
      stopWarningSound();

      lastPpeStatus.current = null;

      return;
    }

    const sessionId =
      snap?.session_id;

    if (!sessionId) return;

    const missingItems =
      Array.isArray(
        ppeResult.missing
      )
        ? ppeResult.missing
        : [];

    const missingCount =
      missingItems.length;

    const percentage =
      Number(
        ppeResult.ppe_percentage || 0
      );

    const worker =
      snap.person ||
      ppeResult.person;

    // ========================================================
    // ALL PPE COMPLETE
    // ========================================================

    if (
      percentage === 100 &&
      missingCount === 0
    ) {
      stopWarningSound();

      if (
        lastPpeStatus.current !==
        'complete'
      ) {
        lastPpeStatus.current =
          'complete';

        // Unknown-face sound must also stop.
        stopFaceWarningSound();

        setPopup({
          type: 'ppe_success',
          name: worker?.name,
          mobile: worker?.mobile,
          image: worker?.image,
          percentage: 100,
          missing: [],
          missingCount: 0,
        });

        // Success sound ONCE.
        playSafetySound(
          'success'
        );

        clearTimeout(
          popupTimer.current
        );

        popupTimer.current =
          setTimeout(() => {
            setPopup((current) =>
              current?.type ===
              'ppe_success'
                ? null
                : current
            );
          }, POPUP_MS);
      }

      return;
    }

    // ========================================================
    // PPE INCOMPLETE
    // ========================================================

    if (missingCount > 0) {
      setPopup({
        type: 'ppe_warning',
        name: worker?.name,
        mobile: worker?.mobile,
        image: worker?.image,
        percentage,
        missing: missingItems,
        missingCount,
      });

      // Start only once.
      if (
        lastPpeStatus.current !==
        'incomplete'
      ) {
        lastPpeStatus.current =
          'incomplete';

        startWarningSound();
      }

      // Popup remains visible.
      clearTimeout(
        popupTimer.current
      );

      return;
    }

    // ========================================================
    // FALLBACK
    // ========================================================

    stopWarningSound();

    lastPpeStatus.current = null;
  }, [
    snap?.result,
    snap?.session_id,
    snap?.person,
    verified,
    facePresent,
    playSafetySound,
    startWarningSound,
    stopWarningSound,
    stopFaceWarningSound,
  ]);

  // ==========================================================
  // VALUES FOR RENDER
  // ==========================================================

  const result =
    snap?.result || null;

  const code =
    snap?.status?.code;

  const unknown =
    code === 'UNKNOWN_PERSON' &&
    snap?.phase === 'failed';

  const failedFace =
    code === 'FACE_FAILED' &&
    snap?.phase === 'failed';

  const person =
    !unknown && !failedFace
      ? result?.person?.mobile
        ? result.person
        : snap?.person
      : null;

  const itemState = (key) => {
    if (result?.ppe) {
      return result.ppe[key] === true
        ? 'present'
        : 'absent';
    }

    return snap?.ppe?.progress?.[
      key
    ]?.state;
  };

  const presentCount =
    PPE_ITEMS.filter(
      ([key]) =>
        itemState(key) === 'present'
    ).length;

  const pct = result
    ? result.ppe_percentage
    : Math.round(
        (presentCount / 4) * 100
      );

  const missing =
    result?.missing || [];

  const currentFaceStep =
    snap?.face?.step ||
    snap?.phase ||
    'DETECTING_FACE';

  const idle =
    !snap ||
    (snap.phase === 'face' &&
      !verified);

  const last =
    state?.last_result;

  const view =
    !idle
      ? snap
      : last
      ? {
          ...last,
          ppe: null,
          isLast: true,
        }
      : snap;

  const emailMessage =
    emailNote(result);

  // ==========================================================
  // NEXT PERSON
  // ==========================================================

  const handleNextPerson =
    async () => {
      stopWarningSound();

      stopFaceWarningSound();

      lastPpeStatus.current =
        null;

      currentSession.current =
        '';

      popupSession.current =
        '';

      lastFaceWarningSession.current =
        '';

      clearTimeout(
        popupTimer.current
      );

      setPopup(null);

      try {
        await nextPerson();

        await poll();
      } catch (e) {
        setError(
          e?.message ||
            'Unable to move to the next person.'
        );
      }
    };

  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="w-full space-y-6">

      {/* ======================================================
          ERROR
      ====================================================== */}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <div className="flex items-start gap-3">
            <AlertTriangle
              size={18}
              className="mt-0.5 shrink-0"
            />

            <div>
              <p className="font-bold">
                Camera / Verification Error
              </p>

              <p className="mt-1">
                {error}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================
          MAIN CAMERA CARD
      ====================================================== */}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        {/* HEADER */}

        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">

          <div className="flex items-center gap-2">

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Camera size={20} />
            </div>

            <div>
              <h2 className="text-lg font-black text-slate-900">
                Live Worker Verification
              </h2>

              <p className="text-xs text-slate-500">
                Face verification followed by PPE detection
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">

            {running ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700"
              >
                <CameraOff size={17} />
                Stop Camera
              </button>
            ) : (
              <button
                type="button"
                onClick={start}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700"
              >
                <Camera size={17} />
                Start Camera
              </button>
            )}

          </div>
        </div>

        {/* ====================================================
            CONTENT
        ==================================================== */}

        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,520px)_minmax(320px,1fr)]">

          {/* ==================================================
              CAMERA
          ================================================== */}

          <div className="flex items-start justify-center">

            <div className="relative w-full max-w-[520px] overflow-hidden rounded-2xl bg-slate-950">

              <div className="aspect-video w-full">

                {running && streamUrl ? (
                  <img
                    src={streamUrl}
                    alt="Live verification camera"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-400">

                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900">
                      <CameraOff size={28} />
                    </div>

                    <p className="text-sm font-bold text-slate-300">
                      Camera Idle
                    </p>

                    <p className="mt-1 max-w-sm text-xs text-slate-500">
                      Start the camera to begin worker face verification and PPE detection.
                    </p>

                  </div>
                )}

              </div>

              {/* LIVE BADGE */}

              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-bold text-white backdrop-blur">

                <span
                  className={`h-2 w-2 rounded-full ${
                    running
                      ? 'animate-pulse bg-emerald-400'
                      : 'bg-slate-500'
                  }`}
                />

                {running
                  ? 'LIVE'
                  : 'OFFLINE'}

              </div>

              {/* ==================================================
                  UNKNOWN FACE WARNING
              ================================================== */}

              {unknownPerson && (
                <div className={POPUP_POSITION}>
                  <div className="rounded-3xl border border-amber-300 bg-white p-5 shadow-2xl">

                    <div className="text-center">

                      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">

                        <AlertTriangle
                          size={36}
                        />

                      </div>

                      <div className="mt-4 flex items-center justify-center gap-2 text-amber-600">

                        <AlertTriangle
                          size={20}
                        />

                        <span className="text-xs font-black uppercase tracking-wider">
                          Unknown Worker
                        </span>

                      </div>

                      <h3 className="mt-1 text-2xl font-black text-slate-900">
                        Face Not Recognized
                      </h3>

                      <p className="mt-2 text-sm text-slate-500">
                        This person is not registered in the worker database.
                      </p>

                      <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white">

                        <Volume2
                          size={15}
                          className="animate-pulse"
                        />

                        UNKNOWN FACE WARNING

                      </div>

                      <p className="mt-2 text-[11px] font-semibold text-slate-400">
                        Warning sound repeats until the worker leaves.
                      </p>

                    </div>

                  </div>
                </div>
              )}

              {/* ==================================================
                  FACE FAILED WARNING
              ================================================== */}

              {failedFace &&
                !unknownPerson && (
                  <div className={POPUP_POSITION}>
                    <div className="rounded-3xl border border-amber-300 bg-white p-5 shadow-2xl">

                      <div className="text-center">

                        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">

                          <AlertTriangle
                            size={36}
                          />

                        </div>

                        <div className="mt-4 flex items-center justify-center gap-2 text-amber-600">

                          <AlertTriangle
                            size={20}
                          />

                          <span className="text-xs font-black uppercase tracking-wider">
                            Face Verification Failed
                          </span>

                        </div>

                        <h3 className="mt-1 text-2xl font-black text-slate-900">
                          Verification Failed
                        </h3>

                        <p className="mt-2 text-sm text-slate-500">
                          Please position your face clearly in front of the camera.
                        </p>

                        <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white">

                          <Volume2
                            size={15}
                            className="animate-pulse"
                          />

                          FACE WARNING

                        </div>

                      </div>

                    </div>
                  </div>
                )}

              {/* ==================================================
                  VERIFIED POPUP
              ================================================== */}

              {popup?.type === 'verified' && (
                <div className={POPUP_POSITION}>

                  <div className="rounded-3xl border border-emerald-300/40 bg-white/95 p-5 shadow-2xl backdrop-blur">

                    <div className="flex items-center gap-4">

                      {popup.image ? (
                        <img
                          src={popup.image}
                          alt={
                            popup.name ||
                            'Worker'
                          }
                          className="h-16 w-16 rounded-2xl object-cover ring-2 ring-emerald-400"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">

                          <ShieldCheck
                            size={28}
                          />

                        </div>
                      )}

                      <div className="min-w-0">

                        <div className="flex items-center gap-2">

                          <ShieldCheck
                            size={19}
                            className="text-emerald-600"
                          />

                          <p className="text-xs font-black uppercase tracking-wider text-emerald-600">
                            Face Verified
                          </p>

                        </div>

                        <h3 className="mt-1 truncate text-xl font-black text-slate-900">
                          {popup.name ||
                            'Verified Worker'}
                        </h3>

                        {popup.mobile && (
                          <p className="text-sm text-slate-500">
                            {popup.mobile}
                          </p>
                        )}

                      </div>
                    </div>

                    <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-bold text-emerald-700">
                      PPE detection starting...
                    </div>

                  </div>

                </div>
              )}

              {/* ==================================================
                  PPE SUCCESS POPUP
              ================================================== */}

              {popup?.type ===
                'ppe_success' && (
                <div className={POPUP_POSITION}>

                  <div className="rounded-3xl border border-emerald-300 bg-white p-5 shadow-2xl">

                    <div className="text-center">

                      <WorkerAvatar
                        popup={popup}
                        ring="ring-emerald-100"
                        fallbackBg="bg-emerald-100"
                        fallbackText="text-emerald-600"
                        Icon={ShieldCheck}
                      />

                      <div className="mt-4 flex items-center justify-center gap-2 text-emerald-600">

                        <ShieldCheck
                          size={20}
                        />

                        <span className="text-xs font-black uppercase tracking-wider">
                          PPE Compliant
                        </span>

                      </div>

                      <h3 className="mt-1 text-2xl font-black text-slate-900">
                        {popup.name ||
                          'Worker'}
                      </h3>

                      {popup.mobile && (
                        <p className="text-sm text-slate-500">
                          {popup.mobile}
                        </p>
                      )}

                      <div className="mt-4 rounded-2xl bg-emerald-50 p-4">

                        <p className="text-4xl font-black text-emerald-600">
                          100%
                        </p>

                        <p className="mt-1 text-sm font-bold text-emerald-700">
                          All 4 PPE items detected
                        </p>

                      </div>

                      <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white">

                        <Volume2 size={15} />

                        PPE KIT COMPLETE

                      </div>

                    </div>

                  </div>

                </div>
              )}

              {/* ==================================================
                  PPE WARNING POPUP
              ================================================== */}

              {popup?.type ===
                'ppe_warning' && (
                <div className={POPUP_POSITION}>

                  <div className="rounded-3xl border border-rose-300 bg-white p-5 shadow-2xl">

                    <div className="text-center">

                      <WorkerAvatar
                        popup={popup}
                        ring="ring-rose-100"
                        fallbackBg="bg-rose-100"
                        fallbackText="text-rose-600"
                        Icon={AlertTriangle}
                      />

                      <div className="mt-4 flex items-center justify-center gap-2 text-rose-600">

                        <AlertTriangle
                          size={20}
                        />

                        <span className="text-xs font-black uppercase tracking-wider">
                          PPE Warning
                        </span>

                      </div>

                      <h3 className="mt-1 text-2xl font-black text-slate-900">
                        {popup.name ||
                          'Worker'}
                      </h3>

                      {popup.mobile && (
                        <p className="text-sm text-slate-500">
                          {popup.mobile}
                        </p>
                      )}

                      <div className="mt-4 rounded-2xl bg-rose-50 p-4">

                        <p className="text-4xl font-black text-rose-600">
                          {popup.percentage}%
                        </p>

                        <p className="mt-1 text-sm font-bold text-rose-700">
                          {popup.missingCount} of 4 items missing
                        </p>

                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">

                        {PPE_ITEMS.map(
                          ([key, label]) => {
                            const isMissing =
                              popup.missing?.some(
                                (item) =>
                                  String(
                                    item
                                  ).toLowerCase() ===
                                  key.toLowerCase()
                              );

                            return (
                              <div
                                key={key}
                                className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                                  isMissing
                                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                }`}
                              >

                                <div className="flex items-center justify-between">

                                  <span>
                                    {label}
                                  </span>

                                  {isMissing ? (
                                    <XCircle
                                      size={16}
                                    />
                                  ) : (
                                    <ShieldCheck
                                      size={16}
                                    />
                                  )}

                                </div>

                              </div>
                            );
                          }
                        )}

                      </div>

                      <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white">

                        <Volume2
                          size={15}
                          className="animate-pulse"
                        />

                        ⚠ PPE KIT INCOMPLETE

                      </div>

                      <p className="mt-2 text-[11px] font-semibold text-slate-400">
                        Warning sound continues until the worker leaves or all PPE is complete.
                      </p>

                    </div>

                  </div>

                </div>
              )}

            </div>
          </div>

          {/* ==================================================
              RIGHT STATUS PANEL
          ================================================== */}

          <div className="space-y-4">

            {/* ==================================================
                FACE VERIFICATION
            ================================================== */}

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">

              <div className="mb-4 flex items-center justify-between">

                <div>

                  <p className="text-xs font-black uppercase tracking-wider text-slate-400">
                    Step 1
                  </p>

                  <h3 className="mt-1 font-black text-slate-900">
                    Face Verification
                  </h3>

                </div>

                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    verified
                      ? 'bg-emerald-100 text-emerald-600'
                      : 'bg-blue-100 text-blue-600'
                  }`}
                >
                  <ShieldCheck
                    size={20}
                  />
                </div>

              </div>

              <div className="space-y-2">

                {FACE_STEPS.map(
                  (
                    [stepCode, label],
                    index
                  ) => {
                    const active =
                      currentFaceStep ===
                      stepCode;

                    const complete =
                      stepCode ===
                        'FACE_VERIFIED' &&
                      verified;

                    return (
                      <div
                        key={stepCode}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                          complete
                            ? 'border-emerald-200 bg-emerald-50'
                            : active
                            ? 'border-blue-200 bg-blue-50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >

                        <div
                          className={`flex h-7 w-7 items-center justify-center rounded-full ${
                            complete
                              ? 'bg-emerald-600 text-white'
                              : active
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {complete ? (
                            <ShieldCheck
                              size={14}
                            />
                          ) : (
                            <span className="text-xs font-black">
                              {index + 1}
                            </span>
                          )}
                        </div>

                        <span
                          className={`text-xs font-bold ${
                            complete
                              ? 'text-emerald-700'
                              : active
                              ? 'text-blue-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {label}
                        </span>

                        {active &&
                          !complete && (
                            <span className="ml-auto">
                              <Spinner />
                            </span>
                          )}

                      </div>
                    );
                  }
                )}

              </div>
            </div>

            {/* ==================================================
                WORKER INFORMATION
            ================================================== */}

            <div className="rounded-2xl border border-slate-200 bg-white p-4">

              <div className="mb-4 flex items-center justify-between">

                <h3 className="font-black text-slate-900">
                  Worker Information
                </h3>

                {verified && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-600">
                    Verified
                  </span>
                )}

              </div>

              {person ? (
                <div className="flex items-center gap-3">

                  {person.image ? (
                    <img
                      src={person.image}
                      alt={
                        person.name ||
                        'Worker'
                      }
                      className="h-14 w-14 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-50 text-blue-600">

                      <ShieldCheck
                        size={22}
                      />

                    </div>
                  )}

                  <div className="min-w-0">

                    <p className="truncate font-black text-slate-900">
                      {person.name ||
                        'Unknown Worker'}
                    </p>

                    {person.mobile && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {person.mobile}
                      </p>
                    )}

                    {person.code && (
                      <p className="mt-0.5 text-[11px] font-bold text-blue-600">
                        ID: {person.code}
                      </p>
                    )}

                  </div>

                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 p-4 text-center">

                  <p className="text-sm font-bold text-slate-500">
                    Awaiting worker verification
                  </p>

                  <p className="mt-1 text-xs text-slate-400">
                    Stand in front of the camera.
                  </p>

                </div>
              )}

            </div>

            {/* ==================================================
                PPE STATUS
            ================================================== */}

            <div className="rounded-2xl border border-slate-200 bg-white p-4">

              <div className="mb-4 flex items-center justify-between">

                <div>

                  <p className="text-xs font-black uppercase tracking-wider text-slate-400">
                    Step 2
                  </p>

                  <h3 className="mt-1 font-black text-slate-900">
                    PPE Compliance
                  </h3>

                </div>

                <div
                  className={`rounded-xl px-3 py-2 text-lg font-black ${
                    pct === 100
                      ? 'bg-emerald-50 text-emerald-600'
                      : pct > 0
                      ? 'bg-amber-50 text-amber-600'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {pct}%
                </div>

              </div>

              <div className="space-y-2">

                {PPE_ITEMS.map(
                  ([key, label]) => {
                    const status =
                      itemState(key);

                    const present =
                      status ===
                      'present';

                    const absent =
                      status ===
                      'absent';

                    return (
                      <div
                        key={key}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
                          present
                            ? 'border-emerald-200 bg-emerald-50'
                            : absent
                            ? 'border-rose-200 bg-rose-50'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >

                        <span
                          className={`text-sm font-bold ${
                            present
                              ? 'text-emerald-700'
                              : absent
                              ? 'text-rose-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {label}
                        </span>

                        {present ? (
                          <ShieldCheck
                            size={18}
                            className="text-emerald-600"
                          />
                        ) : absent ? (
                          <XCircle
                            size={18}
                            className="text-rose-600"
                          />
                        ) : (
                          <span className="text-xs font-bold text-slate-400">
                            —
                          </span>
                        )}

                      </div>
                    );
                  }
                )}

              </div>

              <div className="mt-4">

                <div className="mb-2 flex items-center justify-between">

                  <span className="text-xs font-bold text-slate-500">
                    PPE Progress
                  </span>

                  <span className="text-xs font-black text-slate-700">
                    {presentCount}/4
                  </span>

                </div>

                <div className="h-2 overflow-hidden rounded-full bg-slate-100">

                  <div
                    className={`h-full rounded-full transition-all ${
                      pct === 100
                        ? 'bg-emerald-500'
                        : 'bg-blue-600'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          pct
                        )
                      )}%`,
                    }}
                  />

                </div>

              </div>

            </div>

            {/* ==================================================
                MISSING PPE
            ================================================== */}

            {missing.length > 0 && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">

                <div className="flex items-center gap-2 text-rose-700">

                  <AlertTriangle
                    size={18}
                  />

                  <h3 className="font-black">
                    Missing PPE
                  </h3>

                </div>

                <div className="mt-3 flex flex-wrap gap-2">

                  {missing.map(
                    (item) => (
                      <span
                        key={item}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-rose-600 ring-1 ring-rose-200"
                      >
                        {item}
                      </span>
                    )
                  )}

                </div>

              </div>
            )}

            {/* ==================================================
                EMAIL ALERT
            ================================================== */}

            {emailMessage && (
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold">

                <span
                  className={
                    emailMessage.tone
                  }
                >
                  {emailMessage.text}
                </span>

              </div>
            )}

          </div>
        </div>

        {/* ======================================================
            FOOTER
        ====================================================== */}

        <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

            <div className="flex items-center gap-3">

              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  running
                    ? 'animate-pulse bg-emerald-500'
                    : 'bg-slate-400'
                }`}
              />

              <div>

                <p className="text-sm font-bold text-slate-700">

                  {running
                    ? verified
                      ? !facePresent
                        ? 'Worker left — ready for next person'
                        : result?.ppe
                        ? pct === 100
                          ? 'PPE complete'
                          : 'PPE warning active'
                        : 'Face verified — detecting PPE'
                      : unknownPerson
                      ? 'Unknown worker detected — warning active'
                      : 'Scanning for worker...'
                    : 'Camera stopped'}

                </p>

                {running &&
                  !verified &&
                  view?.isLast && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Waiting for the next worker to enter the camera view.
                    </p>
                  )}

              </div>
            </div>

            {/* NEXT PERSON */}

            {running &&
              state?.waiting_for_exit && (
                <button
                  type="button"
                  onClick={
                    handleNextPerson
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-xs font-black text-blue-600 transition hover:bg-blue-50"
                >
                  <SkipForward
                    size={16}
                  />

                  Next Person
                </button>
              )}

          </div>

        </div>
      </div>
    </div>
  );
}