# Security

This is a static site with no backend, no accounts and no database. It does not
store your data anywhere but your own browser. That removes most of what would
normally be on this page — but it turns on your camera, so the parts that
remain matter.

## Reporting a vulnerability

Please report privately rather than in a public issue:

- [Open a draft security advisory](https://github.com/oddurs/piano-cat/security/advisories/new)
  (preferred), or
- email <oddurs@gmail.com>.

Include what you found, how to reproduce it and what you think the impact is. I
will acknowledge within a week. This is a hobby project maintained in spare
time, so please size your expectations accordingly — but anything touching the
camera, the model supply chain or the shared-take encoding will get looked at
promptly.

Please don't run automated scanners against the GitHub Pages deployment. There
is nothing behind it to find, and it isn't mine to load-test.

## What is in scope

Things that would genuinely be bugs here:

- **Camera data escaping the page.** Frames are read, measured and discarded.
  Any path by which imagery, landmarks or a video stream leaves the browser is
  a serious bug.
- **A shared take doing something other than replaying numbers.** Takes are
  encoded into the URL fragment and decoded by `lib/take.ts`. A crafted
  fragment should fail to decode, not execute anything, exhaust memory or
  corrupt stored state.
- **Supply-chain problems with the hand model.** It is fetched at build time
  from a pinned URL and verified against a pinned SHA-256 in
  `scripts/fetch-mediapipe.mjs`. Weaknesses in that verification — or a way to
  get an unverified model into the artifact — are in scope.
- **Anything that makes the deployed site load code from a third-party
  origin.** It is deliberately self-contained.
- **Workflow or permissions problems** in `.github/workflows/` that would let a
  pull request escalate into a deploy or a token.

## What is not

- Missing security headers that GitHub Pages does not let a static site set.
- The camera permission prompt itself, or the browser's handling of it.
- Denial of service against your own browser tab by waving very fast.
- Vulnerability-scanner output with no demonstrated impact on this project.
- The vendored piano samples. They are audio files under CC-BY, and their
  provenance is documented in `public/piano/ATTRIBUTION.md`.

## Supported versions

The deployed site is whatever is on `main`. There are no releases and no
backports — fixes land on `main` and deploy from there.
