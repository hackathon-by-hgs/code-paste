# Mobile Client

iOS and Android cross-device clipboard sync application built with Flutter.

## Quick start

```bash
# Get the shared branch and docs
git remote set-branches --add origin main
git fetch origin main
git worktree add ../code-paste-docs main

# Install dependencies
cd mobile
flutter pub get

# Run on iOS (requires macOS)
flutter run -d ios

# Run on Android
flutter run -d android
```

## Architecture

See `../code-paste-docs/docs/SYSTEM_DESIGN.md` for the system design.

This branch implements:
- Clipboard integration layer (platform-specific via native channels)
- Device pairing and discovery UI
- Sharing session management
- Secure peer transport (LAN-first)
- Protocol compliance

## Testing

```bash
cd mobile
flutter test
```

## Security notes

- All clipboard data is treated as sensitive
- Local storage is encrypted
- Network communication is encrypted (see docs on main for protocol details)
- No clipboard data is logged

See `../code-paste-docs/docs/SECURITY.md` for details.

## Android CI downloads

Mobile CI builds release-mode APKs with `--split-per-abi` on pushes and pull
requests to `mobile`. Download the `android-apks` workflow artifact for ARMv7,
ARM64, and x86_64 APKs plus SHA-256 checksums.

After formatting, analysis, tests, the pinned-contract fetch, and the APK build
pass, pushes to `mobile` publish a GitHub prerelease named `mobile-build-<run number>`.
Manual workflow runs on `mobile` use the same flow. Pull requests never publish.
The release targets the exact built commit and uses the built-in `GITHUB_TOKEN`;
no personal access token is needed. Contract vector execution is still pending.

The current Gradle configuration signs with a debug key. These are test builds;
CI signing keys may differ across runs, requiring an uninstall before reinstalling.
Production distribution needs a persistent release signing key.
