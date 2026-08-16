# THREE SEWERS — iOS TestFlight Runbook (run on your Mac)

Prereqs: Mac with Xcode 15+, Apple Developer Program membership, Godot 4.4.1 (godotengine.org/download — must match the project version).

1. **Open the project.** Launch Godot 4.4.1 → Import → select `threesewers/project.godot`. First open imports all assets (~1 min).
2. **Install export templates.** Editor → Manage Export Templates → Download and Install (4.4.1-stable).
3. **Sanity run on desktop.** Press F5. Play a half-inning with the mouse (tap = touch).
4. **Create the iOS preset.** Project → Export → Add… → iOS.
   - App Store Team ID: from developer.apple.com → Membership.
   - Bundle Identifier: `com.YOURNAME.threesewers` (create matching App ID implicitly on first Xcode signing).
   - Icons: point the 1024 slot at `res://assets/icon/icon.png` (Godot scales the rest; replace with final art later).
   - Orientation is already landscape via project settings.
5. **Export.** Export Project → choose a folder OUTSIDE the repo (e.g. `~/builds/threesewers-ios`). Godot produces an Xcode project.
6. **Xcode signing.** Open the generated `.xcodeproj` → target → Signing & Capabilities → check "Automatically manage signing," pick your Team. Set iOS Deployment Target 15.0.
7. **Encryption compliance.** Target → Info → add `ITSAppUsesNonExemptEncryption` = NO (skips the export-compliance question every build).
8. **Device smoke test.** Plug in your iPhone → select it as run target → Run. Play one full game on hardware before archiving.
9. **App Store Connect app record.** appstoreconnect.apple.com → My Apps → "+" → New App → platform iOS, the same bundle ID, name "Three Sewers" (or working name — changeable until first public release).
10. **Archive & upload.** In Xcode: select "Any iOS Device (arm64)" → Product → Archive → Organizer opens → Distribute App → App Store Connect → Upload (defaults fine).
11. **TestFlight.** In App Store Connect → TestFlight tab → build appears after ~10–20 min processing → answer the compliance prompt if asked (No, thanks to step 7) → add yourself under Internal Testing → install via the TestFlight app on your phone.

Gotchas:
- "Profile doesn't include device" → register the iPhone's UDID (Xcode does this automatically when you run to device once, step 8).
- Black screen on device but fine on desktop → almost always a case-sensitive resource path; check the Xcode console log.
- Internal testers (you + up to 100 team members) need **no** Beta App Review. External tester links do.
- Each new upload needs a bumped build number (Xcode target → Build settings → Current Project Version, or let Xcode auto-increment on archive).
