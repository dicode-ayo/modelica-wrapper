# Bootstrap OpenModelica from conda-forge via a downloaded micromamba

The extension is useless without an `omc` binary, and users arrive without one — on macOS
necessarily so, since OpenModelica has published no macOS build since 1.16 and directs
users to Docker, a VM, or building from source. We install OpenModelica from
**conda-forge**, driven by a **micromamba binary downloaded at runtime**, into a private
per-user prefix. It is the only route that covers Linux and macOS with pinned versions and
a maintained, currently-responsive upstream.

## Considered Options

Each was rejected for a specific reason, and each will look attractive again to someone who
does not know these:

- **`OpenModelica/setup-openmodelica` (for CI).** Its version list is hand-maintained and
  tops out below our pin, so requesting the pinned version resolves to nothing and throws.
  Tracking the floating release instead would discard the pin that the audit workflow and
  Renovate are built around. The container costs about 35 seconds of a three-minute job, so
  there is no speed argument either. We keep the container.
- **Bundling micromamba in the VSIX.** Requires platform-specific VSIX targets, which turns
  the release attachment step into a four-way matrix and gives up the single universal
  artifact that workflow deliberately publishes.
- **Bundling OpenModelica itself.** Roughly 1.5 GB in a marketplace artifact.
- **Extracting `.deb` packages by hand.** Fights the runtime toolchain dependency — `omc`
  shells out to a C compiler to simulate, so the compiler has to come along and be
  activated.
- **`winget`.** Publishes an older version than we pin and offers no version pinning.
- **Homebrew.** No formula.
- **Official macOS builds.** None since 1.16.
- **Depending on a third-party conda extension for VS Code.** The only real candidate
  exports no API at all — it contributes interactive commands only — activates on a
  checked-in environment file, and bails without a workspace folder. Architecturally it
  manages *the user's* environment from *their* manifest, which is the opposite of
  privately provisioning a toolchain. npm has no micromamba package.

## Consequences

Windows is not covered: the conda-forge recipe skips it, so there is nothing to install.
Windows users get guidance toward the official installer, which is the platform where
OpenModelica's own distribution is strongest.

conda-forge becomes a second upstream in the delivery path, volunteer-maintained, with the
macOS patches resting on limited maintainer effort. The scheduled real-install job in CI is
the early-warning mechanism for this, and it is also the only thing that will notice a
committed lockfile whose package URLs have stopped resolving.

The installed footprint is about 3.0 GB, of which roughly 238 MB is the OMEdit GUI stack
that `ldd` confirms `omc` does not link against. Shrinking it upstream is tracked in #562
and is deliberately not a prerequisite: installs run from a committed lockfile, so adopting
a slimmer package later is a data change rather than a code change.

conda-forge is not subject to Anaconda's paid-license terms — those cover Anaconda's own
`defaults` channel — but the channel is pinned explicitly in code rather than relying on
micromamba's default, so this stays true by construction.
