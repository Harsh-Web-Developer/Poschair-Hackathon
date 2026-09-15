import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Sarah (EXAVITQu4vr4xnSDxMaL) is an official ElevenLabs pre-made voice that works on all accounts without library-tier paywalls.
const PREMADE_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
const USER_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      type = 'POSTURE_COLLAPSE',
      metrics = {
        postureScore: 48,
        headTilt: 14,
        spineLean: 11,
        gazeDirection: 'LOOKING_DOWN',
        cheatingRisk: 75,
        badPostureDuration: 30,
      },
    } = body;

    // 1. Synthesize smart coaching text via Gemini Flash
    let correctionText = '';
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;

    if (type === 'PROCTOR_VIOLATION') {
      correctionText = `Proctor warning: Suspicious gaze deflection detected away from center screen. Refocus your eyes on the exam immediately.`;
    } else {
      correctionText = `Critical posture collapse detected. Re-align your spine, level your shoulders, and draw your chin back.`;
    }

    if (apiKey) {
      const ai = new GoogleGenAI({ apiKey });
      const isPosture = type === 'POSTURE_COLLAPSE';
      const prompt = isPosture
        ? `You are an AI Ergonomic & Biomechanical Voice Coach in an exam proctoring environment.
Current user telemetry:
- Posture Health Score: ${metrics.postureScore}% (Critical collapse: sustained for ${metrics.badPostureDuration || 30}s)
- Spine Lateral Lean: ${metrics.spineLean}°
- Head Tilt: ${metrics.headTilt}°
- Gaze: ${metrics.gazeDirection}

Provide a direct, authoritative, 2-sentence spoken warning:
Sentence 1: Explicitly state the exact anatomical defect (e.g. lateral spine lean of ${metrics.spineLean} degrees).
Sentence 2: Give immediate physical correction cues.
Keep strictly under 24 words total. Do not use markdown or quotes.`
        : `You are an AI Exam Proctoring Security Coach.
Current telemetry:
- Gaze Direction: ${metrics.gazeDirection}
- Cheating Risk Index: ${metrics.cheatingRisk}%
- Sustained Gaze Deflection > 3 seconds.

Provide a firm, calm 1-2 sentence proctor alert instructing the student to look directly back at the exam screen immediately.
Keep strictly under 20 words total. Do not use markdown or quotes.`;

      const candidateModels = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];
      for (const modelName of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              temperature: 0.2,
              maxOutputTokens: 60,
            },
          });

          const generated = response.text?.trim().replace(/^["']|["']$/g, '');
          if (generated && generated.split(' ').length >= 4) {
            correctionText = generated;
            break;
          }
        } catch (geminiErr: any) {
          // If model not found or temporary error, try next candidate
          continue;
        }
      }
    }

    // 2. Convert to speech using ElevenLabs if key is configured
    const elevenKey = process.env.ELEVENLABS_API_KEY;
    if (elevenKey) {
      // Prioritize premade voice if user voice is the paid-plan-restricted Rachel
      const voiceIdToTry =
        USER_VOICE_ID && USER_VOICE_ID !== '21m00Tcm4TlvDq8ikWAM'
          ? USER_VOICE_ID
          : PREMADE_VOICE_ID;

      try {
        const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceIdToTry}`, {
          method: 'POST',
          headers: {
            'xi-api-key': elevenKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: correctionText,
            model_id: 'eleven_turbo_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8,
              style: 0.1,
              use_speaker_boost: true,
            },
          }),
        });

        if (ttsRes.ok) {
          const audioBuffer = await ttsRes.arrayBuffer();
          return new NextResponse(audioBuffer, {
            status: 200,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Content-Length': audioBuffer.byteLength.toString(),
              'X-Coaching-Text': encodeURIComponent(correctionText),
            },
          });
        }
      } catch (ttsNetworkErr) {
        // Silently proceed to client speech fallback
      }
    }

    // Fallback: return JSON so client uses native SpeechSynthesis
    return NextResponse.json({
      ok: true,
      text: correctionText,
      fallbackAudio: true,
      elevenLabsConfigured: Boolean(elevenKey),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: true,
        text: 'Warning: Abnormal posture or exam violation detected. Please readjust immediately.',
        fallbackAudio: true,
      },
      { status: 200 }
    );
  }
}
