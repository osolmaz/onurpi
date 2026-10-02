# Anti-Repeat

This private OnurPi package loads a pinned commit of
[pi-anti-repeat](https://github.com/osolmaz/pi-anti-repeat) with its default options. Anti-Repeat is
on in every session. It cuts off a response whose thinking keeps repeating, sends one corrective
message, and stops the run if the repetition continues. See the upstream README for the detection
rules, the `/anti-repeat` command, and the events other extensions can use.

OnurPi loads this wrapper from the local checkout. It is not published to npm.

Run `/reload` after changing the package or global settings.
