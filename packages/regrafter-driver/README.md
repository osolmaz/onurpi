# Regrafter driver

This optional OnurPi skill delegates Regraft-managed vendored-code maintenance to the dedicated
[Regrafter](https://github.com/osolmaz/pi-regraft#regrafter) app bundled with Pi Regraft.

The main agent keeps the user conversation. Regrafter owns the leased repository, its Pi session,
conflict resolution, checks, and update commits until it completes or hands control back safely.

No Regraft model tool is added to ordinary OnurPi sessions.
