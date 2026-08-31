# Course audio authoring

Static pronunciation audio is generated during authoring and bundled with GlideLingo. The app only knows stable `audioId` values; it never calls Google Cloud at runtime.

## Generate a lesson

1. Authenticate locally with Application Default Credentials:

   ```bash
   gcloud auth application-default login
   gcloud auth application-default set-quota-project "$GOOGLE_CLOUD_PROJECT"
   ```

2. Preview character count and the upper-bound estimate (the default mode never writes or calls Google):

   ```bash
   npm run audio:estimate -- --lesson el-letters-1
   ```

3. Generate and validate only when the estimate is acceptable:

   ```bash
   npm run audio:generate -- --lesson el-letters-1
   npm run audio:validate
   ```

Use `--clip <audioId>` for one clip or `--all` for every manifest. Generation refuses estimates above `GOOGLE_TTS_MAX_GENERATION_USD`, retries only transient provider failures, skips unchanged hashes, and replaces files atomically.

## Add another language

Create a directory such as `content/courses/en-fr-FR` containing:

- `audio-profiles.json` with the locale, voice, encoding, and current price assumption;
- `audio-manifest.json` with globally unique clip IDs, lesson IDs, profile IDs, and source text;
- `missions/*.json` with lesson blocks that reference those clip IDs.

The generator discovers audio-enabled course directories automatically and writes locale-scoped assets plus one static Metro registry. No playback code or provider URL changes are needed. Revisit the pricing assumption before a large batch; estimates are safeguards, not invoices.
