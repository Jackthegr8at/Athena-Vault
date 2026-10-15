# Public publication safety

Transfer only reviewed public-safe files or patches. Never import private Git history or fetch a private remote into this checkout. Review outgoing changes manually: scans cannot identify every personal record or private feature.

Install the local guard in this public checkout only:

```sh
git config --local core.hooksPath .githooks
```

The hook requires Node.js, Git and Gitleaks on PATH. If Gitleaks is installed elsewhere, set `ATHENA_GITLEAKS_BIN` to the trusted executable's absolute path or configure `git config --local athena.gitleaksBin /absolute/path/to/gitleaks`. This local choice is not committed. Missing tools or failed scans block the push. Do not use `--no-verify` or replace the scanner to bypass checks.

Only the intended repository's HTTPS/SSH destinations and branch/tag updates are allowed. Ref deletion is blocked. The hook reviews every commit tree reachable from each pushed tip, rejects private/generated paths, symlinks and submodules, checks known private markers and commit metadata, and runs redacted Gitleaks over reachable history. Diagnostics do not print matching content. It does not install itself in other clones and is not server-side enforcement.

Run focused tests with `node --test scripts/security/public-pre-push.test.mjs`. Before pushing, also review the staged diff and run the existing publication path/content guards on a source-only review tree. Obtain explicit public publication approval. Keep GitHub push protection enabled as an independent layer.
