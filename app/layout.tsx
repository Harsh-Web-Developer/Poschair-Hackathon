import type { Metadata } from 'next';
import { Press_Start_2P, VT323, Space_Grotesk } from 'next/font/google';
import './globals.css';

const pressStart = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
  display: 'swap',
});

const vt323 = VT323({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  weight: ['400', '600', '700'],
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AI Exam Proctoring & Ergonomic Posture Sentry',
  description: 'Cyberpunk Neural HUD for real-time exam proctoring gaze detection and 30-second ergonomic posture collapse alerts with Gemini 3.5 Flash & ElevenLabs voice coaching.',
  keywords: ['exam proctoring', 'gaze tracking', 'anti-cheating', 'ergonomic posture', 'AI', 'webcam', 'MediaPipe', 'Gemini Flash', 'ElevenLabs', 'Cyberpunk HUD'],
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pressStart.variable} ${vt323.variable} ${spaceGrotesk.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (typeof window !== 'undefined') {
                  var origErr = console.error;
                  var origWarn = console.warn;
                  console.error = function() {
                    var msg = arguments[0];
                    if (typeof msg === 'string' && (
                      msg.indexOf('INFO:') === 0 ||
                      msg.indexOf('TensorFlow Lite') !== -1 ||
                      msg.indexOf('XNNPACK') !== -1
                    )) {
                      if (console.info) {
                        console.info.apply(console, arguments);
                      }
                      return;
                    }
                    origErr.apply(console, arguments);
                  };
                  console.warn = function() {
                    var msg = arguments[0];
                    if (typeof msg === 'string' && (
                      msg.indexOf('INFO:') === 0 ||
                      msg.indexOf('TensorFlow Lite') !== -1 ||
                      msg.indexOf('XNNPACK') !== -1
                    )) {
                      if (console.info) {
                        console.info.apply(console, arguments);
                      }
                      return;
                    }
                    origWarn.apply(console, arguments);
                  };
                }
              })();
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
