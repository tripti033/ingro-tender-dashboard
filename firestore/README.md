# Firestore rules

Rules for the `ingro-tender-dashboard` project are published **by hand** in the
Firebase console (Build → Firestore Database → Rules). This folder holds the
blocks to paste, so the intent is at least reviewable in git.

## `tenderReports.rules.txt`

Adds the collection behind the public site's "report wrong data" form. Reports
are written by the public site's **service account** (admin SDK, bypasses
rules); the Team Console reads and triages them. See the file for the reasoning.

## ⚠ Known bug in the currently-published ruleset

The live ruleset ends with:

```
match /tenderTracking/{tenderId} {
  allow read, create, update, delete: if isIngro();
}
```

`isIngro()` is **not defined** anywhere in that ruleset — the function is called
`isIngroUser()`. Firestore rejects a ruleset that calls an undefined function,
so this block either blocks the whole publish or is silently denying access.

Either rename the call to `isIngroUser()`, or delete the block: the Team Console
stores its pursuit-tracking overlay in its **own** project
(`leads-tracking-4410a`, see `team-ingroenergy/firestore/firestore.rules`), so
`tenderTracking` in this project is vestigial.
