# Future development

Changes coming from outside ae-motion that will need work, and what we know about them so far. Re-check the dates and the sources before planning around them.

## UXP replaces CEP

ae-motion's After Effects side is a CEP panel (`panel/`) that runs ExtendScript (`host/`, built to `panel/host/host.jsx`) through `evalScript`. Adobe is replacing CEP with UXP (Unified Extensibility Platform): one modern JavaScript engine that runs both the plugin UI and the app scripting, with async calls into the app's API and Spectrum UI instead of a full embedded browser. There is no Node.js inside UXP; plugins use UXP's own file, network and storage APIs.

### Status in After Effects (checked 2026-10-10)

- UXP for After Effects is in beta. Adobe's [After Effects UXP page](https://developer.adobe.com/after-effects/uxp/) has an API reference for the application, project items, layers, properties, file sources, fonts, import options and settings, and says more documentation and samples will follow during the beta.
- After Effects was the last flagship app in line (Premiere Pro, then Media Encoder, then After Effects), so its UXP API is the least mature.

| When | What happens in After Effects |
|---|---|
| November 2026 | Target for the public beta of UXP plugins |
| December 2028 | CEP disabled by default (users can turn it back on); no new CEP submissions to the Marketplace |
| December 2029 | CEP no longer included in new After Effects versions |

Adobe guarantees at least two years between After Effects' UXP public beta and CEP's removal. ExtendScript scripts are not affected by the transition. Source: [Adobe's migration timeline (September 2026)](https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications).

### What a move to UXP would touch

- **The bridge.** Today the panel is the HTTP server and the MCP server connects to it (`src/bridge.ts`, `panel/main.js`). Adobe's pages don't say whether a UXP plugin can listen for connections or only make outgoing ones (fetch, WebSocket client). If only outgoing, the direction flips: the MCP server listens on 127.0.0.1 and the plugin connects to it, still with the token.
- **The host.** Every command in `host/` would be ported from ES3 ExtendScript to the UXP After Effects API. The ES3 rules, the `host.jsx` build and the `evalScript` string round trip go away; the TypeScript pilot (`host/core/layout.ts`, `host/commands/design.ts`) is the closest starting point. Calls become async.
- **The quirks.** Every After Effects quirk in `CLAUDE.md` and `docs/development.md` was found in ExtendScript. Each needs re-checking under UXP, and the mocks in `test/` re-modelling to match.
- **The panel.** The status UI, token meter and Update button move to UXP's HTML/Spectrum UI, and the Update button can't run `scripts/update.ts` and the installer the way the CEP panel's Node can.
- **Mostly unchanged.** The MCP server in `src/`: tool definitions, schemas, sandboxing, `batch`, rendering through `aerender` and the ffmpeg checks.

### When to start

Not yet. After the public beta ships, check that the After Effects UXP API covers what ae-motion needs: keyframes (ease, roving, spatial tangents), expressions, masks and shape paths, effects, cameras and lights, markers, menu commands, `saveFrameToPng`, Convert Audio to Keyframes and project save/open. Then check networking (see the bridge, above). Until then, CEP keeps working; leave a margin before December 2028, when users would otherwise have to turn CEP back on themselves.
