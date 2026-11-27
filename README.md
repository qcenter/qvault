<img src="assets/icons/icon-128.png" width="72" height="72" alt="QVault icon">

# QVault 0.49.0

> **Experimental.** QVault is an unaudited preview. It has had no independent security review, and parts of it have only been tested with simulated services. Try it with test data. If you use it for real passwords, keep another copy of them somewhere else.

QVault is a password manager for Chromium browsers, built on [Quilibrium](https://quilibrium.com): your encrypted vault is stored in QStorage and can be protected by a second lock in QKMS. It is an independent project and not an official Quilibrium product.

## How it works

- **You unlock with a passkey**, for example Touch ID. There is no master password to type or to guess.
- **Your passwords are encrypted on your computer** with a random key that never leaves it unencrypted. Only encrypted data is uploaded.
- **The encrypted vault is kept in your own QStorage bucket.** Every save uploads a new encrypted copy, and every unlock loads the newest one.
- **Second lock (optional, recommended).** A QKMS key is split in two. One half stays with the QKMS service, the other in your encrypted profile on your computer. Opening the vault needs both, so a copy of your files alone is not enough, and the service alone cannot read anything either: it only ever handles data that is already locked with your own key.
- **Recovery key.** Shown once at the end of setup. It is the only way in if the passkey is lost. If you lose both, nobody can recover the vault.
- **Filling is your choice.** QVault fills a login only when you pick an entry, only on the exact website it was saved for, and never submits the form.
- **It locks itself** after five minutes without use (1, 5, 15 or 30, your choice), when the browser closes, and as soon as the computer locks or goes to sleep with a lock screen.

What is stored where:

| Where | What |
| --- | --- |
| This browser | Your encrypted profile: storage access details, the vault key and, with the second lock, your half of the QKMS key. It opens only with your passkey or recovery key. |
| Your QStorage bucket | Encrypted copies of the vault under `qvault/<profile id>/`. |
| QKMS (second lock only) | The service's half of the key. |
| Your passkey provider | The passkey, for example in iCloud Keychain or Google Password Manager. |

## What you need

- A Chromium browser that supports passkeys with the PRF extension. Chrome on macOS with Touch ID is the tested combination. The **Diagnostics** page has a passkey check that tells you whether yours works.
- A Quilibrium account with an access key from QConsole that may use QStorage and, for the second lock, QKMS.

## Install

QVault is not in the Chrome Web Store yet, so it is loaded by hand. This needs no build step; the repository contains the built extension.

1. Download the code: on the GitHub page choose **Code → Download ZIP** and unzip it, or run `git clone https://github.com/qcenter/qvault.git`.
2. Put the folder somewhere permanent. The browser loads the extension from this folder every time it starts.
3. Open `chrome://extensions` and turn on **Developer mode** (top right).
4. Choose **Load unpacked** and select the folder that contains `manifest.json`.
5. Pin QVault to the toolbar from the puzzle-piece menu.

To update, replace the contents of the folder with the new version and press the reload button on the QVault card in `chrome://extensions`. Do not remove the extension to update it: removing it deletes the saved profile from the browser. Download a backup first (see below).

The browser may show a warning about developer-mode extensions at startup. That is expected for anything loaded this way.

## First setup

1. Click the QVault icon and choose **Set up QVault**.
2. Enter a bucket name, the region, and your access key ID and secret. If the bucket does not exist, QVault creates it as private. The Storage help link on the Setup page explains the permissions.
3. Leave **Add a second lock with QKMS** on unless you only want to try things quickly. It adds one to two minutes to setup.
4. Choose **Set up vault with passkey** and confirm with Touch ID or your device's prompt. The four steps at the top show progress.
5. Save the recovery key when it is shown. It cannot be shown again.
6. Close the tab, click the QVault icon and choose **Unlock with passkey**.

If setup fails, nothing is saved and you can start again. An unused QKMS key and passkey may be left behind.

## Everyday use

- **Signing up somewhere.** With the Q button on the page, click it in the password field and choose **Generate a password**: it is filled into the form and saved at once. **Save this login** stores what you typed into a login or sign-up form. Both happen only when you click them, and only for the website you are on. After you send a login or sign-up form, QVault asks on the page whether to save or update what you typed (on a login split over two pages it joins the name from the first page to the password from the second); it is saved only if you choose Save, the question is not shown for a login that is already saved, and nothing is kept while the vault is locked. This works on pages where the Q button is present. When you open the Q panel on a filled-in form, QVault likewise compares what is typed with what is saved, so a login that is already saved is not offered again and a changed password is offered as an update.
- **Changing a password on a website.** On the change-password form click the Q button in the current-password field and pick the entry: only that field is filled. Then click the Q in the new-password field and choose **Generate a password**; the repeat field is filled too and the saved login is updated. The password that was replaced is kept with the entry and shown under **Show**, in case the website refused the new one.
- **Add:** the **+** button. **Fill:** open QVault on the login page and click the suggested entry. **Edit or delete:** the **⋯** menu on a row.
- **Q button on websites.** By default QVault can touch a page only after you open it there. To get a Q button beside login fields on every HTTPS site, turn on **Q button on all websites** under Settings in the popup; the browser asks for permission, and you can turn it off again in the same place.
- **Seeing a saved password.** The editor does not load the saved password. **Show** opens a small window that asks for your passkey again (the recovery key is offered only if the passkey cannot be used on that computer) and shows the password for 30 seconds with a countdown; leaving the field empty keeps the saved one. You can turn this check off under Settings; doing so locks the vault once. Filling a login on a website does not ask again.
- **Lock** with the padlock button. Unlocking again asks for the passkey. Under Settings in the popup you choose after how many unused minutes it locks by itself.
- **Toolbar icon.** The QVault icon is green only while the vault is unlocked. Locked, or before a vault is set up, it is grey. Hovering over it says the same in words.

## Using it on another computer

1. On the first computer open **Backup & restore** and choose **Download encrypted backup**.
2. Install QVault on the other computer, open **Backup & restore** there and restore that file.
3. Unlock with your passkey if it is synced to that computer. Otherwise use the recovery key; you can create a passkey for that computer in the same step.

While a vault is unlocked, QVault checks the cloud every 20 seconds and whenever you open the popup, so a change saved on one computer shows up on the others within about half a minute. **Sync now** checks at once.

How two computers editing at the same moment are handled depends on the storage:

- If QStorage enforces conditional writes, the popup shows **Synced** and edits made at the same time are merged.
- If it does not, the popup shows **Backed up to the cloud**. A save is refused, not overwritten, if another computer saved a moment earlier; the other change loads within a few seconds and you make yours again.

QVault checks which case applies on its own; there is nothing to choose.

## Backups

The backup file from **Backup & restore** is your encrypted profile. Without it, or a computer that still has QVault set up, the vault in the cloud cannot be opened, even with the recovery key. Keep a copy, and download a fresh one from time to time: old cloud copies are cleaned up after 30 days, and a very old backup may point at one that is gone.

Keep the recovery key away from the backup file. Anyone holding both can open the vault.

## Known limits

- No independent security audit. The project's own review does not replace one.
- A computer that is compromised while the vault is unlocked can read it.
- The QKMS key is created with a trusted-dealer method: the key material exists in one place for a moment while it is being split.
- The same access key is used for QStorage and QKMS.
- A single computer cannot be removed from a shared vault. To shut one out, create a new vault and move your entries.
- Unused QKMS keys from failed setups are not deleted automatically.
- Iframes and ambiguous login forms are not filled.
- Tested on one browser and operating system. The second lock and a second computer have automated tests against simulated services, and the Q button is tested in a real browser against a stand-in website; Against the real services only vault setup, unlock, saving and syncing between two computers were tried by hand.

## Permissions

The extension itself may contact only `qkms.quilibrium.com` and `qstorage.quilibrium.com`. Website access is optional and off until you turn it on.

Your access key needs GetObject, PutObject and ListBucket on the bucket, and CreateBucket if QVault should create it. DeleteObject is needed only for the automatic cleanup of old copies; without it nothing is deleted and nothing fails. No public access is needed. For the second lock the key must be allowed to create and use QKMS keys.

## Build and tests

Node 24 and npm are used for local development. Prebuilt JS/WASM is included, so loading the extension does not require building.

```sh
npm ci
npm run build
node build-tests.mjs
npm test            # every tests/*-smoke.mjs; the groups below run subsets
npm run test:sync
npm run test:profile
npm run test:browser
npm run test:rsa
npm run test:channel
npm run test:prepare
```

Tests use fictional credentials and generated test material. They must never load a real browser profile, cloud secret, vault or keyshare. `build/build-wasm.sh` and `build/build-rust.sh` rebuild the optional WASM dependencies (the patches they need are beside them); see `THIRD-PARTY.md` for pinned upstream source/licenses and cryptographic limitations. The bundled compatibility sources are from the recorded upstream version, not a claim that every current Quilibrium release has been tested.

Chrome installation constraints: [official distribution guidance](https://developer.chrome.com/docs/extensions/how-to/distribute). A future signed store release is needed for ordinary store installation and automatic extension updates.

`npm run test:e2e` runs the extension in a real Chromium with a virtual passkey and a local stand-in for QStorage. `tests/e2e/vault.e2e.mjs` covers setup, unlock, saving, recovery and reset; `tests/e2e/pages.e2e.mjs` plays a whole website visit against a local stand-in site: sign-up with a generated password, filling a login, changing a password, the save and update questions after a form is sent, a login split over two pages, a login that never loads a new page, and the locked state. `tests/e2e/devices.e2e.mjs` runs two browsers as two computers on one vault: backup download, restore into a clean browser, recovery-key unlock with a new passkey, changes travelling both ways without locking, a refused near-simultaneous save and the one-minute idle lock; it waits for real timers and takes a few minutes. For that second test website access is granted and the page panel's shadow root is opened in a temporary copy of the extension, because a test cannot click the browser's permission prompt. The CI workflow in `.github/workflows/ci.yml` verifies `SHA256SUMS`, runs all tests, and fails if the committed bundles differ from a fresh build.

## License

QVault's own code is licensed under the GNU Affero General Public License, version 3 (see [LICENSE](LICENSE)). In short: you may use, study and change it, and if you pass on a changed version or run one for others, you must publish your source under the same license.

The Quilibrium SDK sources are not stored here: `npm run build` fetches them from the public fork [qcenter/qkms-sdk](https://github.com/qcenter/qkms-sdk) at one fixed commit. Those sources, and the bundles and modules built from Quilibrium code in `dist/` and `vendor/`, are not covered by that license; they belong to their authors and keep their own terms. [THIRD-PARTY.md](THIRD-PARTY.md) lists every bundled component and where it comes from.

## More

- [Third-party code and cryptographic notes](THIRD-PARTY.md)
- [Reporting a security problem](SECURITY.md)
