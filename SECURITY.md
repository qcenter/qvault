# Reporting a security problem

QVault is an experimental, unaudited password manager. If you find a way to read, change or lose vault data, or to make the extension act for a website it should not act for, please report it privately first.

**How:** open the repository's **Security** tab on GitHub and choose **Report a vulnerability**. This creates a private report that only the maintainers can see. Please do not open a public issue for a security problem.

**What helps:** the QVault version (shown at the bottom of the popup), the browser and operating system, the steps to reproduce, and what you expected instead. Never include real passwords, recovery keys, backup files or access keys; fictional values are enough.

**What to expect:** this is a small volunteer project without a support contract. Reports are read and answered as time allows, and fixes are published as a new version with a note in the release.

**In scope:** the extension code in this repository. **Out of scope:** the Quilibrium services themselves (QStorage, QKMS), the browser, the passkey provider, and a computer that is already compromised while the vault is unlocked; the README lists these limits.
