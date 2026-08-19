# Emotion Reference Library

This directory is server-only. It is not under `public/`, is explicitly blocked by the Vite file
deny-list and middleware, and is not included in the static Sites build. Reference clips are never
served as browser assets.

The checked-in clips are original, procedurally generated MoodTrack assets released under CC0-1.0.
They contain no sampled recordings, third-party melodies, vocals, or copyrighted source material.

Each standard emotion has one concise, internally consistent reference. ACE-Step receives only the
single dominant reference selected by the Text Emotion Agent. Secondary emotions remain in the text
prompt so compound descriptions are preserved without sending multiple competing references.

Regenerate the library from the `frontend` directory:

```powershell
node .\scripts\generate-emotion-reference-library.mjs
```

To add a clip, place it inside `audio/<emotion-id>/` and add an entry to `manifest.json`. Supported
formats are WAV, MP3, FLAC, OGG, AAC, and M4A. Keep a clip under 8 MiB, emotionally consistent, free
of long silence, and record its source and license. Never use an unlicensed commercial song.
