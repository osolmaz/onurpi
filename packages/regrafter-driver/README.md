# Regrafter driver

This OnurPi package loads Pi Regraft's `/regraft` command and provides an optional skill that
delegates Regraft-managed vendored-code maintenance to the dedicated
[Regrafter](https://github.com/osolmaz/pi-regraft#regrafter) app.

The main agent keeps the user conversation. Regrafter owns the leased repository, its Pi session,
conflict resolution, checks, and update commits until it completes or hands control back safely.

No Regraft model tool is added to ordinary OnurPi sessions. The `/regraft` command runs only when
the user invokes it, and the Regrafter skill remains opt-in.
