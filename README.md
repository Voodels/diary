# Dear diary

Ghost-gated encrypted diary. This public repo hosts the app on GitHub Pages and
holds the encrypted vault index (`vault/meta.json`, `vault/token.enc`); a second,
private repo holds the encrypted pages and images.

## How it works

- **Gate password** derives the encryption key in your browser (HTTPS only-from-your-keys:
  derived on device, never sent anywhere).
  - Legacy vaults: **PBKDF2-SHA256**, 310,000 iterations (`v1`).
  - New / upgraded vaults: **Argon2id**, m=64 MiB, t=3, p=1 (`v2`) — vendored
    `argon2-browser` 1.18.0 (MIT, see `argon2/LICENSE.txt`).
- **Encrypted storage** — AES-256-GCM, payload `enc-v1:b64(iv12|ciphertext)`:
  - pages `vault/entries/<id>.json`
  - images `vault/images/<uid>.bin` (referenced in markdown as `![name](image:id)`)
  - `token.enc` (GitHub token, encrypted with the vault key) lives in this repo
    for reconnects.
- **Routing** — `dataRepo` inside `meta.json` points writes at the private repo;
  index stays here so plain GitHub Pages works.
- **CI** — every push runs unit tests (helpers, markdown, request routing,
  element IDs): `.github/workflows/ci.yml`.
- **Vault backups (Actions webhook)** — in `Voodels/diary-vault`,
  `.github/workflows/backup.yml` snapshots `vault/**` on every push to it and can
  also be triggered by `repository_dispatch: diary-saved` or manually. Snapshots
  are stored as workflow artifacts for 60 days.

## Setup (once)

1. GitHub Pages serves this repo from `main` (already configured).
2. Create a fine-grained PAT with **Contents: read+write** on both
   `Voodels/diary` and `Voodels/diary-vault`.
3. In the app: ⚙️ → owner / repo / token → **Save**.
4. If no vault exists yet you'll be prompted to create one (writes `meta.json`,
   `token.enc`, empty entries). Otherwise just unlock.

## Threat model — read this

**Defends against:**
- Someone reading raw repo files (leaked token, public visibility accident,
  account compromise staying after password change) — they get ciphertext only.
- Direct password cracking: argon2id at 64 MiB × 3 passes makes per-guess cost
  ~5–10× a naive PBKDF2 at web scale, and GPU attacks pay for memory bandwidth.
- Data loss: 409 edit conflicts are detected (your copy is stashed locally, never
  silently discarded), save retries, idempotent KDF migration (re-runnable),
  automatic artifact backups of the private repo.

**Does NOT defend against:**
- **Metadata.** Filename rhythm, commit messages, timestamps, image sizes reveal
  *when and how often* you write. Anyone with repo read access sees this.
- **Password loss.** No reset, no recovery. Forget it → content stays encrypted
  but unreadable, forever.
- **Weak passwords.** Encryption is only as strong as the chosen passcode.
- **Unlocked session on your device.** Closing the tab locks (auto-lock idle
  timer); nothing is decrypted at rest on disk.
- **GitHub itself.** They can always see metadata above; ciphertext only if
  their crypto is not compromised.

Practical hygiene: strong passcode phase (length over cleverness), GitHub 2FA,
rotate the PAT periodically. After rotating: paste the new one in ⚙️ mid-run
failures with "Bad credentials" are safe — migrations resume idempotently.

## KDF upgrade (how it behaves)

Settings → Encryption: PBKDF2 vaults show "upgrade available". The upgrade:
1. derives an argon2id key from the same password + fresh salt,
2. re-encrypts every page, every image and `token.enc` (old items decrypt check
   → skipped — safe to re-run),
3. flips `meta.json` to `v2/argon2id` last (single atomic write),
4. stash of the migration salt in `localStorage` makes an interrupted run
   resume with the same key. The salt is not secret.

## Dev notes

- `node tests/*.test.js` locally; Actions runs the same suite on push.
- Script order in `index.html` matters and stamps are versioned `?v=N` (bump
  after each change batch).
- CSP is strict: `script-src 'self' 'wasm-unsafe-eval'`, `connect-src` limited to
  GitHub API + raw, no `eval`.
