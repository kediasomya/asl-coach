# ASL Coach

> **Built with Wispr Flow.** This project was created for the Wispr Flow hackathon task: the whole app was directed by voice using Wispr Flow dictation.

A browser app for learning American Sign Language. Say or type a word or sentence, choose how to practise each word (full sign, fingerspelled, or skipped), then sign it to your camera and get live feedback.

## Features

- **Voice or text input** with speech-recognition correction and alternative transcriptions.
- **Per-word plan**: sign, spell, or skip each word; switch at any point during practice.
- **About 1,000 signs** shown with real signing clips, plus a fingerspelling alphabet.
- **Camera feedback** using MediaPipe hand tracking: handshape recognition, movement detection (wave, circle, tap, swipe...) and a one-minute calibration that learns your own hand.
- Animated illustrations as a fallback when no clip is available.

## Run

The camera needs `localhost` or HTTPS, so serve the folder rather than opening the file directly:

```
python -m http.server 8000
```

Then open <http://localhost:8000> in Chrome or Edge and allow camera and microphone access. An internet connection is required (hand-tracking model, sign clips, speech recognition).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Layout and styles |
| `app.js` | Planning, practice flow, recognition loop, voice input |
| `classifier.js` | Handshape rules and personal calibration |
| `motion.js` | Hand movement tracking |
| `lexicon.js` | Hand-described signs, aliases, shape mapping |
| `signmedia.js` | Map from words to sign clips and videos |
| `hands.js`, `signanim.js` | Drawn hand and animated sign illustrations |
| `assets/letters/` | Fingerspelling letter images |

## Credits

- Built with [Wispr Flow](https://wisprflow.ai), voice dictation used to specify and iterate on the whole project.
- Sign clips are linked from [Lifeprint / ASL University](https://www.lifeprint.com) (Dr. Bill Vicars) and remain their property; they are not redistributed here.
- Letter images are public-domain illustrations from Wikimedia Commons; one word image is CC BY-SA 4.0 (Luxpoiesis).
- Hand tracking by [MediaPipe](https://developers.google.com/mediapipe).
