# Original sports subgames: gameplay references

Research date: 2026-10-16. These references inform original soccer and American football games. NBA 2K and NBA Jam are references for controls, readable team play, and arcade presentation; basketball is not part of this implementation scope. No reference assets, team identities, player likenesses, commentary, or branded presentation are included in the games.

## Evidence actually inspected

This is a bounded reference study, not a claim to have watched entire matches. Browser inspection covered selected video frames and EA's four camera-comparison stills; primary-source gameplay explanations and a controller manual supplied the remaining detail. A frame proves presentation at that moment, not responsiveness, animation quality over time, or how the controls feel in hand.

| Reference | Inspection | Useful evidence |
| --- | --- | --- |
| [FIFA 23 official gameplay deep dive](https://www.youtube.com/watch?v=xu0jf2LwafY&t=366s), EA SPORTS FC | Selected frames at approximately 6:09 and 6:19 in the Power Shots chapter, viewed in the browser | Elevated sideline framing, a compact corner scoreboard, and an overhead marker distinguish the controlled athlete. The 6:19 cinematic frame is presentation reference only. |
| [FIFA 23 gameplay Pitch Notes](https://www.ea.com/news/pitch-notes-fifa-23-gameplay-deep-dive), EA | Primary-source text | Explicit aiming accuracy and shot power affect outcomes; defensive pressure has positional costs. This supports a skill-based manual shot model rather than selecting a target and guaranteeing a goal. |
| [FC 25 Rush deep dive](https://www.ea.com/games/ea-sports-fc/fc-25/news/pitch-notes-fc-25-rush-deep-dive), EA | Primary-source text and browser screenshot of the Broadcast, Tactical, Pro, and End to End camera comparison | Tactical retains a wider horizontal view than Broadcast; Pro and End to End look toward the opposing goal. Text documents a compact 5v5 pitch, quick set pieces, AI goalkeeper, and brief celebrations. |
| [FC 25 gameplay deep dive](https://www.ea.com/en/games/ea-sports-fc/fc-25/news/pitch-notes-fc-25-gameplay-deep-dive), EA | Primary-source text | Off-ball roles and readable player contrast are gameplay concerns. Goalkeepers close shooting angles and have distinct reactions. |
| [NBA 2K25 gameplay report](https://nba.2k.com/2k25/courtside-report/gameplay/), Visual Concepts / 2K | Full report read in browser; first and final frames of its approximately three-second embedded Defensive Movement demo inspected | Text emphasizes AI spacing, driving lanes, defensive pursuit/rotation, and reaction delays when tuning difficulty. The demo frames show body positioning at the contest and a loose ball at the end; they do not establish controls or timing by themselves. |
| [NBA 2K25 official PS5 manual](https://cdn.2k.com/nba/nba-2k25/manuals/ps5/2KSWIN_NBA2K25_PS5_Online_manual_ENG.pdf), 2K | Controller and basic-offense/defense text, printed pages 4–5 | Left stick moves, right stick handles additional skill inputs, sprint is on a trigger, and passing/player switching are contextual team actions. The PDF's extracted face-button glyphs are unreliable; use this for control concepts, not a copied literal layout. |
| [NBA 2K25 mode guide](https://support.nba2k.com/hc/en-us/articles/41845263989011-NBA-2K25-Game-Mode-Breakdown), 2K Support | Primary-source text | Learn 2K teaches mechanics through drills and practice scenarios. Transfer the principle of visible, actionable control guidance without adding a separate training mode to this first scope. |
| [NBA Jam: On Fire Edition First Look trailer](https://www.youtube.com/watch?v=6TlmLQfQ5kg), IGN-hosted publisher trailer | Browser playback started muted; selected frames inspected at approximately 0:24, 0:44, and 0:54 | Large athlete silhouettes, conspicuous colored underfoot selection rings, a compact top-center score/clock, exaggerated jumps, and fiery action trails make small-team action readable. Trailer text overlays are marketing, not gameplay UI to copy. |
| [NBA Jam: On Fire Edition launch article](https://blog.playstation.com/2011/09/30/nba-jam-on-fire-edition-boom-shakalakas-psn-tuesday/comment-page-2/), PlayStation Blog | Publisher/developer guest article text | Tag Mode restores control of both teammates, and teammate commands support quick coordinated actions. Scoring streak effects reinforce moments of success. |

## Concrete design choices derived from the references

These are design interpretations, not claims that the reference games implement our exact mechanics.

1. **See the team before adding spectacle.** Soccer uses the agreed elevated sideline view with enough width to see passing outlets. American football uses the agreed view behind the offense with the line of scrimmage, first-down line, and developing receiver routes visible. Spectators, lights, and venue decoration must not obstruct the playable field.
2. **Make possession and control unmistakable.** Use strongly contrasting uniforms, a unique goalkeeper treatment, an underfoot selection ring, a visible ball and ground shadow, and a compact score/clock display. During a pass or shot, show the intended action and charge; assisted targeting must still permit misses.
3. **AI creates space.** Soccer teammates provide lateral and forward passing outlets while defenders retain coverage. Football receivers separate along distinct routes; defenders pursue likely interception/tackle points. Avoid every athlete converging on the ball or defenders instantly reacting to input.
4. **Reward commitment with readable consequences.** Charge and release determine power while play stays at full speed. Tackles should have a clear attempt/recovery window. Shot, pass, catch, block, touchdown, and goal outcomes need immediate visual feedback.
5. **Keep arcade celebration short.** Use original goal/touchdown banners, a brief camera or crowd response, and light impact effects. Return quickly to the next kickoff or play call. NBA Jam's fire is inspiration for clear excitement, not a required power-up system or copied effect.
6. **Teach from the match.** A persistent compact controller legend and contextual restart/play-call prompts help a controller-only user complete the loop. The pause screen can carry the full controls and match rules.
7. **Respect the agreed rules rather than copying the sources.** Soccer has 5v5 including keepers, no offside/fouls/cards, but touchlines and restarts. Football has 7v7, offense and defense, downs and first downs, a compact playbook, conversion plays, and no special teams. Both target roughly ten-minute AI matches and save/resume.

## Classic controller revision

The user's later instruction explicitly replaces right-stick aiming with familiar FIFA/Madden controls and supersedes the original Y-reserved pause design. Sports now pause with Start/Options; R3 remains voice. FireRed's existing bindings stay intact.

Primary sources read for this revision:

- [EA FIFA 22 Xbox basic controls](https://www.ea.com/able/resources/fifa/fifa-22/xbox-series-x/basic-controls): A ground pass, B shoot, X lob, Y through, RB finesse/driven modifiers, LB runs/switch, LT shield/jockey, RT sprint and right-stick skills. These inform the current soccer layout.
- [EA Madden 23 Xbox controls](https://www.ea.com/able/resources/madden-nfl/madden-nfl-23/xbox-one/controls): receiver buttons, right-stick jukes, B spin/switch, A stiff arm/conservative tackle, X dive tackle, RB protect, LT strafe and RT sprint. Our three eligible receivers use A/B/X.
- [EA Madden 18 Xbox manual](https://media.contentapi.ea.com/content/dam/able/manuals/mad18xb1man.pdf): receiver-button passing, tap/hold trajectory control and left-stick lead. Our medium-hold touch timing is an original simplification, not an exact reproduction of that manual.
- [EA FIFA 13 PC manual](https://akamai.cdn.ea.com/eadownloads/u/f/manuals/GAME-FIFA13/FIFA13pcwinMANOLeWW_FINAL.pdf): directional passing/shooting on the left stick. Use the later FIFA 22 guide above for skill bindings.

Soccer assistance chooses a directionally appropriate receiver or goal target; football buttons identify receivers and left stick adjusts lead. Assistance does not grant possession or a goal: flight, pressure, interception and contact remain simulated. Right stick is exclusively a skill/switch input. Hold/release power, three receiver slots and automatic Sweep handoff are adaptations for our arcade rules and are not claims of exact franchise behavior.

## Historical interpretation after the first prototype review

This section and its recordings predate the classic controller revision.

The initial implementation was not accepted as sufficient game quality. The follow-up uses the same bounded reference evidence above to improve actual decisions and counterplay; it does not claim a new exhaustive viewing study or parity with those commercial games.

- **FIFA/FC-inspired possession choices:** soccer now distinguishes a driven through ball, lofted service, curling shot, shot fake, directional roll, double touch, dragback and a knock-on that gives up possession until the ball is recovered. Direction remains manual. The move names describe original implementations, not copied franchise animations or statistical behavior.
- **2K-inspired use of the right stick and body position:** skill flicks are one-shot directional events with neutral rearming. Soccer jockeying faces the ball while moving and changes interception coverage. Football's juke, spin and directional stiff arm have stamina/recovery costs and opposing success/failure cases. Committed tackle windows replace instantaneous possession changes.
- **Team spacing has a causal test:** soccer AI previously circulated hundreds of passes without a shot. Receipt-timer reset, more useful lanes, attacking progression and physical tackle timing produced shots and goals under the same adversarial input policies. Requested teammate runs give the human a deliberate way to create a passing option.
- **Jam-inspired readability without copied assets:** stronger selection/run markers, rounded original athlete silhouettes, closer live action framing, short outcome effects, generated sound cues and haptic requests expose the action. The closer camera sacrifices a constant whole-field view to make a skill move or tackle legible; the runtime's tactical view supplies wider context.

[Current gameplay documentation](SPORTS_DEVELOPMENT.md#controls) records bindings, measured model response, browser recordings, match outcomes and their limits. The [playtest report](artifacts/sports-turn2/PLAYTEST.md) retains failed policies as well as improved results. The [soccer](artifacts/sports-turn2/soccer-controller.mp4) and [football](artifacts/sports-turn2/football-controller.mp4) clips show rendered actions from emulated controllers; they are canvas-only with no HUD or audio track. Their short sequences are evidence of the shown actions, not proof of commercial-game quality or a physically tested controller feel.

## Verification boundary

This document records reference evidence and design direction only. It does not certify implementation, physical-controller testing, save compatibility, match balance, or performance. Those require the implemented games and runtime to be exercised. Research added no dependency, CI job, build stage, or evaluation campaign.
