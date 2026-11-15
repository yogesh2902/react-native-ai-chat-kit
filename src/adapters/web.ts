import type { SpeechRecognizer } from '../components/customization';

type WebRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

/** True when the browser has the Web Speech API (Chrome, Edge, Safari). */
export function isWebSpeechRecognitionAvailable(): boolean {
  const g = globalThis as any;
  return !!(g.SpeechRecognition || g.webkitSpeechRecognition);
}

/** Speech-to-text in browsers (Expo web) via the Web Speech API. */
export function createWebSpeechRecognizer(options: { lang?: string } = {}): SpeechRecognizer {
  let recognition: WebRecognition | null = null;
  return {
    start(cb) {
      const g = globalThis as any;
      const Ctor = g.SpeechRecognition || g.webkitSpeechRecognition;
      if (!Ctor) {
        cb.onError(new Error('Voice input is not supported in this browser.'));
        cb.onEnd();
        return;
      }
      recognition = new Ctor() as WebRecognition;
      recognition.lang = options.lang ?? (g.navigator?.language || 'en-US');
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = (e: any) => {
        let text = '';
        let final = false;
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          if (e.results[i].isFinal) final = true;
        }
        if (final) cb.onFinal(text);
        else cb.onPartial(text);
      };
      recognition.onerror = (e: any) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          cb.onError(new Error(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice input failed (${e.error}).`));
        }
      };
      recognition.onend = () => {
        recognition = null;
        cb.onEnd();
      };
      recognition.start();
    },
    stop() {
      recognition?.stop();
    },
    abort() {
      recognition?.abort();
    },
  };
}
