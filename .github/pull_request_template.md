<!--
  PR into `mobile`. Base branch must be `mobile` (feature branches are hyphenated: `mobile-*`). A PR
  from here into another domain is always a mistake (DEV_GUIDE.md §3.4, §9).
-->

## 1. What changed?

## 2. Why?

## 3. Which architecture boundary moved?
<!-- Platform channel change? New permission? Discovery/transport change? Mobile must respect OS
     clipboard/background limits — design around them, don't fight them (CLAUDE.md, PLATFORM
     REALITY). "None" is valid. -->

## 4. How was it tested?
<!-- Paste actual output. Note devices/emulators used (RULES.md §5). -->
```text
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze --no-pub
flutter test --no-pub --coverage
```

## 5. Security / privacy implications
<!-- Clipboard access scope, secure storage of tokens/keys (flutter_secure_storage), what appears in
     logs/crash reports (never clipboard contents or tokens — RULES.md §2). "None" is valid. -->

## 6. What is left?

---

### Checklist
- [ ] PR title is Conventional Commits, e.g. `feat(mobile): pair device via QR`.
- [ ] `dart format`, `flutter analyze`, `flutter test` pass locally.
- [ ] Tests added/updated for meaningful behaviour (RULES.md §8).
- [ ] Platform permissions changes are documented (PLATFORM_PERMISSIONS.md).
- [ ] No secrets/tokens/keystores/`.env` committed (only `.env.example`).
- [ ] `CONTRACTS_VERSION` still matches the protocol the client implements.
