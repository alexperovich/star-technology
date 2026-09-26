# Repository instructions

## Terminal environment

All repository tools and dependencies are available only inside the `ubuntu`
Distrobox container.

- Always enter the container with `distrobox enter ubuntu` once in every new
  terminal session, before running any repository command.
- Do not run repository commands directly on the host.
- For a non-interactive terminal invocation, wrap the command with
  `distrobox enter ubuntu -- bash -lc '<command>'`.
- When reusing an interactive terminal that is already inside the container,
  do not enter the container again.
