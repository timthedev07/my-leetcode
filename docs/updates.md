# Application Updates

LeetCode Desktop uses `electron-updater` with the GitHub provider. Update checks run only in
packaged builds, shortly after launch and every six hours. The user can also select
**LeetCode Desktop > Check for Updates...** from the application menu.

The updater asks before downloading an update. Download progress appears on the application icon.
After verification, the user can restart immediately or allow the update to install when the
application next exits. The normal shutdown sequence flushes pending editor saves before the
installer takes over.

## First Update-Capable Version

Version 1.0.0 was published before the updater was implemented and cannot update itself. Install a
later release manually once, such as 1.1.0. From that version onward, newer releases can replace the
application in place while preserving drafts, settings and authentication data under
`~/Library/Application Support/LeetCode Desktop`.

## Release Requirements

Every update needs all of the following:

1. A higher semantic version in `package.json`.
2. A Developer ID signature and successful Apple notarisation.
3. Matching Git tag and GitHub release for the version.
4. The ZIP, ZIP blockmap, DMG, DMG blockmap and `latest-mac.yml` release assets.

The ZIP is used by `electron-updater`; the DMG is for manual installation. Do not omit
`latest-mac.yml`, because it supplies the latest version, SHA-512 digest and download paths.

Set `GH_TOKEN` to a token with release write access. Provide either a signing key and password or
the name of a Developer ID identity already installed in the keychain:

```sh
export GH_TOKEN=...
export CSC_LINK=/path/to/developer-id.p12
export CSC_KEY_PASSWORD=...
export APPLE_API_KEY=/path/to/AuthKey.p8
export APPLE_API_KEY_ID=...
export APPLE_API_ISSUER=...
```

If the signing identity is installed in the keychain, set `CSC_NAME` instead of `CSC_LINK` and
`CSC_KEY_PASSWORD`.

Apple ID notarisation can be used instead of API-key credentials:

```sh
export APPLE_ID=...
export APPLE_APP_SPECIFIC_PASSWORD=...
export APPLE_TEAM_ID=...
```

## Release Sequence

1. Update `version` in `package.json`.
2. Run the focused checks required for the changed code.
3. Commit the release version and create an annotated tag such as `v1.1.1`.
4. Push the commit and tag.
5. Run `yarn release` with the signing, notarisation and GitHub credentials exported.
6. Confirm that `latest-mac.yml`, both blockmaps, the ZIP and the DMG are attached to the published
   release.
7. Install the previous version, publish the new version, and confirm the download and restart flow
   before announcing the release.

`yarn package` remains an unsigned local build command. It must not be used for a release that is
expected to update installed applications.
