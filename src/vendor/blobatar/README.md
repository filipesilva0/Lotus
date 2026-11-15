# blobatar (vendored)

Source of [blobatar](https://github.com/Alain00/blobatar) 2.7.0 by Alain, MIT licensed (see `LICENSE`),
copied into Lotus in session 16 so the Lotus core (lotusd) and the app can draw blobatars without a
network or a package: the agent's `avatar.create` tool designs new ones, and every agent (main,
helpers, task agents) gets its own face. Unchanged except that this note was added; keep the
LICENSE file with it. To update, copy `packages/blobatar/src` from a newer release.
