# Pending templates

Written, but blocked from v2/templates by a defect outside the template. Discovery (`../registry.js`) reads only
`v2/templates/*.js`, so these are not offered until each passes `checkTemplate`; then they move up one directory.

- falling-blocks: passes every static stage and the gate, and its bot (stages over placement) wins world seed 1, but the
  placement strategy runs only the first seed when it wins (`v2/verify/strategies/placement.js` `multiSeed(play, { seeds:
  seeds.slice(0, 1) ... })`), so the contract's bots stage reports seeds 2 and 3 `did not run` (`bot_not_won`). The bot
  must play every seed its caller names.
