import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: NextRequest) {
  try {
    const { prompt, topIssue } = await req.json();

    const problemName = topIssue?.problemName || 'Poor posture detected';
    const fixAction   = topIssue?.fixAction   || 'Sit tall, align your spine, and relax your shoulders.';
    const defaultCue  = `${problemName}. ${fixAction}`;

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    let text = '';

    if (apiKey) {
      const ai = new GoogleGenAI({ apiKey });
      const modelsToTry = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];

      for (const mName of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: mName,
            contents: prompt,
            config: {
              systemInstruction:
                "You are PosChair, an AI voice posture coach. Always deliver speech in exactly two sentences: FIRST state the detected problem clearly, THEN state the physical fix action. Example: Head tilt detected. Keep your neck straight and level your head. Both the problem and the fix must always be included. Keep under 20 words.",
              temperature: 0.2,
              maxOutputTokens: 70,
            },
          });
          text = response.text?.trim() || '';
          text = text.replace(/^["']|["']$/g, '').trim();
          if (text && text.split(' ').length >= 4) break;
        } catch (err) {
          console.warn(`Gemini model ${mName} unavailable:`, err);
        }
      }
    }

    if (!text || text.split(' ').length < 4) {
      text = defaultCue;
    }

    return NextResponse.json({ correction: text });
  } catch (error) {
    console.error('Gemini API error:', error);
    return NextResponse.json({
      correction: 'Poor posture detected. Sit tall and align your spine.',
    });
  }
}
