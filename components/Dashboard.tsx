'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldAlert,
  Activity,
  Eye,
  Camera,
  RotateCcw,
  Volume2,
  VolumeX,
  Radio,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  Crosshair,
  Sliders,
  Download,
  Trash2,
  AlertOctagon,
  Sparkles,
  Info,
  Layers,
  Code,
} from 'lucide-react';
import { useMediaPipe, GazeDirection, SeverityLevel } from '../hooks/useMediaPipe';

export default function Dashboard() {
  const {
    videoRef,
    canvasRef,
    isModelLoading,
    modelLoadingText,
    cameraActive,
    fps,
    postureMetrics,
    gazeMetrics,
    antiCheating,
    ergonomics,
    auditLog,
    showSkeleton,
    showFaceMesh,
    showHudOverlays,
    setShowSkeleton,
    setShowFaceMesh,
    setShowHudOverlays,
    startCamera,
    stopCamera,
    calibrate,
    dismissPostureAlert,
    dismissProctorAlert,
    clearAuditLog,
    logAuditEvent,
  } = useMediaPipe();

  // Audio voice alert state
  const [audioMuted, setAudioMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeVoicePrompt, setActiveVoicePrompt] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Gemini AI Voice Alert handler
  const triggerVoiceAlert = useCallback(
    async (type: 'POSTURE_COLLAPSE' | 'PROCTOR_VIOLATION') => {
      if (audioMuted) return;

      try {
        setIsSpeaking(true);
        const res = await fetch('/api/voice-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            metrics: {
              postureScore: postureMetrics.postureScore,
              headTilt: postureMetrics.headTilt,
              spineLean: postureMetrics.spineLean,
              gazeDirection: gazeMetrics.direction,
              cheatingRisk: antiCheating.cheatingRiskIndex,
              badPostureDuration: ergonomics.badPostureDuration,
            },
          }),
        });

        const contentType = res.headers.get('content-type') || '';

        // If ElevenLabs returned MP3 audio stream
        if (res.ok && contentType.includes('audio')) {
          const coachingHeader = res.headers.get('X-Coaching-Text');
          if (coachingHeader) {
            setActiveVoicePrompt(decodeURIComponent(coachingHeader));
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          if (audioPlayerRef.current) {
            audioPlayerRef.current.src = url;
            await audioPlayerRef.current.play();
            audioPlayerRef.current.onended = () => {
              setIsSpeaking(false);
              URL.revokeObjectURL(url);
            };
          }
        } else {
          // JSON response with text fallback
          const data = await res.json().catch(() => ({}));
          const text =
            data.text ||
            (type === 'POSTURE_COLLAPSE'
              ? 'Critical posture collapse detected. Re-align your spine, level your shoulders, and draw your chin back.'
              : 'Proctor warning: Suspicious gaze deflection detected away from center screen. Refocus your eyes on the exam immediately.');

          setActiveVoicePrompt(text);

          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.05;
            utterance.pitch = 1.0;
            utterance.onend = () => setIsSpeaking(false);
            utterance.onerror = () => setIsSpeaking(false);
            window.speechSynthesis.speak(utterance);
          } else {
            setIsSpeaking(false);
          }
        }
      } catch (err) {
        console.error('Failed to trigger voice alert:', err);
        setIsSpeaking(false);
      }
    },
    [audioMuted, postureMetrics, gazeMetrics, antiCheating, ergonomics]
  );

  // Trigger voice coaching automatically on 30s Posture Collapse
  const lastCollapseAlertRef = useRef<number>(0);
  useEffect(() => {
    if (ergonomics.isPostureCollapsed && Date.now() - lastCollapseAlertRef.current > 15000) {
      lastCollapseAlertRef.current = Date.now();
      triggerVoiceAlert('POSTURE_COLLAPSE');
    }
  }, [ergonomics.isPostureCollapsed, triggerVoiceAlert]);

  // Trigger voice coaching on 3s Proctor Violation
  const lastProctorAlertRef = useRef<number>(0);
  useEffect(() => {
    if (antiCheating.isViolating && Date.now() - lastProctorAlertRef.current > 8000) {
      lastProctorAlertRef.current = Date.now();
      triggerVoiceAlert('PROCTOR_VIOLATION');
    }
  }, [antiCheating.isViolating, triggerVoiceAlert]);

  // Export Audit Log (CSV)
  const exportCsv = () => {
    if (auditLog.length === 0) return;
    const headers = 'ID,Timestamp,Code,Severity,Title,Details,Duration(s),StructuredJSON\n';
    const rows = auditLog
      .map(
        (log) =>
          `"${log.id}","${log.timestamp}","${log.code}","${log.severity}","${log.title.replace(
            /"/g,
            '""'
          )}","${log.details.replace(/"/g, '""')}",${log.durationSec},"${
            log.structuredJson ? JSON.stringify(log.structuredJson).replace(/"/g, '""') : ''
          }"`
      )
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `proctor_audit_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export Audit Log (JSON)
  const exportJson = () => {
    if (auditLog.length === 0) return;
    const blob = new Blob([JSON.stringify(auditLog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `proctor_audit_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Color helpers
  const getGazeColor = (g: GazeDirection) => {
    switch (g) {
      case 'CENTER':
        return 'text-emerald-400 border-emerald-500/40 bg-emerald-950/30';
      case 'DOWN':
      case 'LOOKING_DOWN':
        return 'text-rose-400 border-rose-500/50 bg-rose-950/40 animate-pulse';
      case 'LEFT':
      case 'RIGHT':
      case 'LOOKING_LEFT':
      case 'LOOKING_RIGHT':
      case 'UP':
        return 'text-amber-400 border-amber-500/40 bg-amber-950/30';
      case 'AWAY':
      default:
        return 'text-red-500 border-red-500/60 bg-red-950/50 animate-pulse';
    }
  };

  const getRiskColor = (score: number) => {
    if (score < 35) return 'text-emerald-400 bg-emerald-500';
    if (score < 70) return 'text-amber-400 bg-amber-500';
    return 'text-rose-400 bg-rose-500 animate-pulse';
  };

  return (
    <div className="min-h-screen bg-[#06090e] text-slate-100 font-mono select-none antialiased flex flex-col p-3 md:p-6 relative overflow-x-hidden">
      {/* Hidden Audio Tag for ElevenLabs voice */}
      <audio ref={audioPlayerRef} className="hidden" />

      {/* Cyberpunk Grid Background Overlay */}
      <div
        className="fixed inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(to right, #112233 1px, transparent 1px), linear-gradient(to bottom, #112233 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* ── Top Header / Status Bar ─────────────────────────────────────────── */}
      <header className="relative z-10 flex flex-wrap items-center justify-between border-b border-cyan-500/30 bg-[#0a0f18]/90 backdrop-blur-md px-4 py-3 rounded-t-xl mb-4 shadow-[0_0_20px_rgba(0,240,255,0.08)]">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-400 shadow-[0_0_12px_rgba(0,240,255,0.4)]">
            <Crosshair className="w-6 h-6 text-cyan-400 animate-spin-slow" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg md:text-xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-emerald-400 to-amber-300">
                PROCTOR_AI // NEURAL HUD
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 uppercase font-bold tracking-widest">
                WASM 0ms
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Continuous Ergonomic Posture Engine & High-Sensitivity Anti-Cheating Gaze Sentry
            </p>
          </div>
        </div>

        {/* Engine status indicators */}
        <div className="flex items-center gap-3 mt-2 sm:mt-0 text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0d1522] border border-slate-700/60">
            <span
              className={`w-2 h-2 rounded-full ${
                cameraActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'
              }`}
            />
            <span className="text-slate-300 font-semibold">
              {cameraActive ? `CAM ACTIVE (${fps} FPS)` : 'CAM STANDBY'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0d1522] border border-slate-700/60">
            <Radio
              className={`w-3.5 h-3.5 ${
                isSpeaking ? 'text-amber-400 animate-pulse' : 'text-slate-400'
              }`}
            />
            <span className="text-slate-300">
              VOICE:{' '}
              <strong className={isSpeaking ? 'text-amber-300' : 'text-slate-400'}>
                {isSpeaking ? 'TRANSMITTING' : 'READY'}
              </strong>
            </span>
          </div>

          <button
            onClick={() => setAudioMuted(!audioMuted)}
            className={`p-1.5 rounded border transition ${
              audioMuted
                ? 'bg-rose-950/60 border-rose-500/50 text-rose-300'
                : 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/60'
            }`}
            title={audioMuted ? 'Unmute Audio Voice Coach' : 'Mute Voice Coach'}
          >
            {audioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ── Main HUD Grid Layout ────────────────────────────────────────────── */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
        {/* LEFT COLUMN: Live Viewport & Overlays (7 cols on desktop) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Webcam Viewport Card */}
          <div className="relative bg-[#090d16] border-2 border-cyan-500/40 rounded-xl overflow-hidden shadow-[0_0_25px_rgba(0,240,255,0.12)]">
            {/* Viewport Header */}
            <div className="flex items-center justify-between px-3.5 py-2 bg-[#0d131f] border-b border-cyan-500/30 text-xs">
              <div className="flex items-center gap-2 text-cyan-400 font-bold">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span>PRIMARY OPTICAL FEED: [CHANNEL_01]</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="text-emerald-400 font-semibold">
                  33 POSE // 468+10 IRIS FACEMESH
                </span>
                <span className="px-1.5 py-0.5 rounded bg-black/60 border border-slate-700">
                  720P
                </span>
              </div>
            </div>

            {/* Video + Canvas Stage */}
            <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover transform -scale-x-100"
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-cover transform -scale-x-100 pointer-events-none"
              />

              {/* Offline / Standby State */}
              {!cameraActive && !isModelLoading && (
                <div className="relative z-20 flex flex-col items-center justify-center p-6 text-center max-w-md">
                  <div className="w-16 h-16 rounded-full bg-cyan-950/60 border-2 border-cyan-400/80 flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(0,240,255,0.3)]">
                    <Camera className="w-8 h-8 text-cyan-400 animate-pulse" />
                  </div>
                  <h3 className="text-base font-bold text-cyan-300 tracking-wide mb-1">
                    OPTICAL SURVEILLANCE FEED OFFLINE
                  </h3>
                  <p className="text-xs text-slate-400 mb-5 leading-relaxed">
                    Activate the neural pipeline to initiate 30-Second Ergonomic Posture Monitoring and 3-Second Anti-Cheating Gaze Sentry with baseline calibration.
                  </p>
                  <button
                    onClick={startCamera}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm tracking-wider uppercase bg-gradient-to-r from-cyan-500 to-emerald-500 text-black shadow-[0_0_20px_rgba(0,240,255,0.4)] hover:brightness-110 active:scale-95 transition"
                  >
                    <Zap className="w-4 h-4 fill-current" />
                    Engage Neural Feeds
                  </button>
                </div>
              )}

              {/* Model Loading State */}
              {isModelLoading && (
                <div className="relative z-20 flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mb-3" />
                  <p className="text-sm font-bold text-cyan-300 animate-pulse tracking-wider">
                    {modelLoadingText}
                  </p>
                  <span className="text-xs text-slate-400 mt-1">
                    Compiling WebAssembly BlazePose & Iris FaceMesh Shaders...
                  </span>
                </div>
              )}

              {/* Scanline CRT overlay effect */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/5 to-transparent opacity-40 bg-[length:100%_4px]" />

              {/* HUD Corner Accents */}
              <div className="pointer-events-none absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-cyan-400" />
              <div className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-cyan-400" />
              <div className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-cyan-400" />
              <div className="pointer-events-none absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-cyan-400" />

              {/* Live Status Watermark on Viewport */}
              {cameraActive && (
                <div className="absolute top-4 left-4 z-10 flex flex-col gap-1.5 pointer-events-none">
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-black/75 border border-cyan-500/40 backdrop-blur-sm text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-cyan-300 font-bold">STATUS: SENTRY_ENGAGED</span>
                  </div>
                  <div className="px-2.5 py-1 rounded bg-black/75 border border-slate-700/80 backdrop-blur-sm text-[10px] text-slate-300">
                    GAZE: <span className="font-bold text-amber-300">{gazeMetrics.direction}</span> | DEVIATION:{' '}
                    <span
                      className={
                        gazeMetrics.thresholdExceeded
                          ? 'text-rose-400 font-bold'
                          : 'text-emerald-400'
                      }
                    >
                      H:{Math.round(gazeMetrics.horizontalDeviation * 100)}% V:{Math.round(gazeMetrics.verticalDeviation * 100)}%
                    </span>
                  </div>
                </div>
              )}

              {/* Speaking Banner on Viewport */}
              {isSpeaking && activeVoicePrompt && (
                <div className="absolute bottom-4 inset-x-4 z-10 bg-black/85 border border-amber-400/80 rounded-lg p-2.5 backdrop-blur-md flex items-center gap-3 shadow-[0_0_15px_rgba(255,184,0,0.3)] animate-pulse">
                  <Volume2 className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div className="text-xs text-amber-200 line-clamp-2">
                    <strong className="text-amber-400 uppercase tracking-wider mr-1">
                      [VOICE SENTRY]:
                    </strong>
                    {activeVoicePrompt}
                  </div>
                </div>
              )}
            </div>

            {/* Viewport Control Bar */}
            <div className="p-3 bg-[#0a0e17] border-t border-cyan-500/30 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {cameraActive ? (
                  <button
                    onClick={stopCamera}
                    className="px-3 py-1.5 rounded bg-rose-950/70 border border-rose-500/60 text-rose-300 font-bold hover:bg-rose-900/60 transition"
                  >
                    Halt Camera
                  </button>
                ) : (
                  <button
                    onClick={startCamera}
                    disabled={isModelLoading}
                    className="px-3 py-1.5 rounded bg-emerald-950/70 border border-emerald-500/60 text-emerald-300 font-bold hover:bg-emerald-900/60 transition"
                  >
                    Engage Camera
                  </button>
                )}

                <button
                  onClick={calibrate}
                  disabled={!cameraActive}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded border font-bold transition ${
                    postureMetrics.isCalibrated
                      ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900/60'
                      : 'bg-amber-950/60 border-amber-500/60 text-amber-300 hover:bg-amber-900/60'
                  } disabled:opacity-40`}
                  title="Capture current sitting posture as good baseline (+/-3° tolerance zone)"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {postureMetrics.isCalibrated ? 'Recalibrate Baseline' : 'Calibrate Baseline'}
                </button>

                <button
                  onClick={() => triggerVoiceAlert('POSTURE_COLLAPSE')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-900/60 transition"
                  title="Test Gemini + ElevenLabs voice guidance"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Test AI Voice
                </button>
              </div>

              {/* View Overlays Toggles */}
              <div className="flex items-center gap-1 bg-[#06080d] p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setShowSkeleton(!showSkeleton)}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition ${
                    showSkeleton
                      ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                      : 'text-slate-500'
                  }`}
                >
                  Skeleton
                </button>
                <button
                  onClick={() => setShowFaceMesh(!showFaceMesh)}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition ${
                    showFaceMesh
                      ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                      : 'text-slate-500'
                  }`}
                >
                  FaceMesh
                </button>
                <button
                  onClick={() => setShowHudOverlays(!showHudOverlays)}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition ${
                    showHudOverlays
                      ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                      : 'text-slate-500'
                  }`}
                >
                  Reticles
                </button>
              </div>
            </div>
          </div>

          {/* ── Real-Time Proctoring Audit Log Table ─────────────────────────── */}
          <div className="bg-[#090d16] border border-cyan-500/30 rounded-xl overflow-hidden flex flex-col flex-1 shadow-lg">
            <div className="px-3.5 py-2.5 bg-[#0d131f] border-b border-cyan-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-400">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <span>PROCTORING AUDIT LOG & STRUCTURED TELEMETRY</span>
                <span className="px-1.5 py-0.2 rounded bg-cyan-950 border border-cyan-500/40 text-[10px] text-cyan-300">
                  {auditLog.length} EVENTS
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={exportCsv}
                  disabled={auditLog.length === 0}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[#111927] border border-slate-700 text-slate-300 hover:text-cyan-300 text-[10px] disabled:opacity-40 transition"
                  title="Export to CSV"
                >
                  <Download className="w-3 h-3" /> CSV
                </button>
                <button
                  onClick={exportJson}
                  disabled={auditLog.length === 0}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[#111927] border border-slate-700 text-slate-300 hover:text-cyan-300 text-[10px] disabled:opacity-40 transition"
                  title="Export to JSON"
                >
                  <Download className="w-3 h-3" /> JSON
                </button>
                <button
                  onClick={clearAuditLog}
                  disabled={auditLog.length === 0}
                  className="p-1 rounded bg-[#111927] border border-slate-700 text-slate-400 hover:text-rose-400 disabled:opacity-40 transition"
                  title="Clear Log History"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-56 min-h-36 overflow-y-auto divide-y divide-slate-800/80 text-xs">
              {auditLog.length === 0 ? (
                <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500/40 mb-2" />
                  <span>No security infractions or posture collapses recorded. Feed nominal.</span>
                </div>
              ) : (
                auditLog.map((item) => (
                  <div
                    key={item.id}
                    className="px-3 py-2 flex flex-col gap-1.5 hover:bg-cyan-950/20 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                            item.severity === 'CRITICAL'
                              ? 'bg-rose-950 text-rose-300 border border-rose-500/60 animate-pulse'
                              : item.severity === 'MEDIUM'
                              ? 'bg-amber-950 text-amber-300 border border-amber-500/50'
                              : 'bg-slate-900 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {item.code}
                        </span>
                        <div>
                          <div className="text-slate-200 font-semibold">{item.title}</div>
                          <div className="text-[11px] text-slate-400">{item.details}</div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[11px] text-cyan-400 font-mono">{item.timestamp}</div>
                        {item.durationSec > 0 && (
                          <div className="text-[10px] text-slate-500">
                            {item.durationSec}s active
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Structured JSON Log display if present */}
                    {item.structuredJson && (
                      <div className="bg-[#05080e] border border-cyan-500/20 rounded p-1.5 text-[10px] font-mono text-cyan-300 overflow-x-auto flex items-center gap-2">
                        <Code className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                        <span>
                          {JSON.stringify({
                            isCheating: item.structuredJson.isCheating,
                            direction: item.structuredJson.direction,
                            confidence: item.structuredJson.confidence,
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Telemetry Matrix HUD (5 cols on desktop) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Sentry Rule Status Counters */}
          <div className="grid grid-cols-2 gap-3">
            {/* 30-Second Posture Collapse Sentry Gauge */}
            <div
              className={`p-3.5 rounded-xl border transition-all ${
                ergonomics.isPostureCollapsed
                  ? 'bg-rose-950/50 border-rose-500 shadow-[0_0_20px_rgba(255,34,68,0.3)] animate-pulse'
                  : ergonomics.badPostureDuration > 0
                  ? 'bg-amber-950/30 border-amber-500/50'
                  : 'bg-[#0a0f19] border-cyan-500/30'
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400 font-semibold uppercase tracking-wider">
                  30s Posture Collapse
                </span>
                <span
                  className={`font-black ${
                    ergonomics.badPostureDuration > 15
                      ? 'text-rose-400'
                      : ergonomics.badPostureDuration > 0
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {ergonomics.badPostureDuration}s / 30s
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800 mb-2">
                <div
                  className={`h-full transition-all duration-200 ${
                    ergonomics.badPostureDuration >= 30
                      ? 'bg-rose-500 shadow-[0_0_10px_#ff2244]'
                      : ergonomics.badPostureDuration > 15
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{
                    width: `${Math.min(100, (ergonomics.badPostureDuration / 30) * 100)}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Rule: Score &lt; 60% continuous</span>
                <span className="font-bold text-slate-300">
                  Collapses: {ergonomics.totalCollapses}
                </span>
              </div>
            </div>

            {/* 3-Second Anti-Cheating Gaze Sentry Gauge */}
            <div
              className={`p-3.5 rounded-xl border transition-all ${
                antiCheating.isViolating
                  ? 'bg-rose-950/50 border-rose-500 shadow-[0_0_20px_rgba(255,34,68,0.3)] animate-pulse'
                  : antiCheating.suspiciousDuration > 0
                  ? 'bg-amber-950/30 border-amber-500/50'
                  : 'bg-[#0a0f19] border-cyan-500/30'
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400 font-semibold uppercase tracking-wider">
                  3s Gaze Sentry
                </span>
                <span
                  className={`font-black ${
                    antiCheating.suspiciousDuration >= 2.0
                      ? 'text-rose-400'
                      : antiCheating.suspiciousDuration > 0
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {antiCheating.suspiciousDuration}s / 3.0s
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800 mb-2">
                <div
                  className={`h-full transition-all duration-200 ${
                    antiCheating.suspiciousDuration >= 3.0
                      ? 'bg-rose-500 shadow-[0_0_10px_#ff2244]'
                      : antiCheating.suspiciousDuration >= 1.5
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{
                    width: `${Math.min(100, (antiCheating.suspiciousDuration / 3.0) * 100)}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Rule: Pupil dev &gt; 15% for 3s</span>
                <span className="font-bold text-slate-300">
                  Infractions: {antiCheating.totalViolations}
                </span>
              </div>
            </div>
          </div>

          {/* ── Primary Telemetry Matrix Cards ─────────────────────────────── */}
          <div className="bg-[#090d16] border border-cyan-500/30 rounded-xl p-4 shadow-[0_0_20px_rgba(0,240,255,0.06)] flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-400">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span>BIOMECHANICAL & IRIS GAZE MATRIX</span>
              </div>
              <span className="text-[10px] text-slate-500 uppercase">
                {postureMetrics.isCalibrated ? 'CALIBRATED' : 'DEFAULT BASELINE'}
              </span>
            </div>

            {/* 1. Ergonomic Posture Score (Calibrated with +/- 3° Deadband) */}
            <div className="bg-[#0c121e] border border-slate-800 p-3.5 rounded-lg flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400 font-semibold mb-0.5">
                    POSTURE HEALTH SCORE
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-3xl font-black ${
                        postureMetrics.postureScore >= 85
                          ? 'text-emerald-400'
                          : postureMetrics.postureScore >= 60
                          ? 'text-amber-400'
                          : 'text-rose-500 animate-pulse'
                      }`}
                    >
                      {postureMetrics.postureScore}%
                    </span>
                    <span
                      className={`text-[10px] font-black px-2 py-0.5 rounded uppercase border ${
                        postureMetrics.status === 'OPTIMAL'
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-500/40'
                          : postureMetrics.status === 'COMPROMISED'
                          ? 'bg-amber-950 text-amber-400 border-amber-500/40'
                          : 'bg-rose-950 text-rose-400 border-rose-500/60 animate-pulse'
                      }`}
                    >
                      {postureMetrics.status}
                    </span>
                  </div>
                </div>

                {/* Visual Ring Gauge */}
                <div className="w-14 h-14 relative flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="28"
                      cy="28"
                      r="22"
                      stroke="#1e293b"
                      strokeWidth="4"
                      fill="transparent"
                    />
                    <circle
                      cx="28"
                      cy="28"
                      r="22"
                      stroke={
                        postureMetrics.postureScore >= 85
                          ? '#00FF66'
                          : postureMetrics.postureScore >= 60
                          ? '#FFB800'
                          : '#FF2244'
                      }
                      strokeWidth="4"
                      strokeDasharray={138}
                      strokeDashoffset={138 - (138 * postureMetrics.postureScore) / 100}
                      strokeLinecap="round"
                      fill="transparent"
                    />
                  </svg>
                  <span className="absolute text-xs font-bold text-slate-300">
                    {postureMetrics.postureScore}
                  </span>
                </div>
              </div>

              {/* Calibration & Tolerance Zone Status */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[10px]">
                <span className="text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  Tolerance: <strong className="text-emerald-300">+/- 3° Deadband</strong>
                </span>
                <span className="text-slate-400">
                  Deductions: Head -{postureMetrics.deductions.headTilt} | Spine -{postureMetrics.deductions.spineLean} | Shldr -{postureMetrics.deductions.shoulderBalance}
                </span>
              </div>
            </div>

            {/* 2. Lateral Spine Lean & Head Tilt Angles */}
            <div className="grid grid-cols-2 gap-3">
              {/* Lateral Spine Lean */}
              <div
                className={`p-3 rounded-lg border transition ${
                  postureMetrics.spineLean > 8
                    ? 'bg-rose-950/40 border-rose-500/70 shadow-[0_0_15px_rgba(255,34,68,0.2)]'
                    : 'bg-[#0c121e] border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>SPINE LEAN</span>
                  <span className="text-[10px] text-amber-400 font-bold">&gt;8° WARN</span>
                </div>
                <div className="text-2xl font-black text-slate-100 flex items-baseline gap-1">
                  <span
                    className={
                      postureMetrics.spineLean > 8 ? 'text-rose-400' : 'text-slate-100'
                    }
                  >
                    {postureMetrics.spineLean}°
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {postureMetrics.spineLean > 8 ? (
                    <span className="text-rose-400 font-bold">LATERAL LEAN DETECTED</span>
                  ) : (
                    <span className="text-emerald-400">Vertical Alignment OK</span>
                  )}
                </div>
              </div>

              {/* Head Tilt */}
              <div
                className={`p-3 rounded-lg border transition ${
                  postureMetrics.headTilt > 10
                    ? 'bg-amber-950/40 border-amber-500/70'
                    : 'bg-[#0c121e] border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>HEAD TILT</span>
                  <span className="text-[10px] text-amber-400 font-bold">&gt;10° WARN</span>
                </div>
                <div className="text-2xl font-black text-slate-100 flex items-baseline gap-1">
                  <span
                    className={
                      postureMetrics.headTilt > 10 ? 'text-amber-400' : 'text-slate-100'
                    }
                  >
                    {postureMetrics.headTilt}°
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {postureMetrics.headTilt > 10 ? (
                    <span className="text-amber-400 font-bold">Lateral Cranial Angle</span>
                  ) : (
                    <span className="text-emerald-400">Horizontal Level OK</span>
                  )}
                </div>
              </div>
            </div>

            {/* 3. High-Sensitivity Eye Gaze & Pupil Deviation Vector */}
            <div className="p-3.5 rounded-lg bg-[#0c121e] border border-slate-800 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  <span>IRIS & PUPIL GAZE SENTRY</span>
                </div>
                <span
                  className={`text-xs font-black px-2.5 py-1 rounded border uppercase tracking-wide ${getGazeColor(
                    gazeMetrics.direction
                  )}`}
                >
                  {gazeMetrics.direction === 'DOWN'
                    ? 'LOOKING DOWN // PHONE/NOTES'
                    : gazeMetrics.direction}
                </span>
              </div>

              {/* Pupil Ratios & 15% Threshold Meter */}
              <div className="grid grid-cols-2 gap-2 text-xs bg-black/40 p-2.5 rounded border border-slate-800/80">
                <div>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                    <span>HORIZONTAL RATIO</span>
                    <span
                      className={
                        Math.abs(gazeMetrics.horizontalDeviation) > 0.15
                          ? 'text-rose-400 font-bold'
                          : 'text-emerald-400'
                      }
                    >
                      {Math.round(gazeMetrics.horizontalDeviation * 100)}% DEV
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        Math.abs(gazeMetrics.horizontalDeviation) > 0.15
                          ? 'bg-rose-500'
                          : 'bg-cyan-400'
                      }`}
                      style={{
                        width: `${Math.min(100, Math.abs(gazeMetrics.horizontalDeviation) * 200)}%`,
                      }}
                    />
                  </div>
                  <span className="text-slate-300 text-[11px] font-bold mt-1 block">
                    Ratio: {gazeMetrics.irisXRatio.toFixed(2)} (Yaw: {gazeMetrics.headYaw}°)
                  </span>
                </div>

                <div>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                    <span>VERTICAL RATIO</span>
                    <span
                      className={
                        Math.abs(gazeMetrics.verticalDeviation) > 0.15
                          ? 'text-rose-400 font-bold'
                          : 'text-emerald-400'
                      }
                    >
                      {Math.round(gazeMetrics.verticalDeviation * 100)}% DEV
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        Math.abs(gazeMetrics.verticalDeviation) > 0.15
                          ? 'bg-rose-500'
                          : 'bg-emerald-400'
                      }`}
                      style={{
                        width: `${Math.min(100, Math.abs(gazeMetrics.verticalDeviation) * 200)}%`,
                      }}
                    />
                  </div>
                  <span className="text-slate-300 text-[11px] font-bold mt-1 block">
                    Ratio: {gazeMetrics.irisYRatio.toFixed(2)} (Pitch: {gazeMetrics.headPitch}°)
                  </span>
                </div>
              </div>

              {/* Cheating Risk Index Bar */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400 font-semibold">CHEATING RISK INDEX</span>
                  <span className={`font-black ${getRiskColor(antiCheating.cheatingRiskIndex)}`}>
                    {antiCheating.cheatingRiskIndex}%
                  </span>
                </div>
                <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      antiCheating.cheatingRiskIndex >= 70
                        ? 'bg-rose-500 shadow-[0_0_12px_#ff2244]'
                        : antiCheating.cheatingRiskIndex >= 35
                        ? 'bg-amber-400 shadow-[0_0_10px_#ffb800]'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${antiCheating.cheatingRiskIndex}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Slouching & Ergonomic Diagnosis Quick Readout */}
            <div className="p-3 bg-[#080c14] rounded-lg border border-slate-800 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span className="text-slate-300">Forward Head Crane:</span>
              </div>
              <span
                className={`font-bold ${
                  postureMetrics.slouching ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {postureMetrics.slouching ? 'DETECTED // SLOUCHING' : 'NOMINAL'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          FULL-SCREEN VISUAL ALERT OVERLAYS (CRITICAL TRIGGERS)
         ═══════════════════════════════════════════════════════════════════════ */}

      {/* ── MODAL 1: Critical Posture Collapse (30 Seconds Trigger) ─────────── */}
      {ergonomics.isPostureCollapsed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg bg-[#0c0507] border-2 border-rose-500 rounded-2xl p-6 md:p-8 shadow-[0_0_50px_rgba(255,34,68,0.5)] flex flex-col items-center text-center">
            {/* Pulsing Hazard Icon */}
            <div className="w-20 h-20 rounded-full bg-rose-950/80 border-2 border-rose-500 flex items-center justify-center mb-5 animate-bounce shadow-[0_0_30px_rgba(255,34,68,0.6)]">
              <AlertOctagon className="w-10 h-10 text-rose-500" />
            </div>

            <div className="px-3 py-1 rounded bg-rose-950/80 border border-rose-500/80 text-rose-300 text-xs font-black uppercase tracking-widest mb-2">
              BIOMECHANICAL HAZARD TRIGGER
            </div>

            <h2 className="text-2xl md:text-3xl font-black text-rose-400 tracking-wider mb-2">
              CRITICAL POSTURE COLLAPSE
            </h2>

            <p className="text-sm text-slate-300 mb-5 leading-relaxed">
              Sub-optimal ergonomic posture (Score: <strong>{postureMetrics.postureScore}%</strong>) has been sustained continuously for <strong>30 SECONDS</strong>.
              Lateral spine lean is at <strong>{postureMetrics.spineLean}°</strong> and head tilt is at <strong>{postureMetrics.headTilt}°</strong>.
            </p>

            {/* AI Coaching Speech Box */}
            <div className="w-full bg-[#160a0f] border border-rose-500/50 rounded-xl p-4 mb-6 text-left">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-400 mb-1">
                <Volume2 className="w-4 h-4 text-rose-400 animate-pulse" />
                <span>GEMINI FLASH // ELEVENLABS AI VOICE COACH</span>
              </div>
              <p className="text-xs md:text-sm text-rose-200 font-mono italic">
                &ldquo;{activeVoicePrompt || 'Sit upright immediately, push your shoulders back and align your cervical spine to avoid chronic musculoskeletal fatigue.'}&rdquo;
              </p>
            </div>

            <button
              onClick={dismissPostureAlert}
              className="w-full py-3.5 px-6 rounded-xl font-black text-sm tracking-wider uppercase bg-rose-500 text-black hover:bg-rose-400 active:scale-95 transition shadow-[0_0_25px_rgba(255,34,68,0.5)]"
            >
              Acknowledge & Correct Posture
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL 2: Proctor Warning: Suspicious Activity Detected (3s Gaze) ── */}
      {antiCheating.isViolating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-red-950/85 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg bg-[#0e0204] border-4 border-red-500 rounded-2xl p-6 md:p-8 shadow-[0_0_60px_rgba(255,0,0,0.8)] flex flex-col items-center text-center animate-pulse">
            {/* Warning Beacon */}
            <div className="w-20 h-20 rounded-full bg-red-900/60 border-2 border-red-400 flex items-center justify-center mb-4">
              <ShieldAlert className="w-12 h-12 text-red-400 animate-ping" />
            </div>

            <div className="px-3 py-1 rounded bg-red-950 border border-red-500 text-red-200 text-xs font-black uppercase tracking-widest mb-2">
              EXAM SECURITY VIOLATION
            </div>

            <h2 className="text-xl md:text-2xl font-black text-red-400 tracking-wider mb-2">
              PROCTOR WARNING: SUSPICIOUS ACTIVITY DETECTED
            </h2>

            <p className="text-xs md:text-sm text-slate-200 mb-3 leading-relaxed">
              Subject pupil deviated {gazeMetrics.direction.replace('_', ' ')} by more than 15% from screen center continuously for <strong>&gt;3.0 SECONDS</strong>.
              Cheating risk elevated to <strong>{antiCheating.cheatingRiskIndex}%</strong>.
            </p>

            {/* Structured JSON Log Output */}
            <div className="w-full bg-black/80 border border-red-500/50 rounded-lg p-3 text-left mb-4 text-xs font-mono">
              <div className="text-[10px] text-red-400 font-bold uppercase mb-1">
                Structured Audit Log:
              </div>
              <pre className="text-emerald-400 text-[11px] overflow-x-auto">
                {JSON.stringify(
                  {
                    isCheating: true,
                    direction: gazeMetrics.direction,
                    confidence: 0.96,
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            <button
              onClick={dismissProctorAlert}
              className="w-full py-3 px-6 rounded-xl font-black text-sm tracking-wider uppercase bg-gradient-to-r from-red-600 to-rose-600 text-white hover:brightness-125 active:scale-95 transition shadow-[0_0_30px_rgba(255,0,0,0.7)]"
            >
              Dismiss & Refocus On Screen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
